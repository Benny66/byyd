// Round 1 / step 2c: 多视口裁切扫描（找出裁切边界）+ 完成屏音效窗口复测
import fs from 'node:fs';
import { launch, sleep, evalJs, clickId, screenshot } from './cdp.mjs';

const FILE = 'file:///Users/shahao/Project/byyd/deliverables/beiyun-30min.html';
const VPS = [
  { n: '1280x720', w: 1280, h: 720, m: false },   // 最常见的电视分辨率
  { n: '1920x1080', w: 1920, h: 1080, m: false },
  { n: '1024x600', w: 1024, h: 600, m: false },   // 便宜盒子/老投影
  { n: '1024x768', w: 1024, h: 768, m: false },
  { n: '844x390', w: 844, h: 390, m: true },
  { n: '812x375', w: 812, h: 375, m: true },
  { n: '667x375', w: 667, h: 375, m: true },
  { n: '568x320', w: 568, h: 320, m: true },
  { n: '740x360', w: 740, h: 360, m: true },
  { n: '390x844', w: 390, h: 844, m: true },
  { n: '360x640', w: 360, h: 640, m: true },
];
const probe = `(function(){
  var st=document.querySelector('.stage'), sr=st.getBoundingClientRect();
  var nl=document.getElementById('nextLine');
  var nlr=nl.getBoundingClientRect();
  var pr=document.querySelector('.progress').getBoundingClientRect();
  var ct=document.querySelector('.controls').getBoundingClientRect();
  var an=document.getElementById('actionName').getBoundingClientRect();
  var tp=document.querySelector('.line.tips').getBoundingClientRect();
  var de=document.documentElement;
  return {
    vp: innerWidth+'x'+innerHeight,
    scrollbars: de.scrollWidth>innerWidth+1 || de.scrollHeight>innerHeight+1,
    stageClipped: st.scrollHeight>st.clientHeight+1,
    stageOverflowPx: +(st.scrollHeight-st.clientHeight).toFixed(1),
    nextLineClippedPx: +(nlr.bottom - sr.bottom).toFixed(1),
    controlsTop: +ct.top.toFixed(1),
    nextLineBottom: +nlr.bottom.toFixed(1),
    actionBottom: +an.bottom.toFixed(1),
    tipsBottom: +tp.bottom.toFixed(1),
    countdownFont: getComputedStyle(document.getElementById('countdown')).fontSize,
    actionFont: getComputedStyle(document.getElementById('actionName')).fontSize,
    tipsFont: getComputedStyle(document.querySelector('.line.tips')).fontSize,
    btnFont: getComputedStyle(document.getElementById('btnNext')).fontSize,
    btnH: +document.getElementById('btnNext').getBoundingClientRect().height.toFixed(1),
    ctrlBottom: +ct.bottom.toFixed(1),
    vh: innerHeight
  };
})()`;

const out = [];
const { proc, client: c } = await launch({ port: 9347 });
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Page.navigate', { url: FILE });
  await sleep(1300);
  for (const v of VPS) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.m, screenWidth: v.w, screenHeight: v.h });
    await c.send('Emulation.setTouchEmulationEnabled', v.m ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await sleep(350);
    const p = await evalJs(c, probe);
    // 休息态再测一次（休息文案更短，但要确认"接下来"可见）
    await clickId(c, 'btnReplay'); await sleep(120); await clickId(c, 'btnPlay'); await sleep(60);
    for (let i = 0; i < 4; i++) { await clickId(c, 'btnNext'); await sleep(25); }
    await sleep(120);
    const pr2 = await evalJs(c, probe);
    out.push({ vp: v.n, exercise: p, rest: pr2 });
    if (v.n === '667x375' || v.n === '568x320') {
      await screenshot(c, `/Users/shahao/Project/byyd/qa/shots/${v.n}-rest.png`, { width: v.w, height: v.h, mobile: v.m });
    }
    console.log(v.n, '| ex overlap', p.nextLineClippedPx, '| rest overlap', pr2.nextLineClippedPx, '| stageOverflow', p.stageOverflowPx, '| scrollbar', p.scrollbars);
  }
} catch (e) { out.push({ fatal: String(e) }); } finally { try { c.close(); } catch (e) {} proc.kill('SIGKILL'); }
fs.writeFileSync('/Users/shahao/Project/byyd/qa/out-sweep.json', JSON.stringify(out, null, 2));
