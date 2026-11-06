import {z} from "zod";
import {selectionOutputForCount,type AnalysisSpec} from "@autoclipper/api-contracts";
import {AnalysisError,type Transcript} from "../domain/transcript.js";
import {validateSelection} from "../domain/selection.js";
import {boundedText} from "./response.js";
import {openAIInvocationBudgetConfig,MAX_OPENAI_INVOCATIONS_PER_RUN} from "./openai-invocation-budget.js";
import {buildSelectionUserPrompt,MAX_SELECTION_INPUT_BYTES,MAX_SELECTION_OUTPUT_TOKENS,MAX_SELECTION_REQUEST_OVERHEAD_BYTES,MAX_SELECTION_RESPONSE_BYTES,maximumSelectionCostUsd,roundSelectionCostUp,SELECTION_PROMPT_VERSION,SELECTION_SYSTEM_PROMPT,selectionPromptRevision} from "./selection-prompt.js";

const API_URL="https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS=90000;
const DEFAULT_MODEL="gpt-6-luna";
const SUPPORTED_MODELS=new Set([DEFAULT_MODEL]);
const DEFAULT_INPUT_USD_PER_MILLION=0.10;
const DEFAULT_OUTPUT_USD_PER_MILLION=0.50;
type JsonSchemaRecord=Record<string,unknown>;
function strictOpenAiSchema(count:number):JsonSchemaRecord{
  const schema=JSON.parse(JSON.stringify(z.toJSONSchema(selectionOutputForCount(count)))) as JsonSchemaRecord;
  const visit=(value:unknown):void=>{
    if(Array.isArray(value)){for(const entry of value)visit(entry);return;}
    if(value===null||typeof value!=="object")return;
    const node=value as JsonSchemaRecord;
    delete node["pattern"];
    const rawProperties=node["properties"];
    if(rawProperties!==null&&typeof rawProperties==="object"&&!Array.isArray(rawProperties)){
      const properties=rawProperties as Record<string,unknown>;
      const originalRequired=new Set(Array.isArray(node["required"])?node["required"].filter((entry):entry is string=>typeof entry==="string"):[]);
      for(const [key,property]of Object.entries(properties))if(!originalRequired.has(key))properties[key]={anyOf:[property,{type:"null"}]};
      node["required"]=Object.keys(properties);
      node["additionalProperties"]=false;
      for(const property of Object.values(properties))visit(property);
    }
    if("items" in node)visit(node["items"]);
    for(const key of ["anyOf","oneOf","allOf"])if(key in node)visit(node[key]);
    delete node["$schema"];
  };
  visit(schema);
  return schema;
}

function normalizeNullableScores(value:unknown):unknown{
  if(value===null||typeof value!=="object"||Array.isArray(value))return value;
  const record=value as Record<string,unknown>;
  if(!Array.isArray(record["segments"]))return value;
  return{...record,segments:record["segments"].map(segment=>{
    if(segment===null||typeof segment!=="object"||Array.isArray(segment))return segment;
    const proposal={...segment as Record<string,unknown>};
    if(proposal["score"]===null)delete proposal["score"];
    return proposal;
  })};
}

const reply=z.object({
  id:z.string().min(1).max(200),
  model:z.string().min(1).max(200),
  choices:z.array(z.object({finish_reason:z.string().nullable(),message:z.object({content:z.string().nullable(),refusal:z.string().nullable().optional()})}).passthrough()).min(1).max(1),
  usage:z.object({prompt_tokens:z.number().int().nonnegative(),completion_tokens:z.number().int().nonnegative()}).passthrough(),
}).passthrough();

export class OpenAISelector {
  readonly provider="openai" as const;
  readonly apiKey=process.env["OPENAI_API_KEY"]?.trim()??"";
  readonly model=process.env["OPENAI_MODEL"]?.trim()||DEFAULT_MODEL;
  readonly inputUsdPerMillion=Number(process.env["OPENAI_INPUT_USD_PER_MILLION_TOKENS"]??DEFAULT_INPUT_USD_PER_MILLION);
  readonly outputUsdPerMillion=Number(process.env["OPENAI_OUTPUT_USD_PER_MILLION_TOKENS"]??DEFAULT_OUTPUT_USD_PER_MILLION);
  readonly budgetUsd=Number(process.env["AI_MAX_ESTIMATED_USD_PER_JOB"]??0);
  readonly paidApproved=process.env["PAID_AI_ENABLED"]==="true";
  readonly promptVersion=SELECTION_PROMPT_VERSION;
  readonly revision=selectionPromptRevision(this.provider,this.model,this.inputUsdPerMillion,this.outputUsdPerMillion,strictOpenAiSchema(3));

