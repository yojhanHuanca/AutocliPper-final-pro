import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile,writeFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {PutObjectCommand,type S3Client} from "@aws-sdk/client-s3";
import type {MediaConfig} from "@autoclipper/configuration";
import type {ValidatedProcessingSpec,ProcessingArtifact,ProcessingStatus} from "@autoclipper/api-contracts";
import {InspectionError} from "../domain/inspection.js";
import {validateProcessingSource,subtitles,outputPrefix} from "../domain/processing.js";
import {withInspectedSource,probeLocal} from "./probe.js";

const execute=promisify(execFile);
export async function produceDerivative(s3:S3Client,config:MediaConfig,job:{id:string;workspaceId:string;spec:ValidatedProcessingSpec},source:Parameters<typeof withInspectedSource>[2],signal:AbortSignal):Promise<NonNullable<ProcessingStatus["result"]>> {
  return withInspectedSource(s3,config,source,async(_path,directory,metadata)=>{
    validateProcessingSource(job.spec,metadata);
    const spec=job.spec;
    const limit=spec.kind==="audio"?134217728:67108864;
    const output=spec.kind==="audio"?"audio.wav":"clip.mp4";
    const common=["-hide_banner","-loglevel","error","-nostdin","-y","-max_alloc","67108864","-threads","1","-filter_threads","1","-protocol_whitelist","file","-format_whitelist","mov,matroska,webm","-i","source.media","-map_metadata","-1"];
    let args:string[];
    const files:{name:string;kind:ProcessingArtifact["kind"];contentType:ProcessingArtifact["contentType"]}[]=[];
    if(spec.kind==="audio") {
      args=[...common,"-map","0:a:0","-vn","-af","aresample=16000:async=1:first_pts=0,apad","-ac","1","-ar","16000","-c:a","pcm_s16le","-t",String(metadata.durationSeconds),"-fs",String(limit),output];
      files.push({name:output,kind:"audio",contentType:"audio/wav"});
    } else {
      common.splice(common.indexOf("-i"),0,"-ss",String(spec.startSeconds));
      const dimensions={vertical:[720,1280],square:[720,720],horizontal:[1280,720]} as const;
      const size=spec.aspect==="source"?undefined:dimensions[spec.aspect];
      let filter=size?`scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase,crop=${size[0]}:${size[1]},setsar=1`:"scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
      if(spec.subtitles) {
        const text=subtitles(spec);
        await writeFile(join(directory,"captions.srt"),text.srt,{mode:0o600,flag:"wx"});
        await writeFile(join(directory,"captions.vtt"),text.vtt,{mode:0o600,flag:"wx"});
        filter+=",subtitles=filename=captions.srt:force_style='FontName=DejaVu Sans,FontSize=24,Outline=2,MarginV=32'";
        files.push({name:"captions.srt",kind:"srt",contentType:"application/x-subrip"},{name:"captions.vtt",kind:"vtt",contentType:"text/vtt"});
      }
      args=[...common,"-t",String(spec.endSeconds-spec.startSeconds),"-map","0:v:0","-map","0:a:0?","-sn","-dn","-vf",filter,"-r","30","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p","-threads","1","-b:v","1800k","-maxrate","2000k","-bufsize","4000k","-c:a","aac","-b:a","128k","-movflags","+faststart","-fs",String(limit),output];
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
      const actual=await probeLocal(join(directory,output),config);
      if(Math.abs(actual.durationSeconds-duration)>0.3)throw new InspectionError("INVALID_RENDER_OUTPUT",false);
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
  },signal);
}
