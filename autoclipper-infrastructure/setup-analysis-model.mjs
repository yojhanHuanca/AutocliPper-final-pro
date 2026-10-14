import {mkdir,readFile,rename,rm,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const revision='5359861c739e955e79d9a303bcbc70fb988958b1';
const sha256='be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21';
const bytes=77691713;
const directory=new URL('../.local/models/',import.meta.url),target=new URL('ggml-tiny.bin',directory);
await mkdir(directory,{recursive:true});
try{const existing=await readFile(target);if(existing.length===bytes&&createHash('sha256').update(existing).digest('hex')===sha256){console.log('Pinned whisper.cpp tiny model already verified (77,691,713 bytes).');process.exit(0);}}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Downloading only the opt-in multilingual tiny model (74.1 MiB; upstream estimates ~273 MB model memory).');
const temporary=new URL(`ggml-tiny.${randomUUID()}.part`,directory),handle=await open(temporary,'wx',0o600);
try{
  const response=await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-tiny.bin`,{signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw new Error('Model download failed');
  let count=0;const hash=createHash('sha256');
  for await(const chunk of response.body){count+=chunk.length;if(count>bytes)throw new Error('Model size exceeded');hash.update(chunk);await handle.write(chunk);}
  if(count!==bytes||hash.digest('hex')!==sha256)throw new Error('Model checksum mismatch');
  await handle.close();await rename(temporary,target);console.log('Model verified and installed outside Git. No LLM model downloaded.');
}finally{await handle.close().catch(()=>{});await rm(temporary,{force:true});}