  constructor(private readonly transport:typeof fetch=fetch,private readonly reserveInvocation?:()=>Promise<unknown>){}

  maximumCostUsd(inputBytes:number){
    return maximumSelectionCostUsd(inputBytes,this.inputUsdPerMillion,this.outputUsdPerMillion);
  }

  async diagnostics(){
    if(!SUPPORTED_MODELS.has(this.model))return{configured:false,status:"invalid_configuration" as const,code:"SELECTION_MODEL_NOT_SUPPORTED",missingSettings:["OPENAI_MODEL"],nextSteps:[`Set OPENAI_MODEL to an approved model identifier: ${[...SUPPORTED_MODELS].join(", ")}. New models require explicit review and matching token prices.`],model:this.model};
    const missingSettings:string[]=[];
    if(this.apiKey.length<16)missingSettings.push("OPENAI_API_KEY");
    if(!this.paidApproved)missingSettings.push("PAID_AI_ENABLED");
    if(!Number.isFinite(this.budgetUsd)||this.budgetUsd<=0)missingSettings.push("AI_MAX_ESTIMATED_USD_PER_JOB");
    if(!Number.isFinite(this.inputUsdPerMillion)||this.inputUsdPerMillion<DEFAULT_INPUT_USD_PER_MILLION)missingSettings.push("OPENAI_INPUT_USD_PER_MILLION_TOKENS");
    if(!Number.isFinite(this.outputUsdPerMillion)||this.outputUsdPerMillion<DEFAULT_OUTPUT_USD_PER_MILLION)missingSettings.push("OPENAI_OUTPUT_USD_PER_MILLION_TOKENS");
    if(this.paidApproved&&this.reserveInvocation&&!openAIInvocationBudgetConfig().configured)missingSettings.push("OPENAI_MAX_API_INVOCATIONS_PER_RUN","OPENAI_INVOCATION_BUDGET_ID");
    if(missingSettings.length){
      const missingKey=missingSettings.includes("OPENAI_API_KEY");
      const budgetBlocked=missingSettings.some(value=>["PAID_AI_ENABLED","AI_MAX_ESTIMATED_USD_PER_JOB","OPENAI_MAX_API_INVOCATIONS_PER_RUN","OPENAI_INVOCATION_BUDGET_ID"].includes(value));
      return{configured:false,status:"missing_configuration" as const,code:missingKey?"OPENAI_API_KEY_MISSING":budgetBlocked?"AI_BUDGET_NOT_AUTHORIZED":"SELECTION_NOT_CONFIGURED",missingSettings,nextSteps:[
        ...(missingKey?["Set OPENAI_API_KEY in the private Analysis service environment; never send it to the browser or commit it."]:[]),
        ...(!this.paidApproved?["Set PAID_AI_ENABLED=true only after approving paid AI execution."]:[]),
        ...(!(Number.isFinite(this.budgetUsd)&&this.budgetUsd>0)?["Set AI_MAX_ESTIMATED_USD_PER_JOB to a positive per-job USD ceiling before enabling paid selection."]:[]),
        ...(this.paidApproved&&this.reserveInvocation&&!openAIInvocationBudgetConfig().configured?[`Set OPENAI_MAX_API_INVOCATIONS_PER_RUN to an integer from 1 to ${MAX_OPENAI_INVOCATIONS_PER_RUN} and OPENAI_INVOCATION_BUDGET_ID to a unique UUID for this run.`]:[]),
        ...(missingSettings.includes("OPENAI_INPUT_USD_PER_MILLION_TOKENS")?["Set OPENAI_INPUT_USD_PER_MILLION_TOKENS to at least 0.10 USD per million input tokens for gpt-6-luna."]:[]),
        ...(missingSettings.includes("OPENAI_OUTPUT_USD_PER_MILLION_TOKENS")?["Set OPENAI_OUTPUT_USD_PER_MILLION_TOKENS to at least 0.50 USD per million output tokens for gpt-6-luna."]:[]),
      ],model:this.model,budgetUsd:this.budgetUsd,maxEstimatedCostUsd:this.maximumCostUsd(MAX_SELECTION_INPUT_BYTES),maxInputBytes:MAX_SELECTION_INPUT_BYTES,maxOutputTokens:MAX_SELECTION_OUTPUT_TOKENS};
    }
    const maxEstimatedCostUsd=this.maximumCostUsd(MAX_SELECTION_INPUT_BYTES);
    if(maxEstimatedCostUsd>this.budgetUsd)return{configured:false,status:"budget_too_low" as const,code:"AI_BUDGET_NOT_AUTHORIZED",missingSettings:["AI_MAX_ESTIMATED_USD_PER_JOB"],nextSteps:["Increase AI_MAX_ESTIMATED_USD_PER_JOB only if the estimated maximum per-job charge is approved."],model:this.model,budgetUsd:this.budgetUsd,maxEstimatedCostUsd,maxInputBytes:MAX_SELECTION_INPUT_BYTES,maxOutputTokens:MAX_SELECTION_OUTPUT_TOKENS};
    return{configured:true,status:"ready" as const,code:null,missingSettings:[],nextSteps:[],model:this.model,budgetUsd:this.budgetUsd,maxEstimatedCostUsd,maxInputBytes:MAX_SELECTION_INPUT_BYTES,maxOutputTokens:MAX_SELECTION_OUTPUT_TOKENS};
  }

