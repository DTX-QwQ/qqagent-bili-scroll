import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../plugins/bili-scroll/engine.js';import {clock} from '../plugins/bili-scroll/core.js';
const BV='BV1234567890';
function fixture(t,overrides={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bili-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let c={topics:'教程',qqWhitelist:'12345\n67890',qqEnabled:true,commentEnabled:true,mentionUid:'123',maxDaily:3,...overrides};const calls={qq:[],comment:[],llm:0,batch:0,messages:[]};
 const options={dir,getConfig:()=>c,bili:{loggedIn:true,account:async()=>({loggedIn:true}),search:async()=>[{bvid:BV,title:'视频',pubdate:Date.now()/1000}],video:async()=>({bvid:BV,title:'视频',author:'UP',aid:1,cid:2,parts:1}),storyboards:async()=>({images:[{url:'data:image/jpeg;base64,/9j/'}],metadata:{sampled:false,totalSheets:1}}),subtitle:async()=>({text:'这是足够长的视频字幕内容，是完整的实操技术教程，内容示例。',language:'中文'}),mention:async()=>({uid:'123',name:'朋友'}),comment:async(v,target)=>{calls.comment.push(v.bvid);return {rpid:'987654321987654321'};}},complete:async messages=>{calls.messages.push(messages);const data=messages[1].content;
 if(messages[0].content.includes('整批候选')){calls.batch++;return JSON.stringify({decisions:JSON.parse(data).候选.map(v=>({bvid:v.bvid,keep:true,reason:'符合口味'}))});}
 if(Array.isArray(data)){calls.llm++;return JSON.stringify({recommend:true,score:90,reason:'有可复现的实例',summary:'讲解示例',visualEvidence:'画面展示代码编辑器'});}
 const d=JSON.parse(data);return JSON.stringify({text:d.渠道==='qq'?'这个例子我还挺想试的，来一起看看 '+messages[0].content.match(/https:\/\/www\.bilibili\.com\/video\/BV[a-zA-Z0-9]{10}\//)[0]:'这个例子好直观，我想动手试试～'});
 },ready:async()=>{},send:async uid=>{calls.qq.push(uid);return {messageId:'msg-'+uid};}};
 const make=()=>{const e=new Engine(options);e.active=true;return e;};const e=make();return {dir,e,options,calls,make,setConfig:x=>{c={...c,...x};}};
}
test('预览不发送、不消耗额度、不占正式判重',async t=>{const f=fixture(t);assert.equal((await f.e.run({preview:true})).selected.length,1);assert.deepEqual(f.calls.qq,[]);assert.deepEqual(f.calls.comment,[]);assert.equal(Object.keys(f.e.state.items).length,0);assert.equal((await f.e.run()).selected.length,1);assert.equal(f.calls.qq.length,2);});
test('每视频每接收人持久化去重，新增白名单可收到今天推荐',async t=>{const f=fixture(t);await f.e.run();const e=f.make();await e.run();assert.equal(f.calls.qq.length,2);assert.equal(f.calls.comment.length,1);f.setConfig({qqWhitelist:'12345\n67890\n55555'});await e.run();assert.deepEqual(f.calls.qq,['12345','67890','55555']);});
test('独立白名单为空不发 QQ，仍可评论',async t=>{const f=fixture(t,{qqWhitelist:''});await f.e.run();assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,1);});
test('一个 QQ 发送异常不阻止其他接收人和 B站；不自动重试不明确结果',async t=>{const f=fixture(t);f.options.send=async uid=>{f.calls.qq.push(uid);if(uid==='12345')throw new Error('timeout');return {messageId:2};};const e=f.make();await e.run();assert.equal(e.state.items[BV].qq['12345'].status,'unknown');assert.equal(e.state.items[BV].qq['67890'].status,'sent');assert.equal(f.calls.comment.length,1);await f.make().run();assert.equal(f.calls.qq.length,2);});
test('写入 pending 后崩溃/取消不重复发送',async t=>{const f=fixture(t);f.options.send=async()=>{f.e.cancel();throw new Error('cancel');};f.e=new Engine(f.options);f.e.active=true;await f.e.run();assert.equal(f.e.state.items[BV].qq['12345'].status,'pending');f.options.send=async uid=>{f.calls.qq.push(uid);return {messageId:1};};await f.make().run();assert.deepEqual(f.calls.qq,['67890']);});
test('无字幕不调用逐条审核 AI、不发消息',async t=>{const f=fixture(t);f.options.bili.subtitle=async()=>null;await f.e.run();assert.equal(f.calls.llm,0);assert.equal(f.calls.qq.length,0);assert.equal(f.e.state.runs[0].skipped[0].reason,'没有可用字幕');});
test('过长字幕不会静默截断推荐',async t=>{const f=fixture(t);f.options.bili.subtitle=async()=>({text:'a'.repeat(60001)});await f.e.run();assert.equal(f.calls.llm,0);assert.match(f.e.state.runs[0].skipped[0].reason,/超过/);});
test('AI 错误不会编造推荐',async t=>{const f=fixture(t);f.options.complete=async()=>'{broken';const e=f.make();const r=await e.run();assert.equal(r.status,'failed');assert.equal(r.selected.length,0);assert.equal(f.calls.qq.length,0);});
test('每日额度限制正式运行，预览可继续',async t=>{const f=fixture(t,{maxDaily:1});await f.e.run();f.options.bili.search=async()=>[{bvid:'BVabcdefghij',pubdate:Date.now()/1000}];f.options.bili.video=async()=>({bvid:'BVabcdefghij',aid:2,cid:3,title:'2',parts:1});assert.equal((await f.e.run()).scanned,0);assert.equal((await f.e.run({preview:true})).selected.length,1);});
test('主程序拒绝发送时不调用发送队列，可在解除后投递',async t=>{const f=fixture(t);f.options.ready=async(_,uid)=>{if(uid)throw new Error('未在主白名单');};const e=f.make();await e.run();assert.deepEqual(f.calls.qq,[]);assert.deepEqual(e.state.items[BV].qq,{});f.options.ready=async()=>{};await f.make().run();assert.equal(f.calls.qq.length,2);});
test('发送间移除接收人立即生效',async t=>{const f=fixture(t);f.options.send=async uid=>{f.calls.qq.push(uid);f.setConfig({qqWhitelist:'12345'});return {messageId:1};};await f.make().run();assert.deepEqual(f.calls.qq,['12345']);});
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
 const f=fixture(t);f.options.send=async(uid,text)=>{assert.match(text,/我还挺想试/);assert.doesNotMatch(text,/B站推荐｜|UP：/);f.calls.qq.push(uid);return {messageId:1};};f.options.bili.comment=async(v,target,text)=>{assert.equal(text,'这个例子好直观，我想动手试试～');f.calls.comment.push(v.bvid);return {rpid:'123'};};await f.make().run();assert.equal(f.calls.qq.length,2);assert.equal(f.calls.comment.length,1);
});
test('人设热变更阻止旧审核结果发送',async t=>{
 const f=fixture(t);let role='代码';f.options.getPersona=()=>({roleText:role});const base=f.options.complete;f.options.complete=async m=>{const r=await base(m);if(Array.isArray(m[1].content))role='音乐';return r;};const r=await f.make().run();assert.equal(r.status,'failed');assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);
});
test('聊天立即启动，自动额度为零、定时关闭仍可运行且不消耗自动额度',async t=>{
 const f=fixture(t,{maxDaily:0,autoEnabled:false});const ctx={kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'去逛逛B站'}]}};const e=f.make();assert.equal((await e.trigger(ctx)).started,true);await e.coordinator.done;assert.equal(e.state.runs.at(-1).trigger,'chat');assert.equal(e.state.runs.at(-1).selected.length,1);assert.equal(f.calls.qq.length,2);assert.equal(e.state.items[BV].trigger,'chat');
});
test('聊天拒绝伪造身份、混合作者、自身消息、未授权及中途撤销',async t=>{
 const f=fixture(t),e=f.make();const ctx={kind:'private',chatId:'12345',chatKey:'private:12345',selfId:'88888',session:{trigger:[{senderId:'12345',text:'逛B站'}]}};
 for(const trigger of [undefined,'message',[{senderId:'55555',text:'逛B站'}],[{senderId:'12345',text:'逛'},{senderId:'67890',text:'B站'}],[{senderId:'12345',self:true,text:'逛B站'}]])await assert.rejects(()=>e.trigger({...ctx,session:{trigger}}));
 const base=f.options.complete;f.options.complete=async m=>{const r=await base(m);if(Array.isArray(m[1].content))f.setConfig({qqWhitelist:''});return r;};const e2=f.make();await e2.trigger(ctx);await e2.coordinator.done;assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);
});
test('旧版只有字幕的待发送记录不会被新版直接投递',async t=>{const f=fixture(t,{maxDaily:0});f.e.state.items[BV]={bvid:BV,day:clock(Date.now(),'Asia/Shanghai').date,reason:'旧记录',qq:{}};f.e.save();await f.e.run();assert.equal(f.calls.qq.length,0);assert.equal(f.calls.comment.length,0);});
test('文案格式失误仅让AI纠正一次，仍由AI生成正文',async t=>{const f=fixture(t),base=f.options.complete;let invalid=true,correction=false;f.options.complete=async m=>{if(m[0].content.includes('人设本人')&&invalid){invalid=false;return '{"text":"遗漏链接"}';}if(m.length===4){correction=true;return JSON.stringify({text:'那段代码画面挺清楚的，想试试 https://www.bilibili.com/video/'+BV+'/'});}return base(m);};const r=await f.make().run({preview:true});assert.equal(correction,true);assert.equal(r.selected.length,1);assert.match(r.selected[0].drafts.qq,/那段代码画面/);assert.deepEqual(f.calls.qq,[]);});
