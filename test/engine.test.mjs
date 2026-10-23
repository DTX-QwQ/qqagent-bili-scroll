import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../plugins/bili-scroll/engine.js';import {clock} from '../plugins/bili-scroll/core.js';
const BV='BV1234567890';
function fixture(t,overrides={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bili-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let c={topics:'教程',qqWhitelist:'12345\n67890',qqEnabled:true,commentEnabled:true,mentionUid:'123',maxDaily:3,...overrides};const calls={qq:[],summaries:[],comment:[],llm:0,batch:0,messages:[]};
 const options={dir,getConfig:()=>c,bili:{loggedIn:true,account:async()=>({loggedIn:true}),search:async()=>[{bvid:BV,title:'视频',pubdate:Date.now()/1000}],video:async()=>({bvid:BV,title:'视频',author:'UP',aid:1,cid:2,parts:1}),storyboards:async()=>({images:[{url:'data:image/jpeg;base64,/9j/'}],metadata:{sampled:false,totalSheets:1}}),subtitle:async()=>({text:'这是足够长的视频字幕内容，是完整的实操技术教程，内容示例。',language:'中文'}),mention:async()=>({uid:'123',name:'朋友'}),comment:async(v,target)=>{calls.comment.push(v.bvid);return {rpid:'987654321987654321'};}},complete:async messages=>{calls.messages.push(messages);const data=messages[1].content;
 if(messages[0].content.includes('识别本轮聊天主题'))return JSON.stringify({topic:''});
 if(messages[0].content.includes('本轮刷站总结')){const d=JSON.parse(data);return JSON.stringify({text:'本轮已经结束，推荐 '+d.本轮.推荐数量+' 条。'+(d.本轮.无候选原因||d.候选[0]?.reason||'')+(d.本轮.预览未发送?'，预览未发送。':'')});}
 if(messages[0].content.includes('整批候选')){calls.batch++;return JSON.stringify({decisions:JSON.parse(data).候选.map(v=>({bvid:v.bvid,keep:true,reason:'符合口味'}))});}
 if(Array.isArray(data)){calls.llm++;return JSON.stringify({recommend:true,score:90,reason:'有可复现的实例',summary:'讲解示例',visualEvidence:'画面展示代码编辑器'});}
 const d=JSON.parse(data);return JSON.stringify({text:d.渠道==='qq'?'这个例子我还挺想试的，来一起看看 '+messages[0].content.match(/https:\/\/www\.bilibili\.com\/video\/BV[a-zA-Z0-9]{10}\//)[0]:'这个例子好直观，我想动手试试～'});
 },ready:async()=>{},send:async(uid,text)=>{if(text.includes('本轮'))calls.summaries.push({uid,text});else calls.qq.push(uid);return {messageId:'msg-'+uid};}};
 const make=()=>{const e=new Engine(options);e.active=true;return e;};const e=make();return {dir,e,options,calls,make,setConfig:x=>{c={...c,...x};}};
}
test('预览不发送、不消耗额度、不占正式判重',async t=>{const f=fixture(t);assert.equal((await f.e.run({preview:true})).selected.length,1);assert.deepEqual(f.calls.qq,[]);assert.deepEqual(f.calls.comment,[]);assert.equal(Object.keys(f.e.state.items).length,0);assert.equal((await f.e.run()).selected.length,1);assert.equal(f.calls.qq.length,2);});
test('每视频每接收人持久化去重，新增白名单可收到今天推荐',async t=>{const f=fixture(t);await f.e.run();const e=f.make();await e.run();assert.equal(f.calls.qq.length,2);assert.equal(f.calls.comment.length,1);f.setConfig({qqWhitelist:'12345\n67890\n55555'});await e.run();assert.deepEqual(f.calls.qq,['12345','67890','55555']);});
test('独立白名单为空不发 QQ，仍可评论',async t=>{const f=fixture(t,{qqWhitelist:''});await f.e.run();assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,1);});
test('一个 QQ 发送异常不阻止其他接收人和 B站；不自动重试不明确结果',async t=>{const f=fixture(t);f.options.send=async(uid,text)=>{if(!text.includes('本轮'))f.calls.qq.push(uid);if(uid==='12345')throw new Error('timeout');return {messageId:2};};const e=f.make();await e.run();assert.equal(e.state.items[BV].qq['12345'].status,'unknown');assert.equal(e.state.items[BV].qq['67890'].status,'sent');assert.equal(f.calls.comment.length,1);await f.make().run();assert.equal(f.calls.qq.length,2);});
test('写入 pending 后崩溃/取消不重复发送',async t=>{const f=fixture(t);f.options.send=async()=>{f.e.cancel();throw new Error('cancel');};f.e=new Engine(f.options);f.e.active=true;await f.e.run();assert.equal(f.e.state.items[BV].qq['12345'].status,'pending');f.options.send=async(uid,text)=>{if(!text.includes('本轮'))f.calls.qq.push(uid);return {messageId:1};};await f.make().run();assert.deepEqual(f.calls.qq,['67890']);});
test('无字幕不调用逐条审核 AI、不发推荐，仍发送结束总结',async t=>{const f=fixture(t);f.options.bili.subtitle=async()=>null;await f.e.run();assert.equal(f.calls.llm,0);assert.equal(f.calls.qq.length,0);assert.equal(f.calls.summaries.length,2);assert.match(f.e.state.runs[0].skipped[0].reason,/没有可用字幕/);});
test('过长字幕不会静默截断推荐',async t=>{const f=fixture(t);f.options.bili.subtitle=async()=>({text:'a'.repeat(60001)});await f.e.run();assert.equal(f.calls.llm,0);assert.match(f.e.state.runs[0].skipped[0].reason,/超过/);});
test('AI 错误不会编造推荐',async t=>{const f=fixture(t);f.options.complete=async()=>'{broken';const e=f.make();const r=await e.run();assert.equal(r.status,'failed');assert.equal(r.selected.length,0);assert.equal(f.calls.qq.length,0);});
test('每日额度限制正式运行，预览可继续',async t=>{const f=fixture(t,{maxDaily:1});await f.e.run();f.options.bili.search=async()=>[{bvid:'BVabcdefghij',pubdate:Date.now()/1000}];f.options.bili.video=async()=>({bvid:'BVabcdefghij',aid:2,cid:3,title:'2',parts:1});assert.equal((await f.e.run()).scanned,0);assert.equal((await f.e.run({preview:true})).selected.length,1);});
test('主程序拒绝发送时不调用发送队列，可在解除后投递',async t=>{const f=fixture(t);f.options.ready=async(_,uid)=>{if(uid)throw new Error('未在主白名单');};const e=f.make();await e.run();assert.deepEqual(f.calls.qq,[]);assert.deepEqual(e.state.items[BV].qq,{});f.options.ready=async()=>{};await f.make().run();assert.equal(f.calls.qq.length,2);});
test('发送间移除接收人立即生效',async t=>{const f=fixture(t);f.options.send=async(uid,text)=>{if(!text.includes('本轮'))f.calls.qq.push(uid);f.setConfig({qqWhitelist:'12345'});return {messageId:1};};await f.make().run();assert.deepEqual(f.calls.qq,['12345']);});
test('定时补跑窗口与重复运行拦截',async t=>{const f=fixture(t,{autoEnabled:true,runTimes:'12:30'});const now=Date.parse('2026-10-21T04:40:00Z');const slot=clock(now,'Asia/Shanghai').date+' 12:30';await f.e.tick(now);assert.ok(f.e.state.slots[slot]);const count=f.e.state.runs.length;await f.e.tick(now);assert.equal(f.e.state.runs.length,count);await f.e.tick(Date.parse('2026-10-22T06:00:00Z'));assert.equal(f.e.state.runs.length,count);});
test('并发手动运行和停止清理',async t=>{const f=fixture(t);let release;f.options.complete=()=>new Promise(r=>release=r);f.e=f.make();const p=f.e.run();while(!release)await new Promise(r=>setImmediate(r));await assert.rejects(()=>f.e.run(),/正在运行/);f.e.stop();release('{"recommend":true,"score":90,"reason":"好","summary":"好"}');await p;assert.equal(f.calls.qq.length,0);assert.equal(f.e.coordinator.busy,false);});
test('状态损坏时失败关闭，不清空判重记录',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.dir,'state.json'),'{bad');assert.throws(()=>f.make(),/损坏/);});
test('整批初筛先淘汰，再逐条携带真图片 parts 与当前人设',async t=>{
 const f=fixture(t);const other='BVabcdefghij';f.options.getPersona=()=>({roleText:'爱看代码演示'});f.options.bili.search=async()=>[BV,other].map(bvid=>({bvid,pubdate:Date.now()/1000}));const base=f.options.complete;
 f.options.complete=async m=>m[0].content.includes('整批候选')?JSON.stringify({decisions:[{bvid:BV,keep:false,reason:'不合口味'},{bvid:other,keep:true,reason:'喜欢'}]}):base(m);
 f.options.bili.video=async bvid=>({bvid,title:'代码',parts:1});const r=await f.make().run({preview:true});assert.equal(r.scanned,1);assert.equal(r.skipped[0].bvid,BV);const m=f.calls.messages.find(m=>Array.isArray(m[1].content));assert.equal(m[1].content[1].type,'image_url');assert.match(m[1].content[1].image_url.url,/^data:image/);assert.match(m[1].content[0].text,/爱看代码演示/);
});
test('全部候选审核完按分数选优，不先到先得',async t=>{
 const f=fixture(t,{maxPerRun:1});const other='BVabcdefghij';f.options.bili.search=async()=>[BV,other].map(bvid=>({bvid,pubdate:Date.now()/1000}));f.options.bili.video=async bvid=>({bvid,title:'代码',parts:1});const base=f.options.complete;
 f.options.complete=async m=>{if(Array.isArray(m[1].content)){f.calls.llm++;return JSON.stringify({recommend:true,score:JSON.parse(m[1].content[0].text).视频.bvid===BV?80:99,reason:'喜欢',summary:'演示',visualEvidence:'代码窗口'});}return base(m);};const r=await f.make().run({preview:true});assert.equal(f.calls.llm,2);assert.equal(r.selected[0].bvid,other);
});
test('缺抽帧或视觉依据时绝不降级为纯字幕推荐',async t=>{
 const f=fixture(t);f.options.bili.storyboards=async()=>{throw new Error('缺少拼图');};let r=await f.make().run();assert.equal(r.selected.length,0);assert.equal(f.calls.llm,0);assert.equal(f.calls.qq.length,0);
 f.options.bili.storyboards=async()=>({images:[{url:'data:image/jpeg;base64,/9j/'}],metadata:{sampled:true}});const base=f.options.complete;f.options.complete=async m=>Array.isArray(m[1].content)?JSON.stringify({recommend:true,score:99,reason:'好',summary:'好'}):base(m);r=await f.make().run();assert.equal(r.selected.length,0);assert.match(r.errors.join(''),/画面依据/);
});
test('AI 文案失败时不使用提取内容或固定文本兜底',async t=>{
 const f=fixture(t),base=f.options.complete;f.options.complete=async m=>m[0].content.includes('人设本人')?'{}':base(m);const r=await f.make().run();assert.equal(r.selected.length,0);assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);
});
test('实际 QQ 与评论正文均来自 AI，不拼标题UP评分',async t=>{
 const f=fixture(t);f.options.send=async(uid,text)=>{if(text.includes('本轮')){f.calls.summaries.push({uid,text});return {messageId:2};}assert.match(text,/我还挺想试/);assert.doesNotMatch(text,/B站推荐｜|UP：/);f.calls.qq.push(uid);return {messageId:1};};f.options.bili.comment=async(v,target,text)=>{assert.equal(text,'这个例子好直观，我想动手试试～');f.calls.comment.push(v.bvid);return {rpid:'123'};};await f.make().run();assert.equal(f.calls.qq.length,2);assert.equal(f.calls.comment.length,1);
});
test('人设热变更阻止旧审核结果发送',async t=>{
 const f=fixture(t);let role='代码';f.options.getPersona=()=>({roleText:role});const base=f.options.complete;f.options.complete=async m=>{const r=await base(m);if(Array.isArray(m[1].content))role='音乐';return r;};const r=await f.make().run();assert.equal(r.status,'failed');assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);
});
test('聊天立即启动，自动额度为零、定时关闭仍可运行且不消耗自动额度',async t=>{
 const f=fixture(t,{maxDaily:0,autoEnabled:false});const ctx={kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'去逛逛B站'}]}};const e=f.make();assert.equal((await e.trigger(ctx)).started,true);await e.coordinator.done;assert.equal(e.state.runs.at(-1).trigger,'chat');assert.equal(e.state.runs.at(-1).selected.length,1);assert.equal(f.calls.qq.length,2);assert.equal(e.state.items[BV].trigger,'chat');
});