  async configured(){return(await this.diagnostics()).configured;}

  async select(transcript:Transcript,spec:Extract<AnalysisSpec["selection"],{mode:"llm"}>,signal:AbortSignal){
    const diagnostic=await this.diagnostics();
    if(!diagnostic.configured)throw new AnalysisError(diagnostic.code??"SELECTION_NOT_CONFIGURED");
    if(spec.count*spec.minSeconds>transcript.durationSeconds)throw new AnalysisError("INVALID_SELECTION_REQUEST");
    const prompt=buildSelectionUserPrompt(transcript,spec);
    const inputBytes=Buffer.byteLength(prompt);
    if(inputBytes>MAX_SELECTION_INPUT_BYTES)throw new AnalysisError("SELECTION_INPUT_LIMIT");
    const estimate=this.maximumCostUsd(inputBytes);
    if(estimate>this.budgetUsd)throw new AnalysisError("AI_BUDGET_NOT_AUTHORIZED");
    if(this.reserveInvocation)await this.reserveInvocation();
    let response:Response;
    try{
      response=await this.transport(API_URL,{method:"POST",headers:{authorization:`Bearer ${this.apiKey}`,"content-type":"application/json"},signal:AbortSignal.any([signal,AbortSignal.timeout(TIMEOUT_MS)]),redirect:"error",body:JSON.stringify({model:this.model,store:false,temperature:0,reasoning_effort:"none",max_completion_tokens:MAX_SELECTION_OUTPUT_TOKENS,response_format:{type:"json_schema",json_schema:{name:"segment_selection",strict:true,schema:strictOpenAiSchema(spec.count)}},messages:[
        {role:"system",content:SELECTION_SYSTEM_PROMPT},
        {role:"user",content:prompt},
      ]})});
    }catch{throw new AnalysisError(signal.aborted?"CANCELLED":"PROVIDER_OUTCOME_UNKNOWN",false,!signal.aborted);}
    if(response.status===429)throw new AnalysisError("PROVIDER_RATE_LIMITED",true);
    if(response.status>=500)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    if(!response.ok)throw new AnalysisError("SELECTION_PROVIDER_REJECTED");
    let value:unknown;try{value=JSON.parse(await boundedText(response,MAX_SELECTION_RESPONSE_BYTES)) as unknown;}catch{throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);}
    const parsed=reply.safeParse(value);
    if(!parsed.success)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    const choice=parsed.data.choices[0]!;
    if(choice.finish_reason!=="stop"||choice.message.refusal||!choice.message.content)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    let result:unknown;try{result=JSON.parse(choice.message.content) as unknown;}catch{throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);}
    let selection:ReturnType<typeof validateSelection>;
    try{selection=validateSelection(normalizeNullableScores(result),transcript,spec);}catch(error){if(error instanceof AnalysisError)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);throw error;}
    const usage=parsed.data.usage;
    const maxInputTokens=inputBytes+MAX_SELECTION_REQUEST_OVERHEAD_BYTES;
    if(usage.prompt_tokens>maxInputTokens||usage.completion_tokens>MAX_SELECTION_OUTPUT_TOKENS)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    const estimatedExternalCostUsd=roundSelectionCostUp((usage.prompt_tokens*this.inputUsdPerMillion+usage.completion_tokens*this.outputUsdPerMillion)/1_000_000);
    if(estimatedExternalCostUsd>this.budgetUsd)throw new AnalysisError("AI_BUDGET_NOT_AUTHORIZED",false,true);
    return{...selection,provider:this.provider,model:this.model,revision:this.revision,promptVersion:this.promptVersion,usage:{inputTokens:usage.prompt_tokens,outputTokens:usage.completion_tokens},estimatedExternalCostUsd};
  }
}
