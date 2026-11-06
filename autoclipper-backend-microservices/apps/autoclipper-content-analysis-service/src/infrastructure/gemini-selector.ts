import {z} from "zod";
import {selectionOutputForCount,type AnalysisSpec} from "@autoclipper/api-contracts";
import {AnalysisError,type Transcript} from "../domain/transcript.js";
import {validateSelection} from "../domain/selection.js";
import {boundedText} from "./response.js";
import {buildSelectionUserPrompt,MAX_SELECTION_INPUT_BYTES,MAX_SELECTION_OUTPUT_TOKENS,MAX_SELECTION_REQUEST_OVERHEAD_BYTES,MAX_SELECTION_RESPONSE_BYTES,maximumSelectionCostUsd,roundSelectionCostUp,SELECTION_PROMPT_VERSION,SELECTION_SYSTEM_PROMPT,selectionPromptRevision} from "./selection-prompt.js";

const API_URL="https://generativelanguage.googleapis.com/v1beta/models/";
const SUPPORTED_MODELS=new Set(["gemini-2.5-flash"]);
const reply=z.object({
  candidates:z.array(z.object({
    finishReason:z.string().optional(),
    content:z.object({parts:z.array(z.object({text:z.string().max(MAX_SELECTION_RESPONSE_BYTES).optional()}).passthrough()).max(16)}).passthrough(),
  }).passthrough()).min(1).max(1),
  usageMetadata:z.object({promptTokenCount:z.number().int().nonnegative(),totalTokenCount:z.number().int().nonnegative()}).passthrough(),
}).passthrough();

export class GeminiSelector {
  readonly provider="gemini" as const;
  readonly apiKey=process.env["GEMINI_API_KEY"]?.trim()??"";
  readonly model=process.env["GEMINI_MODEL"]?.trim()??"";
  readonly inputUsdPerMillion=Number(process.env["GEMINI_INPUT_USD_PER_MILLION_TOKENS"]??"");
  readonly outputUsdPerMillion=Number(process.env["GEMINI_OUTPUT_USD_PER_MILLION_TOKENS"]??"");
  readonly budgetUsd=Number(process.env["AI_MAX_ESTIMATED_USD_PER_JOB"]??0);
  readonly paidApproved=process.env["PAID_AI_ENABLED"]==="true";
  readonly promptVersion=SELECTION_PROMPT_VERSION;
  readonly revision=selectionPromptRevision(this.provider,this.model,this.inputUsdPerMillion,this.outputUsdPerMillion);

  constructor(private readonly transport:typeof fetch=fetch){}

  maximumCostUsd(inputBytes:number){
    return maximumSelectionCostUsd(inputBytes,this.inputUsdPerMillion,this.outputUsdPerMillion);
  }

