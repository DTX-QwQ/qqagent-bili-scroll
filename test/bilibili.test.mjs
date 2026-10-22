import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Bilibili,signed,cookiesOf} from '../plugins/bili-scroll/bilibili.js';
function make(t,fetch){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bili-api-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Bilibili({dir,fetch});}
test('WBI 参数固定排序与 MD5 签名向量',()=>{const q=signed({foo:'114',bar:'514',baz:1919810},'ea1db124af3c7062474693fa704f4ff8',1702204169000);assert.equal(q,'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee');});
test('Cookie 只提取登录必需字段，不将 set-cookie 全量存储',()=>{assert.deepEqual(cookiesOf({getSetCookie:()=>['SESSDATA=a%2Cb; Path=/','bili_jct=abc; HttpOnly','other=secret; Path=/']}),{SESSDATA:'a%2Cb',bili_jct:'abc'});});
test('扫码从响应 Cookie 取凭证，页面结果不返回 Cookie',async t=>{const b=make(t,async url=>url.includes('finger')?Response.json({code:0,data:{b_3:'buvid'}}):Response.json({code:0,data:{code:0}},{headers:{'set-cookie':'SESSDATA=session; Path=/'}}));b.qr={key:'abc',at:Date.now()};await assert.rejects(()=>b.loginPoll(),/完整凭证/);});
test('字幕 URL 限域且不带账号 Cookie',async t=>{let opts;const b=make(t,async(u,o)=>{opts=o;return Response.json({body:[{content:'字幕'}]});});b.jar={SESSDATA:'private'};await assert.rejects(()=>b.request('https://evil.com/sub.json',{subtitle:true}),/拒绝/);await b.request('https://aisubtitle.hdslb.com/a.json',{subtitle:true,auth:false});assert.equal(opts.headers.cookie,undefined);});
test('B站业务错误不是成功，明确拒绝标记',async t=>{const b=make(t,async()=>Response.json({code:-101,message:'未登录'}));await assert.rejects(()=>b.account(),e=>e.definite===true&&/-101/.test(e.message));});
test('@ 评论正文、UID 映射、CSRF 与回执均校验',async t=>{let params;const b=make(t,async(_,o)=>{params=new URLSearchParams(o.body);return Response.json({code:0,data:{rpid_str:'123456789987654321'}});});b.jar={SESSDATA:'s',bili_jct:'csrf'};const r=await b.comment({aid:100},{uid:'123',name:'测试者'},'画面里的例子好直观，想试试～');assert.equal(params.get('message'),'@测试者 画面里的例子好直观，想试试～');assert.deepEqual(JSON.parse(params.get('at_name_to_mid')),{'测试者':'123'});assert.equal(params.get('csrf'),'csrf');assert.equal(r.rpid,'123456789987654321');});
test('缺评论编号不得标成功',async t=>{const b=make(t,async()=>Response.json({code:0,data:{}}));b.jar={SESSDATA:'s',bili_jct:'c'};await assert.rejects(()=>b.comment({aid:1},{uid:'123',name:'A'},'这个例子我想试试'),/未返回评论编号/);});
test('扫码成功保存凭证但不向面板返回凭证',async t=>{const b=make(t,async()=>{const headers=new Headers();headers.append('set-cookie','SESSDATA=session; Path=/');headers.append('set-cookie','bili_jct=csrf; Path=/');return Response.json({code:0,data:{code:0}},{headers});});b.qr={key:'x',at:Date.now()};assert.deepEqual(await b.loginPoll(),{state:'ok'});assert.equal(b.loggedIn,true);assert.equal(JSON.parse(fs.readFileSync(b.file,'utf8')).SESSDATA,'session');b.logout();assert.equal(b.loggedIn,false);});
test('退出登录后晚到的扫码成功响应不能恢复凭证',async t=>{let release;const b=make(t,()=>new Promise(r=>release=r));b.qr={key:'x',at:Date.now()};const p=b.loginPoll();b.logout();const headers=new Headers();headers.append('set-cookie','SESSDATA=s; Path=/');headers.append('set-cookie','bili_jct=c; Path=/');release(Response.json({code:0,data:{code:0}},{headers}));assert.deepEqual(await p,{state:'expired'});assert.equal(b.loggedIn,false);});
test('原生拼图均匀抽样、附范围与时间索引；CDN 请求不带 Cookie',async t=>{const visited=[];const b=make(t,async(u,o)=>{visited.push({u,o});if(u.includes('api.bilibili.com'))return Response.json({code:0,data:{img_x_len:10,img_y_len:10,img_x_size:160,img_y_size:90,image:Array.from({length:5},(_,i)=>'//i0.hdslb.com/bfs/videoshot/'+i+'.jpg'),index:Array.from({length:501},(_,i)=>i)}});return new Response(Buffer.from([255,216,255,0]));});b.jar={SESSDATA:'private'};const r=await b.storyboards({bvid:'BV1234567890',cid:123},undefined,3);assert.deepEqual(r.metadata.selectedSheets,[1,3,5]);assert.equal(r.metadata.sampled,true);assert.deepEqual(r.metadata.times[1].seconds.slice(0,2),[201,202]);assert.equal(r.images.length,3);for(const v of visited.slice(1))assert.equal(v.o.headers.cookie,undefined);});
test('拼图外域、非图片、超大响应、缺失拼图都拒绝',async t=>{let data={image:[],img_x_len:10,img_y_len:10,img_x_size:160,img_y_size:90};const b=make(t,async u=>u.includes('api.bilibili.com')?Response.json({code:0,data}):new Response('not an image'));await assert.rejects(()=>b.storyboards({bvid:'BV1234567890',cid:1}),/没有生成/);data.image=['https://evil.com/bfs/videoshot/1.jpg'];await assert.rejects(()=>b.storyboards({bvid:'BV1234567890',cid:1}),/拒绝/);data.image=['//i0.hdslb.com/bfs/videoshot/1.jpg'];await assert.rejects(()=>b.storyboards({bvid:'BV1234567890',cid:1}),/有效/);b.fetch=async()=>new Response(Buffer.alloc(3*1024*1024+1));await assert.rejects(()=>b.request('https://i0.hdslb.com/bfs/videoshot/a.jpg',{binary:true}),/大小限制/);});
test('评论缺少AI正文或额外@时不发请求',async t=>{let calls=0;const b=make(t,async()=>{calls++;});b.jar={SESSDATA:'s',bili_jct:'c'};for(const text of [undefined,'','@陌生人 你好','https://evil.com'])await assert.rejects(()=>b.comment({aid:1},{uid:'123',name:'A'},text));assert.equal(calls,0);});
test('兼容B站近期视频 bimp videoshotpvhdboss 原生拼图路径',async t=>{let cookie;const b=make(t,async(u,o)=>{cookie=o.headers.cookie;return new Response(Buffer.from([255,216,255,0]));});b.jar={SESSDATA:'private'};const r=await b.request('https://bimp.hdslb.com/videoshotpvhdboss/42959242335_9tj06b-0001.jpg',{binary:true});assert.equal(r.mime,'image/jpeg');assert.equal(cookie,undefined);await assert.rejects(()=>b.request('https://bimp.hdslb.com/private/other.jpg',{binary:true}),/拒绝/);});