test('聊天主题仅覆盖本轮搜索和两阶段审核，下一轮未指定或手动运行恢复配置',async t=>{
 const f=fixture(t,{qqEnabled:false,commentEnabled:false}),base=f.options.complete,keywords=[];
 f.options.bili.search=async keyword=>{keywords.push(keyword);return [{bvid:BV,title:'视频',pubdate:Date.now()/1000}];};
 f.options.complete=async m=>m[0].content.includes('识别本轮聊天主题')?JSON.stringify({topic:JSON.parse(m[1].content).触发消息[0].includes('Python入门')?'Python入门':''}):base(m);
 const e=f.make(),ctx={kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'刷B站，找Python入门的视频'}]}};
 await e.trigger(ctx);await e.coordinator.done;let r=e.state.runs.at(-1);assert.equal(r.topics,'Python入门');assert.equal(r.topicSource,'chat');
 const batch=f.calls.messages.find(m=>m[0].content.includes('整批候选'));assert.equal(JSON.parse(batch[1].content).关键词,'Python入门');
 const review=f.calls.messages.find(m=>Array.isArray(m[1].content));assert.equal(JSON.parse(review[1].content[0].text).关键词,'Python入门');assert.equal(f.options.getConfig().topics,'教程');
 ctx.session.trigger[0].text='去逛逛B站';await e.trigger(ctx);await e.coordinator.done;r=e.state.runs.at(-1);assert.equal(r.topics,'教程');assert.equal(r.topicSource,'config');
 await e.run({preview:true});assert.deepEqual(keywords,['Python入门','教程','教程']);assert.equal(e.state.runs.at(-1).topics,'教程');
});

