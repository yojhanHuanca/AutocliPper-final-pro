import {AnalysisError} from "../domain/transcript.js";

/** Kept as a compatibility guard so stale selections fail without contacting Ollama. */
export class OllamaSelector {
  readonly provider="ollama" as const;
  readonly revision="unsupported";
  readonly promptVersion="segment-selection-v1";

  constructor(_transport?:typeof fetch){void _transport;}

  maximumCostUsd(_inputBytes:number){void _inputBytes;return 0;}
  async diagnostics(){
    return{configured:false,status:"unsupported" as const,code:"SELECTION_PROVIDER_NOT_SUPPORTED",missingSettings:["AI_ANALYSIS_PROVIDER"],nextSteps:["Ollama is not a supported selector. Select OpenAI (default) or Gemini."]};
  }
  async configured(){return false;}
  async select(){throw new AnalysisError("SELECTION_PROVIDER_NOT_SUPPORTED");}
}
