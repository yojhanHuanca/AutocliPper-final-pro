import type {Redis} from "ioredis";
import {AnalysisError} from "../domain/transcript.js";

export const MAX_OPENAI_INVOCATIONS_PER_RUN=5;
const BUDGET_TTL_SECONDS=7*24*60*60;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INCREMENT_ONCE="local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count";

export type OpenAIInvocationBudgetConfig={configured:boolean;limit:number;budgetId:string};
export type OpenAIInvocationBudgetStore=Pick<Redis,"eval">;

export function openAIInvocationBudgetConfig(env:NodeJS.ProcessEnv=process.env):OpenAIInvocationBudgetConfig{
  const limit=Number(env["OPENAI_MAX_API_INVOCATIONS_PER_RUN"]??0),budgetId=env["OPENAI_INVOCATION_BUDGET_ID"]?.trim()??"";
  return{configured:Number.isSafeInteger(limit)&&limit>=1&&limit<=MAX_OPENAI_INVOCATIONS_PER_RUN&&UUID.test(budgetId),limit,budgetId};
}

export async function reserveOpenAIInvocation(store:OpenAIInvocationBudgetStore,env:NodeJS.ProcessEnv=process.env){
  const budget=openAIInvocationBudgetConfig(env);
  if(!budget.configured)throw new AnalysisError("OPENAI_INVOCATION_BUDGET_MISCONFIGURED");
  const count=Number(await store.eval(INCREMENT_ONCE,1,`analysis:openai-invocation-budget:${budget.budgetId}`,String(BUDGET_TTL_SECONDS)));
  if(!Number.isSafeInteger(count)||count<1)throw new AnalysisError("OPENAI_INVOCATION_BUDGET_UNAVAILABLE");
  if(count>budget.limit)throw new AnalysisError("OPENAI_INVOCATION_LIMIT_REACHED");
  return count;
}
