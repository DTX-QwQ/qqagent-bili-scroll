import crypto from 'node:crypto';
import path from 'node:path';
const {clean,readJson,writeJson}=await import(new URL('./core.js'+new URL(import.meta.url).search,import.meta.url));
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MIX=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
function storyboardDimension(value){
  const n=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value.trim()):NaN;
  return Number.isInteger(n)&&n>=1&&n<=4096?n:null;
}
export function signed(params,key,now=Date.now()) {const p={...params,wts:Math.floor(now/1000)};const q=Object.keys(p).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g,''))}`).join('&');return q+'&w_rid='+crypto.createHash('md5').update(q+key).digest('hex');}
export function cookiesOf(headers){const out={};for(const line of headers.getSetCookie?.()||[]){const first=line.split(';')[0],at=first.indexOf('=');if(at<1)continue;const k=first.slice(0,at);if(['SESSDATA','bili_jct','DedeUserID','buvid3','buvid4'].includes(k))out[k]=first.slice(at+1);}return out;}
export class Bilibili {
  constructor({fetch,dir,check=()=>{}}){this.fetch=fetch;this.file=path.join(dir,'credential.json');this.jar=readJson(this.file,{});this.check=check;this.key='';this.keyAt=0;this.qr=null;}
  get loggedIn(){return Boolean(this.jar.SESSDATA&&this.jar.bili_jct);}
  async request(url,{signal,body,auth=true,raw=false,subtitle=false,binary=false}={}){
    this.check();signal?.throwIfAborted();const u=new URL(url);
    const allowed=binary?/^(?:[^.]+\.)*hdslb\.com$/.test(u.hostname)&&(/^(?:\/bfs\/videoshot\/|\/videoshotpv(?:hd|sd)boss\/)/.test(u.pathname)):subtitle?/^(?:[^.]+\.)*(?:hdslb\.com|bilibili\.com)$/.test(u.hostname):['api.bilibili.com','passport.bilibili.com'].includes(u.hostname);
    if(u.protocol!=='https:'||!allowed||u.username||u.password)throw new Error('拒绝非 B 站接口地址');
    const cookie=auth&&!binary?Object.entries(this.jar).map(([k,v])=>`${k}=${v}`).join('; '):'';
    const r=await this.fetch(u.href,{method:body?'POST':'GET',headers:{'user-agent':UA,referer:'https://www.bilibili.com/',...(cookie?{cookie}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},...(body?{body:new URLSearchParams(body).toString()}:{}),redirect:'error',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(25000)])});
    if(!r.ok)throw new Error(`B 站 HTTP ${r.status}（风控或网络异常时请稍后再试）`);
    const reader=r.body.getReader();let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3*1024*1024)throw new Error('B 站响应超过大小限制');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
    const buffer=Buffer.concat(chunks);if(binary){const mime=buffer[0]===255&&buffer[1]===216&&buffer[2]===255?'image/jpeg':buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':'';if(!mime)throw new Error('B 站抽帧拼图不是有效的 JPEG/PNG');return {buffer,mime};}
    let j;try{j=JSON.parse(buffer.toString('utf8'));}catch{throw new Error('B 站返回的不是 JSON，可能触发风控');}
    if(!subtitle&&j.code!==0){const e=new Error(`B 站接口拒绝（${j.code}）：${clean(j.message||j.msg,160)}`);e.definite=true;throw e;}
    return raw?{data:j.data,headers:r.headers}:subtitle?j:j.data;
  }
  async fingerprint(signal){if(this.jar.buvid3)return;const d=await this.request('https://api.bilibili.com/x/frontend/finger/spi',{signal,auth:false});this.jar.buvid3=d.b_3;this.jar.buvid4=d.b_4;}
  async wbi(signal){if(this.key&&Date.now()-this.keyAt<3600000)return this.key;const d=await this.request('https://api.bilibili.com/x/web-interface/nav',{signal});const stem=x=>new URL(x).pathname.split('/').pop().split('.')[0];const src=stem(d.wbi_img.img_url)+stem(d.wbi_img.sub_url);this.key=MIX.map(i=>src[i]).join('').slice(0,32);this.keyAt=Date.now();return this.key;}
  async signedRequest(route,params,signal){return this.request('https://api.bilibili.com'+route+'?'+signed(params,await this.wbi(signal)),{signal});}
  async loginStart(signal){const d=await this.request('https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header',{signal,auth:false});if(!d?.qrcode_key||!d?.url)throw new Error('二维码生成失败');this.qr={key:d.qrcode_key,at:Date.now()};return {url:d.url};}
  async loginPoll(signal){
    if(!this.qr||Date.now()-this.qr.at>180000)return {state:'expired'};
    const attempt=this.qr;
    const r=await this.request('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key='+encodeURIComponent(attempt.key),{signal,auth:false,raw:true});
    signal?.throwIfAborted();if(this.qr!==attempt)return {state:'expired'};
    if(r.data.code!==0)return {state:({86101:'waiting',86090:'scanned',86038:'expired'})[r.data.code]||'unknown'};
    const jar=cookiesOf(r.headers);if(!jar.SESSDATA||!jar.bili_jct)throw new Error('登录响应未包含完整凭证，请重新扫码');
    // Commit immediately after the identity check; logout cannot be undone by a late poll.
    this.jar=jar;this.key='';writeJson(this.file,this.jar);this.qr=null;return {state:'ok'};
  }
  logout(){this.jar={};this.key='';this.qr=null;writeJson(this.file,{});}
  async account(signal){const d=await this.request('https://api.bilibili.com/x/web-interface/nav',{signal});return {loggedIn:d.isLogin===true,name:clean(d.uname),uid:String(d.mid)};}
  async search(keyword,signal){await this.fingerprint(signal);const d=await this.signedRequest('/x/web-interface/wbi/search/type',{search_type:'video',keyword,order:'pubdate',page:1,page_size:20},signal);return (d.result||[]).filter(x=>/^BV[a-zA-Z0-9]{10}$/.test(x.bvid)).map(x=>({bvid:x.bvid,title:clean(x.title),author:clean(x.author),description:clean(x.description,1000),category:clean(x.typename),duration:clean(x.duration),pubdate:Number(x.pubdate)}));}
  async video(bvid,signal){if(!/^BV[a-zA-Z0-9]{10}$/.test(bvid))throw new Error('BV 号无效');const d=await this.request('https://api.bilibili.com/x/web-interface/view?bvid='+bvid,{signal});return {bvid,aid:d.aid,cid:d.cid||d.pages?.[0]?.cid,title:clean(d.title),author:clean(d.owner?.name),pubdate:d.pubdate,description:clean(d.desc,1200),parts:d.pages?.length||1};}
  async subtitle(video,signal){const d=await this.signedRequest('/x/player/wbi/v2',{bvid:video.bvid,cid:video.cid},signal);const subs=d.subtitle?.subtitles||[];const sub=subs.find(s=>['zh-CN','zh-Hans','zh','ai-zh'].includes(s.lan))||subs[0];if(!sub?.subtitle_url)return null;const url=sub.subtitle_url.startsWith('//')?'https:'+sub.subtitle_url:sub.subtitle_url;const j=await this.request(url,{signal,auth:false,subtitle:true});const text=(j.body||[]).map(x=>String(x.content||'')).join('\n').trim();return text.length<20?null:{text,language:sub.lan_doc||sub.lan};}
  async storyboards(video,signal,max=3){
    const d=await this.request('https://api.bilibili.com/x/player/videoshot?'+new URLSearchParams({bvid:video.bvid,cid:String(video.cid),index:'1'}),{signal});
    if(!Array.isArray(d?.image)||!d.image.length)throw new Error('B 站没有生成抽帧拼图，跳过图文审核');
    // Dimensions describe the images; missing metadata must not discard usable images.
    // Never assume a default grid: doing so would invent frame/time associations.
    const [columns,rows,width,height]=['img_x_len','img_y_len','img_x_size','img_y_size'].map(k=>storyboardDimension(d[k]));
    const grid=columns&&rows?[columns,rows]:null,cell=width&&height?[width,height]:null;
    const warnings=[];
    if(!grid)warnings.push('拼图网格信息缺失或无效；列数、行数及各帧对应时间未知，不得推断。');
    if(!cell)warnings.push('单帧尺寸信息缺失或无效，未使用默认尺寸。');
    if(!Array.isArray(d.index)||!d.index.length)warnings.push('接口未提供时间索引，各帧秒数未知。');
    const count=d.image.length;if(count>200||!Number.isInteger(max)||max<1||max>8)throw new Error('B 站抽帧拼图数量无效');
    const selected=[...new Set(Array.from({length:Math.min(max,count)},(_,i)=>Math.round(i*(count-1)/Math.max(1,Math.min(max,count)-1))))];
    const images=[];for(const index of selected){const source=String(d.image[index]);const url=source.startsWith('//')?'https:'+source:source.replace(/^http:/,'https:');const {buffer,mime}=await this.request(url,{signal,binary:true,auth:false});images.push({sheet:index+1,url:'data:'+mime+';base64,'+buffer.toString('base64')});}
    const per=grid?columns*rows:0;
    return {images,metadata:{source:'B站原生 videoshot 抽帧拼图',totalSheets:count,selectedSheets:selected.map(i=>i+1),sampled:selected.length<count,grid,cell,warnings,order:'从左到右、从上到下；抽帧仅表示部分画面，不等于完整观看视频',times:selected.map(i=>({sheet:i+1,seconds:per&&Array.isArray(d.index)?d.index.slice(1+i*per,1+(i+1)*per):[]}))}};
  }
  async mention(c,signal){
    if(c.mentionUid){const d=await this.signedRequest('/x/space/wbi/acc/info',{mid:c.mentionUid},signal);if(!d.name||String(d.mid)!==c.mentionUid)throw new Error('找不到要 @ 的 B 站用户');if(c.mentionName&&c.mentionName!==d.name)throw new Error('填写的 UID 与昵称不属于同一用户');return {uid:String(d.mid),name:d.name};}
    if(!c.mentionName)throw new Error('请先填写要 @ 的 B 站用户');
    const d=await this.signedRequest('/x/web-interface/wbi/search/type',{search_type:'bili_user',keyword:c.mentionName,page:1},signal);const hits=(d.result||[]).filter(x=>x.uname===c.mentionName);if(hits.length!==1)throw new Error('昵称未精确匹配到唯一用户，请填写 UID');return {uid:String(hits[0].mid),name:hits[0].uname};
  }
  async comment(video,target,text,signal){
    if(!this.loggedIn)throw new Error('请先扫码登录 B 站');
    const name=String(target.name);if(/[\r\n@]/.test(name)||!/^\d+$/.test(target.uid))throw new Error('@ 对象格式不正确');
    if(typeof text!=='string'||!text.trim()||text.length>500||/@|\[CQ:|https?:\/\//i.test(text))throw new Error('缺少有效 AI 评论正文');
    const message=`@${name} ${text.trim()}`;
    const d=await this.request('https://api.bilibili.com/x/v2/reply/add',{signal,body:{oid:String(video.aid),type:'1',message,plat:'1',csrf:this.jar.bili_jct,csrf_token:this.jar.bili_jct,at_name_to_mid:JSON.stringify({[name]:target.uid})}});
    const rawId=d.rpid_str||d.reply?.rpid_str||d.rpid||d.reply?.rpid||'';
    const rpid=String(rawId);if((typeof rawId==='number'&&!Number.isSafeInteger(rawId))||! /^[1-9]\d*$/.test(rpid))throw new Error('B 站未返回评论编号或编号精度不完整，结果不明确，不自动重发');
    return {rpid,message,visibility:'接口已接受；公开可见性未确认'};
  }
}
