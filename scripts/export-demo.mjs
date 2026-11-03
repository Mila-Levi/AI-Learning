import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=path=>readFileSync(join(root,path),'utf8');
const demoStyles=`.demo-bar{background:#eaf0e2;border-bottom:1px solid #d4dfc8;padding:15px 6%;display:flex;gap:15px;justify-content:space-between;align-items:center}.demo-bar strong{display:block;font-size:14px}.demo-bar span{display:block;font-size:11px;color:#68795e;margin-top:5px;line-height:1.7}.demo-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.demo-controls label{margin:0;font-size:11px;white-space:nowrap}.demo-controls select{width:160px;padding:8px;background:white}.demo-controls button{font-size:11px;white-space:nowrap}@media(max-width:900px){.demo-bar{display:block;padding:15px 20px}.demo-controls{margin-top:12px}.demo-controls select{flex:1;max-width:190px}.demo-controls .text-button{min-height:35px}}`;
let html=read('public/index.html')
  .replace('<title>湖心追踪 · 抓人游戏</title>','<title>湖心追踪 · 可直接打开的网页体验版</title>')
  .replace('<link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script>',`<style>${read('public/style.css')}\n${demoStyles}</style>`)
  .replace('href="/" aria-label','href="#" aria-label')
  .replace('基础版 · 0.1','本机体验版 · 0.1')
  .replace('复制邀请链接','复制房间码')
  .replace('同一房间内，消息与成员状态实时同步。','本机体验流程；多设备联机需部署服务器。')
  .replace('例如 628391','示例房间 628391')
  .replace('关闭后，其他成员包括主持人都收不到你的坐标。','本文件只在当前浏览器演示，不向其他手机发送位置。')
  .replace('基础版仅供演练 · 技能卡 / 游戏计时 / 胜负判定尚未接入','本机体验文件 · 数据仅保存在此浏览器 · 不提供真实多人通信')
  .replace('</body>',`<script>${read('scripts/demo-adapter.js')}</script><script>${read('public/app.js').replaceAll("'lake-token'","'lake-demo-token'")}
const originalLeave = $('leave').onclick;
$('leave').textContent = '返回加入页';
$('leave').onclick = async () => { sessionStorage.setItem('lake-demo-show-entry', '1'); await originalLeave(); };
</script></body>`);
mkdirSync(join(root,'dist'),{recursive:true});
const output=join(root,'dist','湖心追踪-网页体验版.html');writeFileSync(output,html);console.log(output);
writeFileSync(join(root,'..','抓人游戏-直接打开测试.html'),html);
