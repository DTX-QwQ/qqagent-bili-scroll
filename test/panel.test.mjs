import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPanel} from '../plugins/bili-scroll/panel.js';import {DEFAULTS} from '../plugins/bili-scroll/core.js';
test('面板同源、Host、请求标记、配置校验、日报路径保护',async t=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bili-panel-'));let saved;const panel=createPanel({engine:{status:()=>({active:true}),coordinator:{}},bili:{},host:{recipients:()=>[],health:async()=>({chat:{toolEnabled:false,reason:'全局工具已关闭'},qq:{connected:true}}),saveSettings:async c=>saved=c},getConfig:()=>({...DEFAULTS,panelPort:port}),dir,log:()=>{}});await panel.start();t.after(async()=>{await panel.stop();fs.rmSync(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+port;
 assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/api/state')).status,403);
 assert.equal((await fetch(base+'/api/state',{headers:{'x-bili-panel':'1',origin:'https://evil.test'}})).status,403);
 const wrongHost=await new Promise((resolve,reject)=>{http.get(base+'/api/state',{headers:{'x-bili-panel':'1',host:'evil.test'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(wrongHost,403);
 assert.equal((await fetch(base+'/api/state',{headers:{'x-bili-panel':'1'}})).status,200);
 assert.equal((await fetch(base+'/api/health')).status,403);const health=await(await fetch(base+'/api/health',{headers:{'x-bili-panel':'1'}})).json();assert.equal(health.chat.reason,'全局工具已关闭');assert.equal(health.qq.connected,true);
 assert.equal((await fetch(base+'/api/report?date=../../config',{headers:{'x-bili-panel':'1'}})).status,400);
 const post=body=>fetch(base+'/api/config',{method:'POST',headers:{'x-bili-panel':'1','content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({qqWhitelist:'bad'})).status,400);assert.equal(saved,undefined);assert.equal((await post({other:true})).status,400);assert.equal((await post({topics:'教程'})).status,200);assert.equal(saved.topics,'教程');
});
