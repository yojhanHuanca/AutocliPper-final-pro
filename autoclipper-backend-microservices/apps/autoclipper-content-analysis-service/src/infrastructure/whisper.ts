import { LOCAL_TRANSCRIPTION_MAX_SECONDS } from "@autoclipper/api-contracts";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {access,readFile,stat} from "node:fs/promises";
import {createReadStream,constants} from "node:fs";
import {createHash} from "node:crypto";
import {dirname,join} from "node:path";
import {z} from "zod";
import {logger} from "@autoclipper/observability";
import {AnalysisError,validateTranscript,type TranscriptionProvider} from "../domain/transcript.js";

const execute=promisify(execFile);
const response=z.object({result:z.object({language:z.string()}),transcription:z.array(z.object({offsets:z.object({from:z.number().finite().nonnegative(),to:z.number().finite().nonnegative()}),text:z.string()})).max(20000)});
export class WhisperProvider implements TranscriptionProvider {
  readonly name="whisper_cpp" as const;
  readonly binary=process.env["WHISPER_PATH"]??"";
  readonly modelPath=process.env["WHISPER_MODEL_PATH"]??"";
  readonly expectedHash=process.env["WHISPER_MODEL_SHA256"]??"";
  readonly engineVersion=process.env["WHISPER_ENGINE_VERSION"]??"";
  readonly model=process.env["WHISPER_MODEL"]??"";
  async diagnostics(){
    const required=["WHISPER_PATH","WHISPER_MODEL_PATH","WHISPER_MODEL_SHA256","WHISPER_ENGINE_VERSION","WHISPER_MODEL"];
    const values=[this.binary,this.modelPath,this.expectedHash,this.engineVersion,this.model];
    const missingSettings=required.filter((_name,index)=>!values[index]);
    if(missingSettings.length)return{configured:false,status:"missing_configuration" as const,code:"TRANSCRIPTION_NOT_CONFIGURED",missingSettings,nextSteps:["Opt in to compose.analysis-local.yaml to provide the local whisper.cpp binary and model configuration.","Keep the verified ggml-tiny.bin model mounted read-only at /models/ggml-tiny.bin."]};
    if(!/^[a-f0-9]{64}$/.test(this.expectedHash))return{configured:false,status:"invalid_configuration" as const,code:"TRANSCRIPTION_NOT_CONFIGURED",missingSettings:["WHISPER_MODEL_SHA256"],nextSteps:["Set WHISPER_MODEL_SHA256 to the verified SHA-256 of the selected Whisper model."]};
    try{await access(this.binary,constants.X_OK);await access(this.modelPath,constants.R_OK);return{configured:true,status:"ready" as const,code:null,missingSettings:[],nextSteps:[]};}
    catch{return{configured:false,status:"runtime_dependency_missing" as const,code:"TRANSCRIPTION_NOT_CONFIGURED",missingSettings:[],nextSteps:["Ensure WHISPER_PATH points to an executable in the analysis container and WHISPER_MODEL_PATH points to a readable mounted model file."]};}
  }
  async configured(){return(await this.diagnostics()).configured;}
  private async verifyModel(signal:AbortSignal){const hash=createHash("sha256");try{for await(const chunk of createReadStream(this.modelPath,{signal}))hash.update(chunk as Buffer);}catch(error){if(signal.aborted)throw new AnalysisError("CANCELLED");throw error;}if(hash.digest("hex")!==this.expectedHash)throw new AnalysisError("MODEL_INTEGRITY_MISMATCH");}
  async transcribe(path:string,durationSeconds:number,language:"auto"|"es"|"en",signal:AbortSignal){
    if(!await this.configured())throw new AnalysisError("TRANSCRIPTION_NOT_CONFIGURED");
    if(durationSeconds>LOCAL_TRANSCRIPTION_MAX_SECONDS)throw new AnalysisError("LOCAL_TRANSCRIPTION_DURATION_LIMIT");
    await this.verifyModel(signal);const prefix=join(dirname(path),"transcript");
    try {
      await execute(this.binary,["-m",this.modelPath,"-f",path,"-l",language,"-t","2","-ng","-np","-ml","80","-sow","-ojf","-of",prefix],{shell:false,windowsHide:true,timeout:Math.min(1500000,Math.max(300000,Math.ceil(durationSeconds*400))),killSignal:"SIGKILL",maxBuffer:65536,signal});
    }catch(error){
      if(signal.aborted)throw new AnalysisError("CANCELLED");
      const failure=error as {code?:unknown;signal?:unknown;killed?:unknown;stdout?:unknown;stderr?:unknown};
      logger.warn({code:"WHISPER_PROCESS_FAILED",processCode:typeof failure.code==="string"||typeof failure.code==="number"?failure.code:null,processSignal:typeof failure.signal==="string"?failure.signal:null,killed:failure.killed===true,stdoutBytes:typeof failure.stdout==="string"?Buffer.byteLength(failure.stdout):0,stderrBytes:typeof failure.stderr==="string"?Buffer.byteLength(failure.stderr):0});
      throw new AnalysisError("LOCAL_TRANSCRIPTION_FAILED_OR_TIMEOUT");
    }
    let raw:unknown;try{if((await stat(prefix+".json")).size>8388608)throw new Error("Result too large");const text=await readFile(prefix+".json","utf8");if(Buffer.byteLength(text)>8388608)throw new Error("Result too large");raw=JSON.parse(text) as unknown;}catch{throw new AnalysisError("INVALID_TRANSCRIPT");}
    const data=response.safeParse(raw);if(!data.success)throw new AnalysisError("INVALID_TRANSCRIPT");
    const segments=data.data.transcription.filter(segment=>segment.text.trim()&&segment.offsets.to>segment.offsets.from).map(segment=>({startSeconds:segment.offsets.from/1000,endSeconds:segment.offsets.to/1000,text:segment.text.trim()}));
    if(!segments.length)throw new AnalysisError("NO_SPEECH_DETECTED");
    return validateTranscript({language:data.data.result.language,languageSource:language==="auto"?"detected":"requested",durationSeconds,segments,provider:this.name,model:this.model,revision:this.expectedHash,engineVersion:this.engineVersion,modelSha256:this.expectedHash,requestId:null,estimatedExternalCostUsd:0,diarization:false},durationSeconds);
  }
}
