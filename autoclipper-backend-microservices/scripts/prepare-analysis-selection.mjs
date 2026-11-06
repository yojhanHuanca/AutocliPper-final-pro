import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function prepareAnalysisSelection(){
  throw new Error('Ollama is not a supported analysis selection provider. Select OpenAI (default) or Gemini.');
}

const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  try{
    await prepareAnalysisSelection();
  }catch(error){
    console.error(error instanceof Error?error.message:'Analysis selection provider is unsupported.');
    process.exitCode=1;
  }
}
