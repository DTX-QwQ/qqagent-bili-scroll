import fs from 'node:fs';
import {build} from 'esbuild';
import {DEFAULTS,schema} from './plugins/bili-scroll/core.js';
const dir='plugins/bili-scroll';
fs.writeFileSync(dir+'/plugin.json',JSON.stringify({id:'bili-scroll',name:'刷 B 站',version:'1.1.2',apiVersion:1,category:'media',description:'批量初筛、按当前人设逐条审字幕与B站抽帧拼图，择优后AI生成评论与QQ私信。支持聊天立即逛B站。面板：http://127.0.0.1:3219/',enabledByDefault:true,permissions:['web_fetch'],capabilities:['bili.scroll-status','bili.scroll-run'],settings:DEFAULTS,configSchema:schema},null,2)+'\n');
await build({stdin:{contents:"module.exports = require('qrcode');",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',minify:true,outfile:dir+'/vendor/qrcode.cjs'});
fs.copyFileSync('node_modules/qrcode/license',dir+'/vendor/qrcode-LICENSE.txt');
