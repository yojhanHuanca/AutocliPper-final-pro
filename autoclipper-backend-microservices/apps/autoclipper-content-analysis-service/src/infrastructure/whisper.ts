import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {access,readFile,stat} from "node:fs/promises";
import {createReadStream,constants} from "node:fs";
import {createHash} from "node:crypto";
import {dirname,join} from "node:path";
import {z} from "zod";
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
  async configured(){
    if(!this.binary||!this.modelPath||!this.engineVersion||!this.model||!/^[a-f0-9]{64}$/.test(this.expectedHash))return false;
    try{await access(this.binary,constants.X_OK);await access(this.modelPath,constants.R_OK);return true;}catch{return false;}
  }
  private async verifyModel(signal:AbortSignal){const hash=createHash("sha256");try{for await(const chunk of createReadStream(this.modelPath,{signal}))hash.update(chunk as Buffer);}catch(error){if(signal.aborted)throw new AnalysisError("CANCELLED");throw error;}if(hash.digest("hex")!==this.expectedHash)throw new AnalysisError("MODEL_INTEGRITY_MISMATCH");}
  async transcribe(path:string,durationSeconds:number,language:"auto"|"es"|"en",signal:AbortSignal){
    if(!await this.configured())throw new AnalysisError("TRANSCRIPTION_NOT_CONFIGURED");
    if(durationSeconds>300)throw new AnalysisError("LOCAL_TRANSCRIPTION_DURATION_LIMIT");
    await this.verifyModel(signal);const prefix=join(dirname(path),"transcript");
    try {
      await execute(this.binary,["-m",this.modelPath,"-f",path,"-l",language,"-t","2","-ng","-np","-ml","80","-sow","-ojf","-of",prefix],{shell:false,windowsHide:true,timeout:300000,killSignal:"SIGKILL",maxBuffer:65536,signal});
    }catch{if(signal.aborted)throw new AnalysisError("CANCELLED");throw new AnalysisError("LOCAL_TRANSCRIPTION_FAILED_OR_TIMEOUT");}
    let raw:unknown;try{if((await stat(prefix+".json")).size>8388608)throw new Error("Result too large");const text=await readFile(prefix+".json","utf8");if(Buffer.byteLength(text)>8388608)throw new Error("Result too large");raw=JSON.parse(text) as unknown;}catch{throw new AnalysisError("INVALID_TRANSCRIPT");}
    const data=response.safeParse(raw);if(!data.success)throw new AnalysisError("INVALID_TRANSCRIPT");
    const segments=data.data.transcription.filter(segment=>segment.text.trim()&&segment.offsets.to>segment.offsets.from).map(segment=>({startSeconds:segment.offsets.from/1000,endSeconds:segment.offsets.to/1000,text:segment.text.trim()}));
    if(!segments.length)throw new AnalysisError("NO_SPEECH_DETECTED");
    return validateTranscript({language:data.data.result.language,languageSource:language==="auto"?"detected":"requested",durationSeconds,segments,provider:this.name,model:this.model,revision:this.expectedHash,engineVersion:this.engineVersion,modelSha256:this.expectedHash,requestId:null,estimatedExternalCostUsd:0,diarization:false},durationSeconds);
  }
}