test('配置关键词为空仍可使用消息明确指定的多个主题，无主题则不搜索',async t=>{
 const f=fixture(t,{topics:'',qqEnabled:false,commentEnabled:false}),base=f.options.complete,keywords=[];
 f.options.bili.search=async keyword=>{keywords.push(keyword);return [];};
 f.options.complete=async m=>m[0].content.includes('识别本轮聊天主题')?JSON.stringify({topic:JSON.parse(m[1].content).触发消息[0].includes('摄影')?'摄影\n剪辑':''}):base(m);
 const e=f.make(),ctx={kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'这轮刷B站找摄影和剪辑教程'}]}};
 await e.trigger(ctx);await e.coordinator.done;assert.deepEqual(keywords,['摄影','剪辑']);assert.equal(e.state.runs.at(-1).status,'done');assert.equal(f.options.getConfig().topics,'');
 ctx.session.trigger[0].text='照常刷B站';await e.trigger(ctx);await e.coordinator.done;assert.equal(e.state.runs.at(-1).status,'failed');assert.match(e.state.runs.at(-1).errors.join(''),/未指定主题/);assert.deepEqual(keywords,['摄影','剪辑']);
});

test('主题识别只读实际触发消息，拒绝模型虚构或无效主题',async t=>{
 for(const value of ['历史聊天主题',123,null,',,,','a'.repeat(2001)]){
  const f=fixture(t,{qqEnabled:false,commentEnabled:false}),base=f.options.complete;let searches=0;
  f.options.bili.search=async()=>{searches++;return [];};
  f.options.complete=async m=>{if(m[0].content.includes('识别本轮聊天主题')){assert.deepEqual(JSON.parse(m[1].content),{触发消息:['刷B站']});return JSON.stringify({topic:value});}return base(m);};
  const e=f.make();await e.trigger({kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'刷B站'}],triggerText:'不要读取这个历史字段'},history:['历史聊天主题']});await e.coordinator.done;
  assert.equal(searches,0);assert.equal(e.state.runs.at(-1).status,'failed');assert.equal(f.options.getConfig().topics,'教程');
 }
});

