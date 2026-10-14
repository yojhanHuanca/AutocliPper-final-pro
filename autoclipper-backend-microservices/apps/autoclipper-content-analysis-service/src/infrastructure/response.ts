import {AnalysisError} from "../domain/transcript.js";
export async function boundedText(response:Response,limit:number){
  const reader=response.body?.getReader();if(!reader)throw new AnalysisError("INVALID_SELECTION_RESPONSE");
  const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const value=await reader.read();if(value.done)break;bytes+=value.value.length;if(bytes>limit)throw new AnalysisError("INVALID_SELECTION_RESPONSE");chunks.push(value.value);}return Buffer.concat(chunks).toString("utf8");}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
