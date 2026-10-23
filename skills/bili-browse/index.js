let skillApi;
export function setup(api){
  skillApi=api;
  api.registerTool({
    id:'browse',name:'立即逛 B 站',category:'media',
    description:'白名单用户要求“去逛逛B站”“刷B站”“找几个视频分享”时，必须优先调用本工具，不要用网页浏览、网页抓取或搜索工具代替。B站网页412不代表本插件接口失败。插件从实际触发消息识别主题：明确指定主题则仅本轮临时使用，未指定则按配置关键词正常运行，不改持久配置。按当前人格批量初筛，再逐条审核字幕与B站抽帧拼图，选优后AI生成评论与QQ私信。每轮结束生成一段简短总结，合并相似原因、略过低价值内容；开启QQ私聊分享后发给配置的白名单。无需参数；发起人只能由真实会话身份确认。聊天触发不受定时开关和每日自动额度限制。started仅表示已开始，以后台状态及总结为准，不要重复调用或声称已发送。',
    requires:['bili.scroll-run'],parameters:{type:'object',properties:{}},
    async execute(ctx,args={}){
      try{
        if(!args||typeof args!=='object'||Object.keys(args).length)throw new Error('此工具不接受参数；主题从实际触发消息识别或沿用配置，接收人只读插件配置');
        const result=await api.capability('bili.scroll-run',{ctx});
        if(!result)throw new Error('刷 B 站插件尚未启用');
        return {content:JSON.stringify(result)};
      }catch(e){return {content:e.message,isError:true};}
    }
  });
}
export function promptSections(){
  const status=skillApi?.capability('bili.scroll-status');
  if(!status?.active)return [];
  return [{id:'bili-browse-live-state',title:'刷 B 站实时状态',priority:71,content:status.busy?'刷 B 站后台当前仍在处理一轮（包括结束总结的生成和投递）。不要重复启动；是否已发送以实际私信和回执为准。':'刷 B 站后台当前没有进行中的轮次。此前 started 仅是当时启动的回执，不能据此认定仍在刷。结束总结简短概括结果与主要原因，不逐条列举，零推荐也说明结束；总结未送达不代表后台仍在运行。只有用户新提出刷站请求时才启动下一轮。'}];
}
