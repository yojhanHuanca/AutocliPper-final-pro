import {readFile} from "node:fs/promises";
import {z} from "zod";
import {AnalysisError,validateTranscript,type TranscriptionProvider} from "../domain/transcript.js";

const word=z.object({start:z.number().finite().nonnegative(),end:z.number().finite().nonnegative(),word:z.string(),punctuated_word:z.string().optional(),speaker:z.number().int().nonnegative().optional()});
const responseSchema=z.object({metadata:z.object({request_id:z.string().min(1).max(200),duration:z.number().positive(),model_info:z.record(z.string(),z.object({name:z.string(),version:z.string(),arch:z.string()}))}),results:z.object({channels:z.array(z.object({detected_language:z.string().optional(),alternatives:z.array(z.object({words:z.array(word).max(100000)})).min(1)})).min(1)})});
export class DeepgramProvider implements TranscriptionProvider {
  readonly name="deepgram" as const;
  readonly key=process.env["DEEPGRAM_API_KEY"]??"";
  readonly version=process.env["DEEPGRAM_MODEL_VERSION"]??"";
  readonly unitPrice=Number(process.env["DEEPGRAM_USD_PER_MINUTE"]??0);
  readonly approved=process.env["PAID_AI_ENABLED"]==="true";
  readonly budget=Number(process.env["AI_MAX_ESTIMATED_USD_PER_JOB"]??0);
  constructor(private readonly transport:typeof fetch=fetch){}
  async configured(){return this.key.length>=16&&Boolean(this.version)&&this.version!=="latest"&&this.approved&&Number.isFinite(this.unitPrice)&&this.unitPrice>0&&Number.isFinite(this.budget)&&this.budget>0;}
  async transcribe(path:string,durationSeconds:number,language:"auto"|"es"|"en",signal:AbortSignal){
    if(!await this.configured())throw new AnalysisError("TRANSCRIPTION_NOT_CONFIGURED");
    const estimate=Math.ceil(durationSeconds)*this.unitPrice/60;
    if(estimate>this.budget)throw new AnalysisError("AI_BUDGET_NOT_AUTHORIZED");
    const audio=await readFile(path);if(audio.length>134217728)throw new AnalysisError("AUDIO_SIZE_LIMIT");
    const url=new URL("https://api.deepgram.com/v1/listen");url.searchParams.set("model","nova-3");url.searchParams.set("version",this.version);url.searchParams.set("punctuate","true");url.searchParams.set("smart_format","true");url.searchParams.set("diarize_model","v2");url.searchParams.set("mip_opt_out","true");
    if(language==="auto")url.searchParams.set("detect_language","true");else url.searchParams.set("language",language);
    let response:Response;
    try{response=await this.transport(url,{method:"POST",headers:{authorization:`Token ${this.key}`,"content-type":"audio/wav"},body:new Uint8Array(audio),signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),redirect:"error"});}
    catch{throw new AnalysisError(signal.aborted?"CANCELLED":"PROVIDER_OUTCOME_UNKNOWN",false,true);}
    if(response.status===429)throw new AnalysisError("PROVIDER_RATE_LIMITED",true);
    if(response.status>=500)throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
    if(!response.ok)throw new AnalysisError("TRANSCRIPTION_PROVIDER_REJECTED");
    let raw:unknown;
    try{const chunks:Uint8Array[]=[];let bytes=0;if(!response.body)throw new Error("No body");for await(const chunk of response.body){bytes+=chunk.length;if(bytes>8388608)throw new Error("Response size limit");chunks.push(chunk);}raw=JSON.parse(Buffer.concat(chunks).toString()) as unknown;}catch{throw new AnalysisError("INVALID_PROVIDER_RESPONSE",false,true);}
    const parsed=responseSchema.safeParse(raw);if(!parsed.success)throw new AnalysisError("INVALID_PROVIDER_RESPONSE",false,true);
    const data=parsed.data,model=Object.values(data.metadata.model_info).find(value=>value.arch==="nova-3"&&value.version===this.version);
    if(!model)throw new AnalysisError("TRANSCRIPTION_MODEL_VERSION_MISMATCH");
    const channel=data.results.channels[0]!,words=channel.alternatives[0]!.words;
    if(!words.length)throw new AnalysisError("NO_SPEECH_DETECTED");
    const detected=channel.detected_language;if(language==="auto"&&!detected)throw new AnalysisError("INVALID_TRANSCRIPT_LANGUAGE");
    const segments:{startSeconds:number;endSeconds:number;text:string;speaker?:number}[]=[];
    for(let index=0;index<words.length;){const group=[words[index++]!];while(index<words.length&&group.length<12&&words[index]!.speaker===group[0]!.speaker)group.push(words[index++]!);const first=group[0]!,last=group.at(-1)!;segments.push({startSeconds:first.start,endSeconds:last.end,text:group.map(value=>value.punctuated_word??value.word).join(" "),...(first.speaker===undefined?{}:{speaker:first.speaker})});}
    return validateTranscript({language:detected??language,languageSource:detected?"detected":"requested",durationSeconds:data.metadata.duration,segments,provider:this.name,model:model.name,revision:model.version,engineVersion:"listen-v1/diarize-v2",modelSha256:null,requestId:data.metadata.request_id,estimatedExternalCostUsd:estimate,diarization:segments.some(segment=>segment.speaker!==undefined)},durationSeconds);
  }
}
