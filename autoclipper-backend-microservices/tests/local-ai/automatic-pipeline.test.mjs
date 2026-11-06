import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analysisSpec} from '@autoclipper/api-contracts';
import {AnalysisRuntime,selectionProviderFromEnvironment} from '../../apps/autoclipper-content-analysis-service/dist/application/analysis-runtime.js';
import {OllamaSelector} from '../../apps/autoclipper-content-analysis-service/dist/infrastructure/ollama.js';
import {OpenAISelector} from '../../apps/autoclipper-content-analysis-service/dist/infrastructure/openai-selector.js';
import {GeminiSelector} from '../../apps/autoclipper-content-analysis-service/dist/infrastructure/gemini-selector.js';

test('Ollama is rejected as a selection provider without contacting Ollama, OpenAI or Gemini',async t=>{
  const keys=['AI_ANALYSIS_PROVIDER','OLLAMA_URL','OLLAMA_MODEL','OLLAMA_MODEL_SHA256','OPENAI_API_KEY','OPENAI_MODEL','OPENAI_INPUT_USD_PER_MILLION_TOKENS','OPENAI_OUTPUT_USD_PER_MILLION_TOKENS','GEMINI_API_KEY','GEMINI_MODEL','GEMINI_INPUT_USD_PER_MILLION_TOKENS','GEMINI_OUTPUT_USD_PER_MILLION_TOKENS','PAID_AI_ENABLED','AI_MAX_ESTIMATED_USD_PER_JOB'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys){const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  Object.assign(process.env,{AI_ANALYSIS_PROVIDER:'ollama',OLLAMA_URL:'http://127.0.0.1:11434',OLLAMA_MODEL:'qwen3:0.6b',OLLAMA_MODEL_SHA256:'a'.repeat(64),OPENAI_API_KEY:'fixture-only-openai-key',OPENAI_MODEL:'gpt-4o-mini',OPENAI_INPUT_USD_PER_MILLION_TOKENS:'0.15',OPENAI_OUTPUT_USD_PER_MILLION_TOKENS:'0.60',GEMINI_API_KEY:'fixture-only-gemini-key',GEMINI_MODEL:'gemini-2.5-flash',GEMINI_INPUT_USD_PER_MILLION_TOKENS:'0.15',GEMINI_OUTPUT_USD_PER_MILLION_TOKENS:'0.60',PAID_AI_ENABLED:'true',AI_MAX_ESTIMATED_USD_PER_JOB:'1'});

  let ollamaCalls=0,openaiCalls=0,geminiCalls=0;
  const ollama=new OllamaSelector(async()=>{ollamaCalls++;throw new Error('Ollama request prohibited');});
  const openai=new OpenAISelector(async()=>{openaiCalls++;throw new Error('OpenAI fallback prohibited');});
  const gemini=new GeminiSelector(async()=>{geminiCalls++;throw new Error('Gemini fallback prohibited');});
  const runtime=Object.create(AnalysisRuntime.prototype);
  runtime.selectionProvider=selectionProviderFromEnvironment();runtime.selector=undefined;runtime.ollamaSelector=ollama;runtime.openaiSelector=openai;runtime.geminiSelector=gemini;
  runtime.whisper={diagnostics:async()=>({configured:true,code:null})};runtime.deepgram={approved:false,unitPrice:0,budget:1};
  runtime.providers={whisper_cpp:{configured:async()=>true},deepgram:{configured:async()=>true}};
  const spec=analysisSpec.parse({version:1,provider:'whisper_cpp',selection:{mode:'llm',count:1,minSeconds:1,maxSeconds:30}});

  const diagnostic=await runtime.capabilities();
  assert.equal(diagnostic.selection.provider,'ollama');
  assert.equal(diagnostic.selection.ollama.configured,false);
  assert.equal(diagnostic.selection.ollama.diagnostic.code,'SELECTION_PROVIDER_NOT_SUPPORTED');
  assert.deepEqual(await runtime.preflight(spec,60),{ready:false,code:'SELECTION_PROVIDER_NOT_SUPPORTED',httpStatus:503});
  await assert.rejects(ollama.select({segments:[],durationSeconds:1},{mode:'llm',count:1,minSeconds:1,maxSeconds:1},new globalThis.AbortController().signal),error=>error.code==='SELECTION_PROVIDER_NOT_SUPPORTED');
  assert.deepEqual({ollamaCalls,openaiCalls,geminiCalls},{ollamaCalls:0,openaiCalls:0,geminiCalls:0});
});