test('拼图尺寸接受整数字符串，时间索引仍按原网格对应',async t=>{
 const data={img_x_len:'2',img_y_len:' 2 ',img_x_size:'480',img_y_size:'270',image:['//bimp.hdslb.com/videoshotpvhdboss/test-1.jpg','//bimp.hdslb.com/videoshotpvhdboss/test-2.jpg'],index:[0,0,5,10,15,20,25]};
 const b=make(t,async u=>u.includes('api.bilibili.com')?Response.json({code:0,data}):new Response(Buffer.from([255,216,255,0])));
 const r=await b.storyboards({bvid:'BV1234567890',cid:1});
 assert.deepEqual(r.metadata.grid,[2,2]);assert.deepEqual(r.metadata.cell,[480,270]);assert.deepEqual(r.metadata.warnings,[]);
 assert.deepEqual(r.metadata.times,[{sheet:1,seconds:[0,5,10,15]},{sheet:2,seconds:[20,25]}]);assert.equal(r.images.length,2);
});

test('尺寸字段缺失或异常仍提供实际拼图，未知网格不编造时间映射',async t=>{
 let data={image:['//bimp.hdslb.com/videoshotpvhdboss/test.jpg'],index:[0,0,5,10]};
 const b=make(t,async u=>u.includes('api.bilibili.com')?Response.json({code:0,data}):new Response(Buffer.from([255,216,255,0])));
 for(const value of [undefined,null,0,-1,1.5,4097,'','0','2.5','2oops','1e1',true,[],{}]){
  data={...data,img_x_len:value,img_y_len:10,img_x_size:value,img_y_size:270};
  const r=await b.storyboards({bvid:'BV1234567890',cid:1});
  assert.equal(r.images.length,1);assert.match(r.images[0].url,/^data:image\/jpeg;base64,/);
  assert.equal(r.metadata.grid,null);assert.equal(r.metadata.cell,null);assert.deepEqual(r.metadata.times,[{sheet:1,seconds:[]}]);
  assert.match(r.metadata.warnings.join(''),/网格信息缺失或无效/);assert.match(r.metadata.warnings.join(''),/尺寸信息缺失或无效/);
 }
 data={...data,image:['https://evil.com/bfs/videoshot/a.jpg']};
 await assert.rejects(()=>b.storyboards({bvid:'BV1234567890',cid:1}),/拒绝/);
 data={...data,image:['//bimp.hdslb.com/videoshotpvhdboss/test.jpg']};b.fetch=async u=>u.includes('api.bilibili.com')?Response.json({code:0,data}):new Response('not an image');
 await assert.rejects(()=>b.storyboards({bvid:'BV1234567890',cid:1}),/有效的 JPEG\/PNG/);
});

