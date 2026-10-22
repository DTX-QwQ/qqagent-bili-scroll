import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createConsoleClient} from '../plugins/bili-scroll/console.js';
const dataDir=process.cwd(),getConfig=()=>({server:{port:3210,token:'test-secret'}});

test('控制台地址跨过一分钟仍复用，避免长时间审核后重新探测丢失连接',async t=>{
 let scans=0;const now=Date.now;t.after(()=>{Date.now=now;});let clock=now();Date.now=()=>clock;
 const c=createConsoleClient({dataDir,getConfig,fetch:async(u,o)=>{assert.equal(o.headers['x-console-token'],'test-secret');if(u.endsWith('/api/status')){scans++;return Response.json({dataDir});}return Response.json({ok:true});}});
 await c.request('/api/skills');clock+=120000;await c.request('/api/skills');assert.equal(scans,1);
});

test('实际本地控制台响应超过两秒仍能发现并读取',async t=>{
 const server=http.createServer((req,res)=>{const send=()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(req.url==='/api/status'?{dataDir}:{ok:true}));};if(req.url==='/api/status')setTimeout(send,2100);else send();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const c=createConsoleClient({dataDir,getConfig:()=>({server:{port:server.address().port}}),fetch});
 assert.equal((await c.request('/api/skills')).ok,true);
});

test('端口偏移时仍验证数据目录，不会将消息交给另一个实例',async()=>{
 const visits=[];const c=createConsoleClient({dataDir,getConfig,fetch:async u=>{visits.push(u);const port=new URL(u).port;if(u.endsWith('/api/status'))return port==='3210'?Response.json({},{status:401}):Response.json({dataDir:port==='3211'?dataDir+'/other':dataDir});assert.equal(port,'3212');return Response.json({ok:true});}});
 assert.equal((await c.request('/api/chats/private_12345/test-send',{method:'POST',body:{text:'测试'}})).ok,true);
 assert.equal(visits.filter(u=>u.includes('/test-send')).length,1);
});

test('发送请求断开不自动重试；后续只读请求重新校验实例',async()=>{
 let scans=0,posts=0;const c=createConsoleClient({dataDir,getConfig,fetch:async(u,o)=>{if(u.endsWith('/api/status')){scans++;return Response.json({dataDir});}if(o.method==='POST'){posts++;throw Object.assign(new Error('request failed'),{cause:{code:'ECONNRESET'}});}return Response.json({ok:true});}});
 await assert.rejects(()=>c.request('/api/chats/private_12345/test-send',{method:'POST',body:{text:'测试'}}),/ECONNRESET.*未自动重试/);
 assert.equal(posts,1);assert.equal((await c.request('/api/skills')).ok,true);assert.equal(scans,2);assert.equal(posts,1);
});

test('探测失败保留鉴权错误而不泄露令牌，取消时不请求',async()=>{
 let calls=0;const c=createConsoleClient({dataDir,getConfig,fetch:async()=>{calls++;return Response.json({},{status:401});}});
 await assert.rejects(()=>c.request('/api/skills'),e=>/找不到.*HTTP 401/.test(e.message)&&!e.message.includes('test-secret'));assert.equal(calls,10);
 const a=new AbortController();a.abort(new Error('已取消'));await assert.rejects(()=>c.request('/api/skills',{signal:a.signal}),/已取消/);assert.equal(calls,10);
});
