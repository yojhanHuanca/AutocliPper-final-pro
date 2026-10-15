import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile,writeFile,stat} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {PutObjectCommand,type S3Client} from "@aws-sdk/client-s3";
import type {MediaConfig} from "@autoclipper/configuration";
import {splitSourceError,type ValidatedProcessingSpec,type ProcessingArtifact,type ProcessingStatus} from "@autoclipper/api-contracts";
import {InspectionError} from "../domain/inspection.js";
import {validateProcessingSource,subtitles,outputPrefix} from "../domain/processing.js";
import {videoFilter} from "../domain/video-filter.js";
import {splitScreenPlan} from "../domain/split-screen-filter.js";
import {withInspectedSource,probeLocal} from "./probe.js";

const execute=promisify(execFile);
type RenderJob={id:string;workspaceId:string;spec:ValidatedProcessingSpec};
type InspectedSource=Parameters<typeof withInspectedSource>[2];
export async function produceDerivative(s3:S3Client,config:MediaConfig,job:RenderJob,source:InspectedSource,signal:AbortSignal,secondary?:InspectedSource):Promise<NonNullable<ProcessingStatus["result"]>> {
  if(source.workspaceId!==job.workspaceId||(secondary&&secondary.workspaceId!==job.workspaceId))throw new InspectionError("INVALID_SOURCE_WORKSPACE",false);
  if(job.spec.kind==="clip"&&job.spec.splitScreen&&(!secondary?.expectedSha256||!source.expectedSha256||source.expectedBytes+secondary.expectedBytes>104857600))throw new InspectionError("SPLIT_INPUT_LIMIT",false);
  return withInspectedSource(s3,config,source,async(_path,directory,metadata)=>{
    validateProcessingSource(job.spec,metadata);
    if(job.spec.kind==="clip"&&job.spec.splitScreen){
      if(!secondary)throw new InspectionError("SOURCE_NOT_VALIDATED",false);
      const spec=job.spec;
      return withInspectedSource(s3,config,secondary,async(path,_secondDirectory,secondMetadata)=>{
        const error=splitSourceError(spec,metadata,secondMetadata,source.expectedBytes,secondary.expectedBytes);if(error)throw new InspectionError(error,false);
        return renderInspected(s3,config,job,directory,metadata,signal,{path,metadata:secondMetadata});
      },signal);
    }
    if(secondary)throw new InspectionError("INVALID_SPLIT_SPEC",false);
    return renderInspected(s3,config,job,directory,metadata,signal);
  },signal);
}
async function renderInspected(s3:S3Client,config:MediaConfig,job:RenderJob,directory:string,metadata:Awaited<ReturnType<typeof probeLocal>>,signal:AbortSignal,secondary?:{path:string;metadata:Awaited<ReturnType<typeof probeLocal>>}):Promise<NonNullable<ProcessingStatus["result"]>>{
    const spec=job.spec;
    const limit=spec.kind==="audio"?134217728:67108864;
    const output=spec.kind==="audio"?"audio.wav":"clip.mp4";
    const common=["-hide_banner","-loglevel","error","-nostdin","-y","-max_alloc","67108864","-threads","1","-filter_threads","1","-protocol_whitelist","file","-format_whitelist","mov,matroska,webm","-i","source.media","-map_metadata","-1"];
    let args:string[];
    let composite:ReturnType<typeof splitScreenPlan>|undefined;
    const files:{name:string;kind:ProcessingArtifact["kind"];contentType:ProcessingArtifact["contentType"]}[]=[];
    if(spec.kind==="audio") {
      args=[...common,"-map","0:a:0","-vn","-af","aresample=16000:async=1:first_pts=0,apad","-ac","1","-ar","16000","-c:a","pcm_s16le","-t",String(metadata.durationSeconds),"-fs",String(limit),output];
      files.push({name:output,kind:"audio",contentType:"audio/wav"});
    } else {
      common.splice(common.indexOf("-i"),0,"-ss",String(spec.startSeconds));
      const filter=videoFilter(spec);
      if(spec.splitScreen&&secondary){
        composite=splitScreenPlan(spec);
        common.splice(0,0,"-filter_complex_threads","1");
        common.splice(common.indexOf("-map_metadata"),0,"-ss",String(spec.splitScreen.startSeconds),"-threads","1","-protocol_whitelist","file","-format_whitelist","mov,matroska,webm","-i",resolve(secondary.path));
      }
      if(spec.subtitles) {
        const text=subtitles(spec);
        await writeFile(join(directory,"captions.srt"),text.srt,{mode:0o600,flag:"wx"});
        await writeFile(join(directory,"captions.vtt"),text.vtt,{mode:0o600,flag:"wx"});
        files.push({name:"captions.srt",kind:"srt",contentType:"application/x-subrip"},{name:"captions.vtt",kind:"vtt",contentType:"text/vtt"});
      }
      const mapping=composite?["-filter_complex",composite.filter,"-map","[video]",...(composite.audioInput===null?["-an"]:["-map","[audio]"])]:["-map","0:v:0","-map","0:a:0?","-vf",filter];
      args=[...common,"-t",String(spec.endSeconds-spec.startSeconds),...mapping,"-sn","-dn","-r","30","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p","-threads","1","-b:v","1800k","-maxrate","2000k","-bufsize","4000k","-c:a","aac","-b:a","128k","-movflags","+faststart","-fs",String(limit),output];
      files.unshift({name:output,kind:"video",contentType:"video/mp4"});
    }
    try {
      await execute(config.FFMPEG_PATH,args,{cwd:directory,shell:false,windowsHide:true,maxBuffer:65536,timeout:config.RENDER_TIMEOUT_MS,killSignal:"SIGKILL",signal});
    } catch {
      if(signal.aborted)throw new InspectionError("CANCELLED",false);
      throw new InspectionError("FFMPEG_FAILED_OR_TIMEOUT",false);
    }
    const duration=spec.kind==="audio"?metadata.durationSeconds:spec.endSeconds-spec.startSeconds;
    const result:NonNullable<ProcessingStatus["result"]>={artifacts:[],durationSeconds:duration};
    if(spec.kind==="clip") {
      const actual=await probeLocal(join(directory,output),config,signal);
      if(Math.abs(actual.durationSeconds-duration)>0.3)throw new InspectionError("INVALID_RENDER_OUTPUT",false);
      if(composite&&(actual.width!==composite.width||actual.height!==composite.height||(composite.audioInput===null?actual.audioCodec!==null:actual.audioCodec!=="aac")))throw new InspectionError("INVALID_RENDER_OUTPUT",false);
      result.durationSeconds=actual.durationSeconds;result.width=actual.width;result.height=actual.height;
    } else {
      const actual=await execute(config.FFPROBE_PATH,["-v","error","-protocol_whitelist","file","-show_entries","format=duration:stream=codec_name,sample_rate,channels","-of","json",output],{cwd:directory,shell:false,windowsHide:true,timeout:config.PROBE_TIMEOUT_MS,maxBuffer:65536,signal});
      const value=JSON.parse(actual.stdout) as {format?:{duration?:string};streams?:{codec_name?:string;sample_rate?:string;channels?:number}[]};
      if(!Number.isFinite(Number(value.format?.duration))||Math.abs(Number(value.format?.duration)-duration)>0.2||value.streams?.[0]?.codec_name!=="pcm_s16le"||value.streams[0].sample_rate!=="16000"||value.streams[0].channels!==1)throw new InspectionError("INVALID_AUDIO_OUTPUT",false);
      result.sampleRate=16000;result.durationSeconds=Number(value.format?.duration);
    }
    for(const file of files) {
      if(signal.aborted)throw new InspectionError("CANCELLED",false);
      const path=join(directory,file.name),info=await stat(path);
      if(info.size<=0||info.size>limit)throw new InspectionError("OUTPUT_SIZE_LIMIT",false);
      const bytes=await readFile(path),sha256=createHash("sha256").update(bytes).digest("hex");
      const objectKey=outputPrefix(job.workspaceId,job.id)+file.name;
      const stored=await s3.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:objectKey,Body:bytes,ContentType:file.contentType,ContentLength:bytes.length,ChecksumSHA256:Buffer.from(sha256,"hex").toString("base64")}),{abortSignal:signal});
      if(!stored.ETag)throw new InspectionError("STORAGE_RECEIPT_MISSING",true);
      result.artifacts.push({kind:file.kind,objectKey,bytes:bytes.length,sha256,etag:stored.ETag,contentType:file.contentType});
    }
    return result;
}