test('主题识别期间保持并发锁，撤销授权后不搜索或发送',async t=>{
 const f=fixture(t),base=f.options.complete;let release,searches=0;
 f.options.complete=async m=>m[0].content.includes('识别本轮聊天主题')?new Promise(r=>release=r):base(m);
 f.options.bili.search=async()=>{searches++;return [];};
 const e=f.make(),ctx={kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'刷B站，找摄影'}]}};
 await e.trigger(ctx);assert.equal(e.coordinator.busy,true);await assert.rejects(()=>e.trigger(ctx),/正在运行/);
 f.setConfig({qqWhitelist:''});release(JSON.stringify({topic:'摄影'}));await e.coordinator.done;assert.equal(searches,0);assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);assert.equal(f.calls.summaries.length,0);assert.equal(e.coordinator.busy,false);
});

test('过长或列表总结交给模型重写一次，纠正时仍允许合并省略候选',async t=>{
 const f=fixture(t,{qqEnabled:false,commentEnabled:false}),base=f.options.complete;let attempts=0;
 f.options.complete=async m=>{if(m[0].content.includes('本轮刷站总结')){attempts++;if(attempts===1)return JSON.stringify({text:'本轮完成，推荐1条。\n1. '+BV});assert.match(m.at(-1).content,/合并相似原因/);assert.doesNotMatch(m.at(-1).content,/每条候选都必须/);return JSON.stringify({text:'本轮已完成，推荐1条，实操演示比较清楚，值得试试；本次预览未发送。'});}return base(m);};
 const r=await f.make().run({preview:true});assert.equal(attempts,2);assert.equal(r.summaries.local.parts.length,1);assert.doesNotMatch(r.summaries.local.parts[0].text,/BV|\n/);
});
test('聊天拒绝伪造身份、混合作者、自身消息、未授权及中途撤销',async t=>{
 const f=fixture(t),e=f.make();const ctx={kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'逛B站'}]}};
 for(const trigger of [undefined,'message',[{senderId:'55555',text:'逛B站'}],[{senderId:'12345',text:'逛'},{senderId:'67890',text:'B站'}],[{senderId:'12345',self:true,text:'逛B站'}]])await assert.rejects(()=>e.trigger({...ctx,session:{trigger}}));
 const base=f.options.complete;f.options.complete=async m=>{const r=await base(m);if(Array.isArray(m[1].content))f.setConfig({qqWhitelist:''});return r;};const e2=f.make();await e2.trigger(ctx);await e2.coordinator.done;assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);
});
test('旧版只有字幕的待发送记录不会被新版直接投递',async t=>{const f=fixture(t,{maxDaily:0});f.e.state.items[BV]={bvid:BV,day:clock(Date.now(),'Asia/Shanghai').date,reason:'旧记录',qq:{}};f.e.save();await f.e.run();assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);});
test('文案格式失误仅让AI纠正一次，仍由AI生成正文',async t=>{const f=fixture(t),base=f.options.complete;let invalid=true,correction=false;f.options.complete=async m=>{if(m[0].content.includes('人设本人')&&invalid){invalid=false;return '{"text":"遗漏链接"}';}if(m.length===4){correction=true;return JSON.stringify({text:'那段代码画面挺清楚的，想试试 https://www.bilibili.com/video/'+BV+'/'});}return base(m);};const r=await f.make().run({preview:true});assert.equal(correction,true);assert.equal(r.selected.length,1);assert.match(r.selected[0].drafts.qq,/那段代码画面/);assert.deepEqual(f.calls.qq,[]);});

