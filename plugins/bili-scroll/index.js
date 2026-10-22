import path from 'node:path';
import {getConfig,DATA_DIR,personaForChat} from '../../src/config.js';
import {chatCompletionWithRetry} from '../../src/llm.js';
const suffix=new URL(import.meta.url).search;
const {Engine}=await import(new URL('./engine.js'+suffix,import.meta.url));
const {Bilibili}=await import(new URL('./bilibili.js'+suffix,import.meta.url));
const {createHost,eligibility}=await import(new URL('./host.js'+suffix,import.meta.url));
const {createPanel}=await import(new URL('./panel.js'+suffix,import.meta.url));
const coordinator=globalThis[Symbol.for('qq-agent.bili-scroll.coordinator')]||={busy:false};
let api,engine,panel,bili,host,lifecycle=0;
function persona(scope={}){
  let p=personaForChat(scope.chatKey);
  if(scope.triggerEntries){const owner=api.capability('message.owner-check',{triggerEntries:scope.triggerEntries,kind:scope.kind,selfId:scope.selfId,persona:p});if(owner?.persona)p=owner.persona;}
  return {botName:String(p?.botName||''),roleText:String(p?.roleText||''),customRules:String(p?.customRules||''),systemPromptOverride:String(p?.systemPromptOverride||'')};
}
function authorizeChat(ctx,uid){
  const cfg=getConfig();if(cfg.security?.browseLock?.enabled===true)throw new Error('QQ Agent 联网锁已开启');
  if(ctx.kind==='private'){const reason=eligibility(uid,cfg);if(reason)throw new Error(reason);}
  else if(ctx.kind==='group'){
    const id=String(ctx.chatId||''),deny=(cfg.deny?.group||cfg.deny?.groups||[]).map(String),allow=(cfg.allow?.group||cfg.allow?.groups||[]).map(String);
    if(ctx.chatKey!=='group:'+id||deny.includes(id)||(allow.length?!allow.includes(id):cfg.allowAllWhenEmpty!==true))throw new Error('QQ Agent 主程序群聊权限拦截');
  }else throw new Error('未知会话类型');
}
export function setup(a){
  api=a;const dir=path.join(DATA_DIR,'bili-scroll');
  bili=new Bilibili({fetch:a.fetch,dir,check:()=>{if(getConfig().security?.browseLock?.enabled===true)throw new Error('QQ Agent 联网锁已开启');}});
  host=createHost({fetch:a.fetch,getHostConfig:getConfig,getPluginConfig:a.config,dataDir:DATA_DIR,coordinator,isActive:()=>engine?.active===true&&a.isSkillActive('bili-scroll')});
  engine=new Engine({dir,getConfig:a.config,bili,getPersona:persona,authorizeChat,send:host.send,ready:host.ready,coordinator,log:m=>a.warn(m),complete:async(messages,signal)=>{
    const r=await chatCompletionWithRetry({messages,tools:null,toolChoice:'none',maxTokens:5000,temperature:0.65,signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),skillContext:{purpose:'bili-scroll',thinkingMode:'off'}},0);
    if(r.finishReason==='length')throw new Error('AI 输出被截断');const content=r.message?.content;if(typeof content!=='string'||!content.trim())throw new Error('AI 未返回筛选结果');return content;
  }});
  panel=createPanel({engine,bili,host,getConfig:a.config,getStatus:()=>a.capability('bili.scroll-status'),dir,log:m=>a.log(m)});
  a.log('刷 B 站已加载；原生设置与独立面板使用同一配置；无本地转写依赖。');
}
export async function activate(){
  const generation=++lifecycle;
  await coordinator.closing;
  await coordinator.done;
  if(generation!==lifecycle)return;
  engine.start();try{await panel.start();}catch(e){engine.lastError='面板无法启动：'+e.message;api.error(engine.lastError);}
}
export function deactivate(){lifecycle++;engine?.stop();coordinator.closing=panel?.stop();return coordinator.closing;}
export function dispose(){return deactivate();}
// Consumed by the local panel through the host capability registry.
export const providers={'bili.scroll-status':()=>engine?.status()||{active:false,phase:'未初始化'},'bili.scroll-run':({ctx})=>engine.trigger(ctx)};
export const internals={engine:()=>engine,bili:()=>bili,host:()=>host};