test('单帧尺寸缺失不破坏已知网格和时间索引；空索引明确说明未知',async t=>{
 let data={image:['//bimp.hdslb.com/videoshotpvhdboss/test.jpg'],img_x_len:2,img_y_len:2,index:[0,0,5,10]};
 const b=make(t,async u=>u.includes('api.bilibili.com')?Response.json({code:0,data}):new Response(Buffer.from([255,216,255,0])));
 let r=await b.storyboards({bvid:'BV1234567890',cid:1});assert.deepEqual(r.metadata.grid,[2,2]);assert.equal(r.metadata.cell,null);assert.deepEqual(r.metadata.times[0].seconds,[0,5,10]);
 data={...data,img_x_size:480,img_y_size:270,index:[]};r=await b.storyboards({bvid:'BV1234567890',cid:1});assert.deepEqual(r.metadata.times[0].seconds,[]);assert.match(r.metadata.warnings.join(''),/未提供时间索引/);
});

test('BV16jnp6pEdf 原始回归：零尺寸、空索引和 pvsdboss 拼图仍可审图',async t=>{
 const data={pvdata:'//boss.hdslb.com/videoshotpvsdboss/42959899315_ir07rb.bin',img_x_len:10,img_y_len:10,img_x_size:0,img_y_size:0,image:['//bimp.hdslb.com/videoshotpvsdboss/42959899315_ir07rb-0001.jpg'],index:[],video_shots:{},indexs:{}};
 const visited=[];const b=make(t,async(u,o)=>{visited.push({u,o});return u.includes('api.bilibili.com')?Response.json({code:0,data}):new Response(Buffer.from([255,216,255,0]));});b.jar={SESSDATA:'private'};
 const r=await b.storyboards({bvid:'BV16jnp6pEdf',cid:42959899315});
 assert.equal(r.images.length,1);assert.deepEqual(r.metadata.grid,[10,10]);assert.equal(r.metadata.cell,null);assert.deepEqual(r.metadata.times,[{sheet:1,seconds:[]}]);
 assert.match(r.metadata.warnings.join(''),/单帧尺寸信息缺失或无效/);assert.match(r.metadata.warnings.join(''),/各帧秒数未知/);
 assert.equal(visited[1].u,'https://bimp.hdslb.com/videoshotpvsdboss/42959899315_ir07rb-0001.jpg');assert.equal(visited[1].o.headers.cookie,undefined);assert.equal(visited.length,2);
 await assert.rejects(()=>b.request('https://bimp.hdslb.com/videoshotpvotherboss/a.jpg',{binary:true}),/拒绝/);
});
