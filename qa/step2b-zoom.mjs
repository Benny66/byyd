// Round 1 / step 2b: 放大取证 844x390 的裁切区 + 精确几何
import fs from 'node:fs';
import { launch, sleep, evalJs, clickId, screenshot } from './cdp.mjs';

const FILE = 'file:///Users/shahao/Project/byyd/deliverables/beiyun-30min.html';
const out = {};
const { proc, client: c } = await launch({ port: 9343 });
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Page.navigate', { url: FILE });
  await sleep(1200);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390 });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(500);

  out.geom = await evalJs(c, `(function(){
    var q=function(s){var e=document.querySelector(s),r=e.getBoundingClientRect(),cs=getComputedStyle(e);
      return {sel:s, top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1), h:+r.height.toFixed(1), overflow:cs.overflow, clipH: e.scrollHeight>e.clientHeight+1};};
    var stage=document.querySelector('.stage');
    var sr=stage.getBoundingClientRect();
    var nl=document.getElementById('nextLine').getBoundingClientRect();
    var pr=document.querySelector('.progress').getBoundingClientRect();
    var ct=document.querySelector('.controls').getBoundingClientRect();
    return {
      stage: {top:+sr.top.toFixed(1), bottom:+sr.bottom.toFixed(1), h:+sr.height.toFixed(1), clientH:stage.clientHeight, scrollH:stage.scrollHeight, clipped: stage.scrollHeight>stage.clientHeight+1},
      nextLine: {top:+nl.top.toFixed(1), bottom:+nl.bottom.toFixed(1), h:+nl.height.toFixed(1)},
      progress: {top:+pr.top.toFixed(1), bottom:+pr.bottom.toFixed(1)},
      controls: {top:+ct.top.toFixed(1), bottom:+ct.bottom.toFixed(1)},
      nextLineHiddenByStage: +(nl.bottom - sr.bottom).toFixed(1),
      nextLineOverlapsProgress: +(nl.bottom - pr.top).toFixed(1),
      btnHeight: +document.getElementById('btnNext').getBoundingClientRect().height.toFixed(1),
      btnFont: getComputedStyle(document.getElementById('btnNext')).fontSize
    };
  })()`);

  // 放大截取 stage 底部 60px（即被裁切的"下一个"）
  const clip = { x: 0, y: 280, width: 844, height: 70, scale: 3 };
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  fs.writeFileSync('/Users/shahao/Project/byyd/qa/shots/844x390-zoom-nextline.png', Buffer.from(r.data, 'base64'));

  // 手机按钮高度（触控目标尺寸）
  const m = await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await sleep(400);
  out.phone = await evalJs(c, `(function(){
    var b=document.getElementById('btnNext').getBoundingClientRect();
    var p=document.querySelector('.controls').getBoundingClientRect();
    return {btnH:+b.height.toFixed(1), btnW:+b.width.toFixed(1), ctrlTop:+p.top.toFixed(1), ctrlBottom:+p.bottom.toFixed(1), rows: document.querySelectorAll('.controls .btn').length};
  })()`);
} catch (e) { out.fatal = String(e); } finally { try { c.close(); } catch (e) {} proc.kill('SIGKILL'); }
console.log(JSON.stringify(out, null, 2));
