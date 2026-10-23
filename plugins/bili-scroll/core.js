import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {topics:'',qqWhitelist:'',autoEnabled:false,runTimes:'12:30',timeZone:'Asia/Shanghai',maxDaily:3,maxPerRun:3,maxStoryboards:3,chatEnabled:true,maxCandidates:12,recentDays:7,minScore:75,qqEnabled:false,commentEnabled:false,mentionUid:'',mentionName:'',maxComments:1,reportMode:'完整',extraPrompt:'',panelPort:3219};
export const fields = {
  topics:['string','关注关键词','换行或逗号分隔；为空时等待配置，不擅自选择主题。',true],
  qqWhitelist:['string','QQ 转发白名单','独立维护，一行一个 QQ 号；为空时不发给任何人。宿主黑白名单仍是最终发送边界。',true],
  autoEnabled:['boolean','定时刷 B 站','打开后按下方时间运行；QQ Agent 需要保持运行。'],
  runTimes:['string','每天运行时间','北京时间，24 小时制；多个时间用逗号分隔，如 12:30,20:30。'],
  timeZone:['string','时区','默认 Asia/Shanghai。'],maxDaily:['number','每天自动推荐上限','0 = 不自动运行；聊天主动触发不占用也不受此额度限制。'],
  maxPerRun:['number','每轮精选几条','1–10；逐条审核全部完成后按评分选优，聊天触发也使用此上限。'],
  maxStoryboards:['number','每视频最多抽帧拼图','1–8；均匀选取 B 站原生拼图并以图片传给模型，超过时明确标记抽样范围。'],
  chatEnabled:['boolean','允许聊天立即逛 B 站','白名单用户可说“去逛逛B站”；消息指定主题时仅本轮覆盖，未指定则用配置关键词。不受定时开关及每日自动额度限制。'],
  maxCandidates:['number','每轮批量初筛候选数','1–40；先统一淘汰不合适的视频，再逐条审字幕与抽帧拼图。'],recentDays:['number','搜索最近几天','1–30。'],minScore:['number','推荐评分门槛','0–100，AI 结合人设、字幕和抽帧拼图判断。'],
  qqEnabled:['boolean','QQ 私聊分享','向本插件白名单发送推荐及每轮一段简短 AI 总结；合并相似原因，略过低价值内容，零推荐也告知结束。'],
  commentEnabled:['boolean','B 站评论并 @','使用扫码登录的账号，在推荐视频下发表评论。'],
  mentionUid:['string','要 @ 的 B 站 UID','可填写 UID 或昵称之一；两者都填时会校验是否属于同一用户。'],
  mentionName:['string','要 @ 的 B 站昵称','昵称精确匹配，重名或查不到时停止评论。'],
  maxComments:['number','每轮最多评论几条','1–5；同一视频只尝试评论一次，结果不明确时不自动重发。'],
  reportMode:['enum','日报详细程度','完整 / 薄版 / 不写。'],extraPrompt:['string','视频筛选偏好','如偏好实操教程、跳过营销；只影响筛选，不会读取私人聊天或记忆。',true],
  panelPort:['number','操作面板端口','扫码登录、立即运行、查看日报：http://127.0.0.1:3219/ 。修改端口后关闭再开启插件。']
};
export const schema=Object.fromEntries(Object.entries(fields).map(([k,[type,label,description,multiline]])=>[k,{type,label,description,...(multiline?{multiline:true}:{}),...(type==='enum'?{values:['完整','薄版','不写']}: {})}]));
export function ids(value){
  const parts=String(value||'').split(/[\s,，;；]+/).filter(Boolean);
  if(parts.some(x=>! /^[1-9]\d{4,11}$/.test(x)))throw new Error('QQ 白名单只能填写 5–12 位 QQ 号，用换行或逗号分隔');
  if(parts.length>50)throw new Error('QQ 白名单最多 50 人');
  return [...new Set(parts)];
}
export function configOf(raw={}){
  const c={...DEFAULTS,...raw};ids(c.qqWhitelist);
  for(const [key,min,max] of [['maxDaily',0,20],['maxPerRun',1,10],['maxStoryboards',1,8],['maxCandidates',1,40],['recentDays',1,30],['minScore',0,100],['maxComments',1,5],['panelPort',1024,65535]]){
    if(!Number.isInteger(Number(c[key]))||Number(c[key])<min||Number(c[key])>max)throw new Error(`${fields[key][1]}必须为 ${min}–${max} 的整数`);c[key]=Number(c[key]);
  }
  for(const k of ['autoEnabled','qqEnabled','commentEnabled','chatEnabled'])if(typeof c[k]!=='boolean')throw new Error(`${fields[k][1]}必须为开关`);
  for(const k of ['topics','qqWhitelist','runTimes','timeZone','mentionUid','mentionName','reportMode','extraPrompt']){if(typeof c[k]!=='string')throw new Error(`${fields[k][1]}必须为文字`);c[k]=c[k].trim();}
  if(c.topics.length>2000||c.extraPrompt.length>2000)throw new Error('关键词或偏好文字过长');
  if(c.topics.split(/[\n,，]+/).filter(x=>x.trim()).length>20)throw new Error('关键词最多 20 个');
  if(c.mentionUid&&!/^[1-9]\d{0,15}$/.test(c.mentionUid))throw new Error('B 站 UID 必须为正整数');
  if(c.mentionName.length>60||/[\r\n@]/.test(c.mentionName))throw new Error('B 站昵称格式不正确');
  if(!['完整','薄版','不写'].includes(c.reportMode))throw new Error('日报格式不正确');
  new Intl.DateTimeFormat('en',{timeZone:c.timeZone}).format();
  const times=c.runTimes.split(/[,，\s]+/).filter(Boolean);
  if(!times.length||times.length>12||times.some(x=>! /^([01]\d|2[0-3]):[0-5]\d$/.test(x)))throw new Error('运行时间请填写 HH:mm，多个用逗号分隔');
  c.runTimes=[...new Set(times)].sort().join(',');return c;
}
export function clock(now,tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}
export function clean(text,max=300){return String(text||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\[CQ:[^\]]*\]/gi,'').trim().slice(0,max);}
export function parseDecision(raw){
  const x=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
  if(typeof x.recommend!=='boolean'||typeof x.score!=='number'||!Number.isFinite(x.score)||x.score<0||x.score>100)throw new Error('AI 返回了无效的推荐结果');
  const reason=clean(x.reason,250),summary=clean(x.summary,350);
  if(x.recommend&&(!reason||!summary))throw new Error('AI 推荐缺少字幕依据');
  return {recommend:x.recommend,score:x.score,reason,summary};
}
export function parseObject(raw){const x=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('AI 返回的不是 JSON 对象');return x;}
export function parseBatch(raw,list){
  const x=parseObject(raw);if(!Array.isArray(x.decisions)||x.decisions.length!==list.length)throw new Error('AI 批量初筛缺少候选结果');
  const allowed=new Set(list.map(v=>v.bvid)),seen=new Set();
  return x.decisions.map(d=>{if(!allowed.has(d.bvid)||seen.has(d.bvid)||typeof d.keep!=='boolean'||typeof d.reason!=='string'||!d.reason.trim())throw new Error('AI 批量初筛结果无效');seen.add(d.bvid);return {bvid:d.bvid,keep:d.keep,reason:clean(d.reason,250)};});
}
export function messageText(raw,{channel,url}={}){
  const x=parseObject(raw),text=x.text;
  if(typeof text!=='string'||!text.trim()||text.length>(channel==='qq'?900:500)||/[\u0000-\u0008\u000b-\u001f\u007f]|\[CQ:|<[^>]+>|@/i.test(text))throw new Error('AI 消息正文无效，已跳过，禁止使用程序文案兜底');
  const links=text.match(/https?:\/\/[^\s<>"“”‘’，。！？；）)】」』～]+/g)||[];
  if(channel==='qq'?(links.length!==1||![url,url?.replace(/\/$/,'')].includes(links[0])):links.length>0)throw new Error('AI 消息链接不符合要求：QQ消息须含指定视频链接且仅此一个，评论不含链接');
  return text.trim();
}
export function roundSummaryText(raw,videos,{status}={}){
  const text=parseObject(raw).text;
  if(typeof text!=='string'||!text.trim()||text.length>300||/[\u0000-\u0008\u000b-\u001f\u007f]|\[CQ:|<[^>]+>|@/i.test(text))throw new Error('AI 本轮总结正文无效，须为300字以内的简短总结');
  if(/[\r\n]|(?:^|\s)(?:[-*•]|\d+[、.)）])\s/.test(text.trim()))throw new Error('AI 总结须为一段自然口语，不要逐条列举或分段');
  if(!/本轮/.test(text)||!/结束|完成/.test(text))throw new Error('AI 总结未明确本轮已经结束');
  if(status==='done'&&/未正常完成|没正常完成|没有正常完成|本轮(?:运行|任务)?失败/.test(text))throw new Error('本轮正常结束，零推荐或无候选不能说未正常完成');
  if(!videos.length&&/标题|简介|字幕|画面|初筛|抽帧|观看/.test(text))throw new Error('本段没有候选，不得声称或讨论已进行标题初筛、字幕或画面审核，只需报告没有新候选及其原因');
  const allowed=new Set(videos.map(v=>v.bvid));
  if((text.match(/BV[a-zA-Z0-9]{10}/g)||[]).some(bvid=>!allowed.has(bvid)))throw new Error('AI 总结编造了候选视频');
  const links=text.match(/https?:\/\/[^\s<>"“”‘’，。！？；）)】」』～]+/g)||[];
  if(links.some(link=>![...allowed].some(bvid=>[ `https://www.bilibili.com/video/${bvid}`,`https://www.bilibili.com/video/${bvid}/`].includes(link))))throw new Error('AI 总结包含候选以外的链接');
  return text.trim();
}
export function requesterFromContext(ctx){
  const entries=ctx?.session?.trigger;if(!Array.isArray(entries)||!entries.length)return '';
  const senders=new Set();for(const e of entries){if(!e||e.isSelf||e.self||String(e.senderId)===String(ctx.selfId)||!String(e.text||'').trim()||! /^[1-9]\d{4,11}$/.test(String(e.senderId||'')))return '';senders.add(String(e.senderId));}
  const uid=senders.size===1?[...senders][0]:'';if(ctx.kind==='private'&&(String(ctx.chatId)!==uid||ctx.chatKey!=='private:'+uid))return '';return uid;
}
export function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});fs.renameSync(tmp,file);}
export function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw new Error('本地状态文件损坏，已停止以避免重复发送：'+path.basename(file));}}
