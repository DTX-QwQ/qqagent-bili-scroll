import {SendQueue} from '../../src/sender.js';
const {ids}=await import(new URL('./core.js'+new URL(import.meta.url).search,import.meta.url));
const {createConsoleClient}=await import(new URL('./console.js'+new URL(import.meta.url).search,import.meta.url));

export function eligibility(uid,cfg){
  const deny=cfg.deny?.private||cfg.deny?.privates||[];
  const allow=cfg.allow?.private||cfg.allow?.privates||[];
  if(deny.map(String).includes(uid))return 'QQ Agent 主程序黑名单拦截';
  if(allow.length?!allow.map(String).includes(uid):cfg.allowAllWhenEmpty!==true)return '不在 QQ Agent 主程序私聊白名单';
  return '';
}
export function createHost({fetch,getHostConfig,getPluginConfig,dataDir,coordinator,isActive}){
  const signals=new Map();
  const {request}=createConsoleClient({fetch,getConfig:getHostConfig,dataDir});
  async function ready(signal,uid){
    signal?.throwIfAborted();if(!isActive())throw new Error('插件已禁用');
    const s=await request('/api/status',{signal});if(s.paused)throw new Error('QQ Agent 已暂停');
    if(uid){if(!getPluginConfig().qqEnabled||!ids(getPluginConfig().qqWhitelist).includes(uid))throw new Error('接收人已从插件白名单移除或转发已关闭');const reason=eligibility(uid,getHostConfig());if(reason)throw new Error(reason);if(!s.onebot?.connected)throw new Error('QQ 尚未连接'+(s.onebot?.diagnosis?'：'+s.onebot.diagnosis:''));}
    return s;
  }
  const queue=new SendQueue({onebot:{async sendText(kind,uid,text){
    if(kind!=='private')throw new Error('只允许私聊转发');const signal=signals.get(uid);await ready(signal,uid);signal?.throwIfAborted();
    const r=await request(`/api/chats/private_${uid}/test-send`,{signal,method:'POST',body:{text},timeout:90000});if(r.ok!==true||r.messageId==null)throw new Error('QQ 没有返回消息编号');return {message_id:r.messageId};
  }},store:{appendSelf(){}},log:()=>{}}); // Host endpoint writes to the live ChatStore exactly once.
  async function send(uid,text,signal){
    await ready(signal,uid);const prior=coordinator.sendChain||Promise.resolve();
    const task=prior.catch(()=>{}).then(async()=>{signal.throwIfAborted();await ready(signal,uid);signals.set(uid,signal);try{const r=await queue.sendTextBatch('private:'+uid,[text]);if(r.failed?.length||!r.sent?.length||r.sent.some(x=>x.messageId==null))throw new Error('QQ 消息未完整确认');return {messageId:r.sent[0].messageId};}finally{signals.delete(uid);}});
    coordinator.sendChain=task.catch(()=>{});return task;
  }
  async function health(signal){
    const [s,k,t]=await Promise.all([request('/api/status',{signal}),request('/api/skills',{signal}),request('/api/tools/availability',{signal})]);
    const skill=k.skills?.find(x=>x.id==='bili-browse'),tool=t.tools?.find(x=>x.id==='bili-browse__browse');
    return {qq:{connected:s.onebot?.connected===true,paused:s.paused===true,reason:s.paused?'QQ Agent 已暂停':s.onebot?.connected?'':s.onebot?.diagnosis||s.onebot?.error||'QQ 尚未连接'},chat:{installed:Boolean(skill),active:skill?.active===true,toolEnabled:tool?.enabled===true,reason:!skill?'缺少「聊天逛 B 站」技能，请安装配套技能包':!skill.active?skill.reason||'聊天技能未生效':!tool?'聊天技能未注册启动工具':!tool.enabled?tool.reason||'聊天工具被全局、分类或单工具开关禁用':''}};
  }
  return {request,ready,send,health,saveSettings:settings=>request('/api/skills/bili-scroll',{method:'POST',body:{settings}}),recipients:()=>ids(getPluginConfig().qqWhitelist).map(uid=>({uid,error:eligibility(uid,getHostConfig())}))};
}
