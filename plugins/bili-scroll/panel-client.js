const $=id=>document.getElementById(id);let first=true,loginTimer=null,polling=false,dirty=false;
document.addEventListener('input',e=>{if(e.target.dataset.key){dirty=true;$('saved').textContent='有未保存的修改';}});
async function api(route,body){const r=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'x-bili-panel':'1',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const j=await r.json();if(!r.ok)throw new Error(j.error||'操作失败');return j;}
function notice(text,error=false){const n=$('notice');n.style.display='block';n.className='notice';n.style.background=error?'#fff0f1':'#e9f6ee';n.style.color=error?'#a72e45':'#267344';n.textContent=text;}
function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function field(key,s,value,parent){
  const wrap=el('div',undefined,'field'+(s.type==='boolean'?' check':'')),label=el('label',s.label);label.htmlFor='f-'+key;
  const input=s.type==='enum'?el('select'):s.multiline?el('textarea'):el('input');input.id='f-'+key;input.dataset.key=key;input.dataset.type=s.type;
  if(s.type==='boolean'){input.type='checkbox';input.checked=value===true;wrap.append(input,label);}
  else{if(s.type==='enum')for(const v of s.values){const o=el('option',v);o.value=v;input.append(o);}else if(s.type==='number')input.type='number';input.value=value??'';wrap.append(label,input);}
  wrap.append(el('div',s.description,'hint'));parent.append(wrap);
}
function renderFields(s){const groups={topics:['topics'],preferences:['extraPrompt'],qqFields:['qqEnabled','qqWhitelist'],biliFields:['commentEnabled','mentionUid','mentionName','maxComments'],schedule:['autoEnabled','runTimes','chatEnabled'],advanced:['timeZone','maxDaily','maxPerRun','maxCandidates','maxStoryboards','recentDays','minScore','reportMode','panelPort']};for(const [group,keys] of Object.entries(groups))for(const key of keys)field(key,s.schema[key],s.config[key]??({maxPerRun:3,maxStoryboards:3,chatEnabled:true}[key]),$(group));}
const names={done:'完成',partial:'部分完成',failed:'失败',stopped:'已停止',sent:'已发送',pending:'待确认（不会自动重发）',unknown:'结果未知（不会自动重发）',rejected:'被拒绝',accepted:'接口已接受'};
function render(s){
  if(first){renderFields(s);first=false;}
  if(!dirty)for(const x of document.querySelectorAll('[data-key]')){if(x.dataset.type==='boolean')x.checked=s.config[x.dataset.key]===true;else x.value=s.config[x.dataset.key]??'';}
  const st=s.status;$('phase').textContent=st.phase;
  for(const id of ['preview','run'])$(id).disabled=st.busy;$('stop').disabled=!st.busy;
  if(!loginTimer)$('loginMessage').textContent=st.credentialSaved?'已保存登录凭证；可点“检查登录”确认有效。':'尚未登录 B 站。';
  $('error').replaceChildren();const errors=[st.configError,st.lastError].filter(Boolean);if(errors.length)$('error').append(el('p',errors.join('\n'),'notice'));
  $('recipients').replaceChildren();if(!s.recipients.length)$('recipients').append(el('p','白名单为空，不会向任何人发送。','hint'));
  else for(const r of s.recipients)$('recipients').append(el('p',r.uid+' · '+(r.error||'主程序私聊名单校验通过；QQ 连接状态见下方检查'),r.error?'notice':'hint'));
  $('items').replaceChildren();$('items').className='';
  const lastPreview=st.runs[0]?.preview?st.runs[0]:null;const items=lastPreview?(lastPreview.selected||[]).slice(0,8):st.items.slice(0,8);
  if(!items.length)$('items').append(el('div','还没有推荐。先填写主题、扫码并试跑。','empty'));
  for(const v of items){const box=el('div',undefined,'item');const a=el('a',v.title);a.href='https://www.bilibili.com/video/'+v.bvid+'/';a.target='_blank';a.rel='noopener noreferrer';box.append(a,el('p',v.reason),el('span',`${v.score} 分 · ${v.scope}`,'tag'));if(v.visualEvidence)box.append(el('p','画面依据：'+v.visualEvidence));if(v.drafts){box.append(el('p','AI 私信草稿：'+v.drafts.qq),el('p','AI 评论草稿：'+v.drafts.comment));}for(const [uid,d] of Object.entries(v.qq||{})){box.append(el('span',`QQ ${uid}：${names[d.status]||d.status}`,'tag'));if(d.error)box.append(el('p',d.error,'notice'));}if(v.comment)box.append(el('span','B站：'+(names[v.comment.status]||v.comment.status),'tag'));if(lastPreview)box.append(el('span','仅预览，未发送','tag'));$('items').append(box);}
  $('runs').replaceChildren();if(!st.runs.length)$('runs').append(el('p','暂无记录。','hint'));
  for(const r of st.runs.slice(0,8)){
    const box=el('div',undefined,'item');box.append(el('div',`${r.preview?'预览':'正式'} · ${names[r.status]||r.status} · ${r.day}`),el('p',`检查 ${r.scanned} / 推荐 ${r.selected.length} / 跳过 ${r.skipped.length} / 问题 ${r.errors.length}`));
    if(r.topics)box.append(el('p',`本轮主题：${r.topics}（${r.topicSource==='chat'?'聊天临时指定':'配置关键词'}）`,'hint'));
    if(r.errors.length)box.append(el('div',r.errors.join('\n'),'notice'));
    for(const [uid,summary] of Object.entries(r.summaries||{})){
      const details=el('details');details.append(el('summary',`本轮 AI 总结 · ${uid==='local'?'本地草稿':'QQ '+uid} · ${names[summary.status]||({draft:'仅草稿，未发送',generating:'生成中'}[summary.status])||summary.status}`));
      for(const part of summary.parts||[])details.append(el('pre',part.text));
      if(summary.error)details.append(el('p',summary.error,'notice'));box.append(details);
    }
    if(r.summarySkipped||r.summaryError)box.append(el('p',r.summarySkipped||r.summaryError,'hint'));
    const b=el('button','查看日报');b.onclick=()=>action(async()=>{const d=await api(`report?date=${r.day}&preview=${r.preview?1:0}`);$('report').hidden=false;$('report').textContent=d.text;});box.append(b);$('runs').append(box);
  }
}
async function refresh(){if(polling)return;polling=true;try{render(await api('state'));}catch(e){$('phase').textContent='连接中断：'+e.message;}finally{polling=false;}}
async function action(fn){try{await fn();await refresh();}catch(e){notice(e.message,true);}}
$('save').onclick=()=>action(async()=>{const c={};for(const x of document.querySelectorAll('[data-key]'))c[x.dataset.key]=x.dataset.type==='boolean'?x.checked:x.dataset.type==='number'?Number(x.value):x.value;const r=await api('config',c);dirty=false;notice(r.restart?'已保存。端口改变后，请在 QQ Agent 关闭再开启插件。':'设置已保存');$('saved').textContent='已保存 '+new Date().toLocaleTimeString();});
$('login').onclick=()=>action(async()=>{clearInterval(loginTimer);loginTimer=null;const q=await api('login/start',{});$('qr').src=q.image;$('qr').style.display='block';$('loginMessage').textContent='请用手机 B 站扫码并确认';let busy=false;loginTimer=setInterval(async()=>{if(busy)return;busy=true;try{const p=await api('login/poll',{});$('loginMessage').textContent=({waiting:'等待扫码…',scanned:'已扫码，请在手机确认',ok:'登录成功',expired:'二维码已过期，请重新扫码',unknown:'登录状态暂未确认'})[p.state];if(['ok','expired'].includes(p.state)){clearInterval(loginTimer);loginTimer=null;$('qr').style.display='none';await refresh();}}catch(e){clearInterval(loginTimer);loginTimer=null;notice(e.message,true);}finally{busy=false;}},2500);});
$('check').onclick=()=>action(async()=>{const r=await api('login/check',{});notice(r.loggedIn?'已登录：'+r.name+'（UID '+r.uid+'）':'登录已失效，请重新扫码',!r.loggedIn);});
$('logout').onclick=()=>action(async()=>{clearInterval(loginTimer);loginTimer=null;await api('login/logout',{});$('qr').style.display='none';notice('已清除本机登录凭证');});
for(const id of ['preview','run'])$(id).onclick=()=>action(async()=>{await api('run',{preview:id==='preview'});notice(id==='preview'?'已开始预览，不会发送消息':'已开始正式运行，使用已保存的设置');});
$('stop').onclick=()=>action(async()=>{await api('stop',{});notice('已请求停止；已提交的消息无法撤回');});
async function checkHealth(){
  $('healthCheck').disabled=true;$('health').replaceChildren(el('p','正在检查…','hint'));
  try{const h=await api('health');$('health').replaceChildren();for(const [title,item,ok] of [['聊天启动工具',h.chat,h.chat.toolEnabled],['QQ 私信连接',h.qq,h.qq.connected&&!h.qq.paused]])$('health').append(el('p',title+'：'+(ok?'就绪':item.reason||'未就绪'),ok?'hint':'notice'));}
  catch(e){$('health').replaceChildren(el('p','本地控制台检查失败：'+e.message,'notice'));}
  finally{$('healthCheck').disabled=false;}
}
$('healthCheck').onclick=checkHealth;
checkHealth();
refresh();setInterval(refresh,4000);