test('零推荐也生成简短结束私信，候选细节保留在记录中',async t=>{
 const f=fixture(t),base=f.options.complete;f.options.complete=async m=>m[0].content.includes('整批候选')?JSON.stringify({decisions:[{bvid:BV,keep:false,reason:'广告营销，与教程偏好不符'}]}):base(m);
 const r=await f.make().run();assert.equal(r.status,'done');assert.equal(r.selected.length,0);assert.equal(f.calls.comment.length,0);assert.equal(f.calls.qq.length,0);assert.equal(f.calls.summaries.length,2);
 for(const x of f.calls.summaries){assert.match(x.text,/本轮已经结束，推荐 0/);assert.match(x.text,/广告营销/);assert.doesNotMatch(x.text,/BV1234567890/);}assert.equal(r.candidates[0].bvid,BV);assert.match(r.candidates[0].reason,/广告营销/);
 assert.equal(r.summaries['12345'].status,'sent');assert.equal(r.delivery.filter(x=>x.channel==='qq-summary').length,2);
});
test('低于门槛的理由和审核范围保留为总结的真实依据',async t=>{
 const f=fixture(t),base=f.options.complete;f.options.complete=async m=>Array.isArray(m[1].content)?JSON.stringify({recommend:true,score:60,reason:'讲解浅，只有基础示例',summary:'基础入门',visualEvidence:'代码示例画面'}):base(m);
 const r=await f.make().run();assert.equal(r.selected.length,0);assert.match(f.calls.summaries[0].text,/评分 60 低于推荐门槛 75/);assert.equal(r.candidates[0].scope,'完整字幕＋B站抽帧拼图');
});
test('无新候选、额度耗尽仍有结束总结；预览生成草稿且零发送',async t=>{
 const f=fixture(t);f.options.bili.search=async()=>[];let r=await f.make().run();assert.match(f.calls.summaries[0].text,/没有未处理/);assert.equal(r.selected.length,0);
 f.calls.summaries.length=0;r=await f.make().run({preview:true});assert.equal(f.calls.summaries.length,0);assert.equal(r.summaries['12345'].status,'draft');assert.ok(r.summaries['12345'].parts[0].text);
 f.setConfig({maxDaily:0});r=await f.make().run();assert.match(f.calls.summaries[0].text,/额度已用完/);
});
test('大量候选一次提供全部证据，只生成一段简短总结，允许省略候选',async t=>{
 const f=fixture(t,{qqEnabled:false}),base=f.options.complete;f.options.bili.search=async()=>Array.from({length:13},(_,i)=>({bvid:'BV'+String(i).padStart(10,'0'),title:'候选'+i,pubdate:Date.now()/1000}));f.setConfig({maxCandidates:20});
 f.options.complete=async m=>m[0].content.includes('整批候选')?JSON.stringify({decisions:JSON.parse(m[1].content).候选.map(v=>({bvid:v.bvid,keep:false,reason:'无关'}))}):base(m);
 const r=await f.make().run();assert.equal(r.summaries.local.parts.length,1);const text=r.summaries.local.parts[0].text;assert.ok(text.length<=300);assert.doesNotMatch(text,/BV|\n/);const summaries=f.calls.messages.filter(m=>m[0].content.includes('本轮刷站总结'));assert.equal(summaries.length,1);assert.equal(JSON.parse(summaries[0][1].content).候选.length,13);assert.equal(f.calls.summaries.length,0);assert.equal(r.summaries.local.status,'draft');
});
test('总结失败不编造固定正文，其他接收人继续；发送前持久化pending且未知回执不重发',async t=>{
 const f=fixture(t);f.options.bili.search=async()=>[];const attempts=[];f.options.send=async(uid,text)=>{attempts.push(uid);const disk=JSON.parse(fs.readFileSync(path.join(f.dir,'state.json'),'utf8'));assert.equal(disk.runs.at(-1).summaries[uid].parts[0].status,'pending');if(uid==='12345')throw new Error('timeout');return {messageId:'confirmed'};};
 let r=await f.make().run();assert.equal(r.summaries['12345'].status,'unknown');assert.equal(r.summaries['67890'].status,'sent');assert.equal(r.status,'partial');assert.deepEqual(attempts,['12345','67890']);
 const base=f.options.complete;f.options.complete=async m=>m[0].content.includes('本轮刷站总结')?'{}':base(m);r=await f.make().run();assert.equal(r.summaries['12345'].status,'failed');assert.equal(attempts.length,2);assert.equal(r.summaries['12345'].parts.length,0);
});
test('总结生成期间撤销授权或停止，不再向QQ写入',async t=>{
 const f=fixture(t),base=f.options.complete;f.options.bili.search=async()=>[];f.options.complete=async m=>{const r=await base(m);if(m[0].content.includes('本轮刷站总结'))f.setConfig({qqWhitelist:''});return r;};let r=await f.make().run();assert.equal(f.calls.summaries.length,0);assert.equal(r.summaries['12345'].status,'failed');
 f.setConfig({qqWhitelist:'12345'});let e;f.options.complete=async m=>{const r=await base(m);if(m[0].content.includes('本轮刷站总结'))e.cancel();return r;};e=f.make();r=await e.run();assert.equal(f.calls.summaries.length,0);assert.equal(r.status,'stopped');assert.equal(e.coordinator.busy,false);
});
