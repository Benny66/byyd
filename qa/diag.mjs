// 诊断：Date.now 覆盖是否生效 / rAF 是否在 headless 中运行
import { launch, sleep, evalJs, clickId, readState } from './cdp.mjs';
const FILE = 'file:///Users/shahao/Project/byyd/deliverables/beiyun-30min.html';
const { proc, client: c } = await launch({ port: 9345 });
const out = {};
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Page.navigate', { url: FILE });
  await sleep(1200);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false, screenWidth: 1366, screenHeight: 768 });
  await sleep(300);

  // rAF 是否推进
  out.rafProbe = await evalJs(c, `new Promise(function(res){ var n=0; var t0=performance.now(); var f=function(){ n++; if(performance.now()-t0<1000) requestAnimationFrame(f); else res({frames:n, ms: Math.round(performance.now()-t0)}); }; requestAnimationFrame(f); setTimeout(function(){ res({frames:n, timeout:true}); }, 2500); })`);
  out.visibility = await evalJs(c, `({hidden: document.hidden, state: document.visibilityState, hasFocus: document.hasFocus()})`);

  await clickId(c, 'btnPlay'); await sleep(1200);
  out.before = (await readState(c)).countdown;

  out.patchResult = await evalJs(c, `(function(){
    window.__realNow = Date.now;
    window.__jumpAcc = 125000;
    Date.now = function(){ return window.__realNow() + window.__jumpAcc; };
    return { patched: Date.now() - window.__realNow(), same: Date.now === window.__realNow };
  })()`);
  await sleep(150);
  out.afterPatchNoTick = (await readState(c)).countdown;
  out.dispatched = await evalJs(c, `document.dispatchEvent(new Event('visibilitychange')), 'dispatched'`);
  await sleep(600);
  const s = await readState(c);
  out.after = { cd: s.countdown, status: s.status, action: s.action, tag: s.tag, total: s.totalLeft };
  out.accNow = await evalJs(c, `Date.now() - window.__realNow()`);
} catch (e) { out.fatal = String(e && e.stack || e); } finally { try { c.close(); } catch (e) {} proc.kill('SIGKILL'); }
console.log(JSON.stringify(out, null, 2));
