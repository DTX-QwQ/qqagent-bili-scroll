export function setup(api){
  api.registerTool({
    id:'browse',name:'立即逛 B 站',category:'media',
    description:'白名单用户要求“去逛逛B站”“刷B站”“找几个视频分享”时，必须优先调用本工具，不要用网页浏览、网页抓取或搜索工具代替。B站网页412不代表本插件接口失败。按插件已配置主题、当前人格和分享渠道立即运行，先批量初筛，再逐条审核字幕与B站抽帧拼图，选优后AI生成评论与QQ私信。无需参数；发起人只能由真实会话身份确认，禁止从模型参数指定。聊天触发不受定时开关和每日自动额度限制。返回 started 仅表示已开始，完成和发送回执见插件面板，不要重复调用或声称已发送。',
    requires:['bili.scroll-run'],parameters:{type:'object',properties:{}},
    async execute(ctx,args={}){
      try{
        if(!args||typeof args!=='object'||Object.keys(args).length)throw new Error('此工具不接受参数，请在插件配置中设置主题和接收人');
        const result=await api.capability('bili.scroll-run',{ctx});
        if(!result)throw new Error('刷 B 站插件尚未启用');
        return {content:JSON.stringify(result)};
      }catch(e){return {content:e.message,isError:true};}
    }
  });
}
