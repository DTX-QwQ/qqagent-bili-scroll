import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {configOf,schema,clean}=await import(new URL('./core.js'+new URL(import.meta.url).search,import.meta.url));
import QR from './vendor/qrcode.cjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export function createPanel({engine,bili,host,getConfig,getStatus=()=>engine.status(),dir,log}){
  let server,port,closing=false;const controllers=new Set();
  const fail=(res,status,message)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({error:message}));};
  async function read(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)throw new Error('请求过大');}return body?JSON.parse(body):{};}
  const json=(res,value)=>{res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  async function handle(req,res){
    const origin=`http://127.0.0.1:${port}`;
    if(req.headers.host!==`127.0.0.1:${port}`)return fail(res,403,'请使用 127.0.0.1 打开面板');
    if(req.headers.origin&&req.headers.origin!==origin)return fail(res,403,'拒绝跨站请求');
    if(req.headers['sec-fetch-site']==='cross-site'&&req.url!=='/')return fail(res,403,'拒绝跨站请求');
    if(req.method==='GET'&&req.url==='/'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});return res.end(fs.readFileSync(path.join(here,'panel.html')));
    }
    if(req.method==='GET'&&req.url==='/panel-client.js'){res.writeHead(200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'});return res.end(fs.readFileSync(path.join(here,'panel-client.js')));}
    if(req.headers['x-bili-panel']!=='1')return fail(res,403,'缺少本地面板请求标记');
    if(closing)return fail(res,503,'插件正在关闭');
    const control=new AbortController();controllers.add(control);const signal=AbortSignal.any([control.signal,AbortSignal.timeout(60000)]);
    try{
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&url.pathname==='/api/state'){let recipients=[];try{recipients=host.recipients();}catch{}return json(res,{config:getConfig(),schema,status:getStatus(),recipients});}
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,await host.health(signal));
      if(req.method==='GET'&&url.pathname==='/api/report'){
        const date=url.searchParams.get('date')||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日报日期格式错误');const f=path.join(dir,'reports',date+(url.searchParams.get('preview')==='1'?'-preview':'')+'.md');return json(res,{text:fs.existsSync(f)?fs.readFileSync(f,'utf8'):'当天还没有日报。'});
      }
      if(req.method!=='POST')return fail(res,404,'接口不存在');
      const body=await read(req);
      if(url.pathname==='/api/config'){const unknown=Object.keys(body).filter(k=>!Object.hasOwn(schema,k));if(unknown.length)throw new Error('未知配置项');const c=configOf({...getConfig(),...body});await host.saveSettings(c);return json(res,{ok:true,restart:c.panelPort!==port});}
      if(url.pathname==='/api/login/start'){const q=await bili.loginStart(signal);return json(res,{image:await QR.toDataURL(q.url,{width:240,margin:2}),state:'waiting'});}
      if(url.pathname==='/api/login/poll')return json(res,await bili.loginPoll(signal));
      if(url.pathname==='/api/login/check')return json(res,await bili.account(signal));
      if(url.pathname==='/api/login/logout'){engine.cancel();bili.logout();return json(res,{ok:true});}
      if(url.pathname==='/api/run'){
        if(engine.coordinator.busy)throw new Error('已有一轮在运行');
        const c=configOf(getConfig());if(!c.topics)throw new Error('请先填写关键词并保存');if(!bili.loggedIn)throw new Error('请先扫码登录 B 站');
        engine.run({preview:body.preview===true}).catch(e=>{engine.lastError=clean(e.message);log(e.message);});return json(res,{ok:true});
      }
      if(url.pathname==='/api/stop'){engine.cancel();return json(res,{ok:true});}
      return fail(res,404,'接口不存在');
    }finally{controllers.delete(control);}
  }
  return {
    async start(){if(server)return;closing=false;port=configOf(getConfig()).panelPort;const s=http.createServer((req,res)=>handle(req,res).catch(e=>{if(!res.headersSent)fail(res,400,clean(e.message,400));else res.end();}));server=s;s.requestTimeout=65000;
      try{await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',resolve);});s.on('error',e=>log(e.message));log('刷 B 站操作面板：http://127.0.0.1:'+port+'/');}catch(e){server=null;throw e;}
    },
    async stop(){closing=true;for(const c of controllers)c.abort(new Error('插件关闭'));controllers.clear();const s=server;server=null;if(s){s.closeAllConnections?.();await new Promise(r=>s.close(r));}}
  };
}
