import {createWriteStream} from "node:fs";
import {mkdir,mkdtemp,chmod,rm} from "node:fs/promises";
import {join} from "node:path";
import {Transform,type Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createHash} from "node:crypto";
import {HeadObjectCommand,GetObjectCommand,type S3Client} from "@aws-sdk/client-s3";
import {AnalysisError} from "../domain/transcript.js";
export type AudioSource={audioProcessingId:string;objectKey:string;expectedBytes:number;expectedEtag:string;expectedSha256:string;durationSeconds:number};
export async function withAudio<T>(s3:S3Client,bucket:string,tempRoot:string,workspaceId:string,source:AudioSource,signal:AbortSignal,work:(path:string)=>Promise<T>):Promise<T>{
  if(source.objectKey!==`workspaces/${workspaceId}/media/derivatives/${source.audioProcessingId}/audio.wav`)throw new AnalysisError("INVALID_AUDIO_SCOPE");
  await mkdir(tempRoot,{recursive:true});const directory=await mkdtemp(join(tempRoot,"analysis-"));await chmod(directory,0o700);
  try{
    const abort=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
    const actual=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:source.objectKey}),{abortSignal:abort});
    if(actual.ContentLength!==source.expectedBytes||actual.ETag!==source.expectedEtag)throw new AnalysisError("AUDIO_OBJECT_CHANGED");
    const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:source.objectKey,IfMatch:source.expectedEtag}),{abortSignal:abort});
    if(!object.Body)throw new AnalysisError("EMPTY_AUDIO_OBJECT");
    let bytes=0;const hash=createHash("sha256"),path=join(directory,"audio.wav");
    const counter=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;hash.update(chunk);callback(bytes>source.expectedBytes?new AnalysisError("AUDIO_SIZE_LIMIT"):null,chunk);}});
    await pipeline(object.Body as Readable,counter,createWriteStream(path,{flags:"wx",mode:0o600}),{signal:abort});
    if(bytes!==source.expectedBytes||hash.digest("hex")!==source.expectedSha256)throw new AnalysisError("AUDIO_CHECKSUM_MISMATCH");
    return await work(path);
  }finally{await rm(directory,{recursive:true,force:true});}
}