  async diagnostics(){
    if(!SUPPORTED_MODELS.has(this.model))return{configured:false,status:"invalid_configuration" as const,code:"SELECTION_MODEL_NOT_SUPPORTED",missingSettings:["GEMINI_MODEL"],nextSteps:[`Set GEMINI_MODEL to an approved model identifier: ${[...SUPPORTED_MODELS].join(", ")}. New models require explicit review and matching token prices.`],model:this.model};
    const missingSettings:string[]=[];
    if(this.apiKey.length<16)missingSettings.push("GEMINI_API_KEY");
    if(!this.paidApproved)missingSettings.push("PAID_AI_ENABLED");
    if(!Number.isFinite(this.budgetUsd)||this.budgetUsd<=0)missingSettings.push("AI_MAX_ESTIMATED_USD_PER_JOB");
    if(!Number.isFinite(this.inputUsdPerMillion)||this.inputUsdPerMillion<=0)missingSettings.push("GEMINI_INPUT_USD_PER_MILLION_TOKENS");
    if(!Number.isFinite(this.outputUsdPerMillion)||this.outputUsdPerMillion<=0)missingSettings.push("GEMINI_OUTPUT_USD_PER_MILLION_TOKENS");
    if(missingSettings.length){
      const missingKey=missingSettings.includes("GEMINI_API_KEY");
      const budgetBlocked=missingSettings.some(value=>["PAID_AI_ENABLED","AI_MAX_ESTIMATED_USD_PER_JOB"].includes(value));
      return{configured:false,status:"missing_configuration" as const,code:missingKey?"GEMINI_API_KEY_MISSING":budgetBlocked?"AI_BUDGET_NOT_AUTHORIZED":"SELECTION_NOT_CONFIGURED",missingSettings,nextSteps:[
        ...(missingKey?["Set GEMINI_API_KEY in the private Analysis service environment; never send it to the browser or commit it."]:[]),
        ...(!this.paidApproved?["Set PAID_AI_ENABLED=true only after approving paid AI execution."]:[]),
        ...(!(Number.isFinite(this.budgetUsd)&&this.budgetUsd>0)?["Set AI_MAX_ESTIMATED_USD_PER_JOB to a positive per-job USD ceiling before enabling paid selection."]:[]),
        ...(!(Number.isFinite(this.inputUsdPerMillion)&&this.inputUsdPerMillion>0)||!(Number.isFinite(this.outputUsdPerMillion)&&this.outputUsdPerMillion>0)?["Set Gemini input and output token prices for the exact selected model before enabling paid selection."]:[]),
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
    if(this.maximumCostUsd(inputBytes)>this.budgetUsd)throw new AnalysisError("AI_BUDGET_NOT_AUTHORIZED");
    let response:Response;
    try{
      response=await this.transport(`${API_URL}${encodeURIComponent(this.model)}:generateContent`,{method:"POST",headers:{"x-goog-api-key":this.apiKey,"content-type":"application/json"},signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),redirect:"error",body:JSON.stringify({systemInstruction:{parts:[{text:SELECTION_SYSTEM_PROMPT}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0,maxOutputTokens:MAX_SELECTION_OUTPUT_TOKENS,responseFormat:{text:{mimeType:"APPLICATION_JSON",schema:z.toJSONSchema(selectionOutputForCount(spec.count))}}}})});
    }catch{throw new AnalysisError(signal.aborted?"CANCELLED":"PROVIDER_OUTCOME_UNKNOWN",false,!signal.aborted);}
    if(response.status===429)throw new AnalysisError("PROVIDER_RATE_LIMITED",true);
    if(response.status>=500)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    if(!response.ok)throw new AnalysisError("SELECTION_PROVIDER_REJECTED");
    let value:unknown;try{value=JSON.parse(await boundedText(response,MAX_SELECTION_RESPONSE_BYTES)) as unknown;}catch{throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);}
    const parsed=reply.safeParse(value);
    if(!parsed.success)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    const candidate=parsed.data.candidates[0]!;
    const content=candidate.content.parts.map(part=>part.text??"").join("");
    if(candidate.finishReason!=="STOP"||!content)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    let result:unknown;try{result=JSON.parse(content) as unknown;}catch{throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);}
    let selection:ReturnType<typeof validateSelection>;
    try{selection=validateSelection(result,transcript,spec);}catch(error){if(error instanceof AnalysisError)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);throw error;}
    const inputTokens=parsed.data.usageMetadata.promptTokenCount;
    const outputTokens=parsed.data.usageMetadata.totalTokenCount-inputTokens;
    if(outputTokens<0)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    if(inputTokens>inputBytes+MAX_SELECTION_REQUEST_OVERHEAD_BYTES||outputTokens>MAX_SELECTION_OUTPUT_TOKENS)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    const estimatedExternalCostUsd=roundSelectionCostUp((inputTokens*this.inputUsdPerMillion+outputTokens*this.outputUsdPerMillion)/1_000_000);
    if(estimatedExternalCostUsd>this.budgetUsd)throw new AnalysisError("AI_BUDGET_NOT_AUTHORIZED",false,true);
    return{...selection,provider:this.provider,model:this.model,revision:this.revision,promptVersion:this.promptVersion,usage:{inputTokens,outputTokens},estimatedExternalCostUsd};
  }
}
