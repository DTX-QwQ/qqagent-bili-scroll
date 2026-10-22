import path from 'node:path';

export function createConsoleClient({fetch,getConfig,dataDir}){
  let base='';
  const headers=()=>{const token=getConfig().server?.token;return token?{'x-console-token':token}:{};};
  const sameDirectory=value=>typeof value==='string'&&path.resolve(value).toLowerCase()===path.resolve(dataDir).toLowerCase();
  async function discover(signal){
    // This client lives inside the server process: its listening port does not expire
    // while AI reviews are running. Re-scan only after a transport failure.
    if(base)return base;
    const configured=Number(getConfig().server?.port)||3210,failures=[];
    const scanSignal=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(25000)]);
    for(let port=configured;port<configured+10;port++){
      signal?.throwIfAborted();if(scanSignal.aborted)break;
      const candidate='http://127.0.0.1:'+port;
      try{
        const r=await fetch(candidate+'/api/status',{headers:headers(),redirect:'error',signal:AbortSignal.any([scanSignal,AbortSignal.timeout(10000)])});
        if(!r.ok){failures.push(`${port}: HTTP ${r.status}`);continue;}
        const s=await r.json();
        if(!sameDirectory(s.dataDir)){failures.push(`${port}: 数据目录不匹配，拒绝连接其他实例`);continue;}
        base=candidate;return base;
      }catch(e){
        signal?.throwIfAborted();
        failures.push(`${port}: ${e.name==='TimeoutError'?'控制台响应超时':e.cause?.code||e.code||e.name||'连接失败'}`);
        if(scanSignal.aborted)break;
      }
    }
    throw new Error('找不到当前 QQ Agent 控制台（'+failures.join('；')+'）');
  }
  async function request(route,{signal,body,method='GET',timeout=15000}={}){
    signal?.throwIfAborted();const endpoint=await discover(signal);let r;
    try{
      r=await fetch(endpoint+route,{method,headers:{...headers(),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(timeout)])});
    }catch(e){
      if(base===endpoint&&!signal?.aborted)base='';
      signal?.throwIfAborted();
      // In particular, never retry a POST: the server may already have sent it.
      throw new Error(`QQ Agent 控制台连接失败（${e.name==='TimeoutError'?'响应超时':e.cause?.code||e.code||e.name||'网络异常'}）；本次请求未自动重试`);
    }
    let j;try{j=await r.json();}catch{throw new Error(`QQ Agent 控制台返回非 JSON（HTTP ${r.status}）`);}
    if(!r.ok)throw new Error(j.error||`QQ Agent HTTP ${r.status}`);return j;
  }
  return {request};
}
