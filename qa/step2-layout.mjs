// Round 1 / step 2: viewport layout probing + screenshots (exercise / rest / finish)
import fs from 'node:fs';
import { launch, sleep, evalJs, clickId, readState, screenshot } from './cdp.mjs';

const FILE = 'file:///Users/shahao/Project/byyd/deliverables/beiyun-30min.html';
const SHOTS = '/Users/shahao/Project/byyd/qa/shots';

const PROBE = `(function(){
  var vw = innerWidth, vh = innerHeight;
  var de = document.documentElement;
  function info(sel){
    var e = document.querySelector(sel); if(!e) return null;
    var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return { sel:sel,
      x:+r.left.toFixed(1), y:+r.top.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
      right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1),
      font:cs.fontSize, fontSizePx:parseFloat(cs.fontSize),
      scrollH:e.scrollHeight, clientH:e.clientHeight,
      scrollW:e.scrollWidth, clientW:e.clientWidth,
      vClip: e.scrollHeight > e.clientHeight+1,
      hClip: e.scrollWidth > e.clientWidth+1,
      visible: cs.display!=='none' && cs.visibility!=='hidden' && +cs.opacity>0
    };
  }
  var sels = ['.app','.topbar','.ring-wrap','#countdown','#phaseTag','.info','#actionName','.line.tips','.line.breathe','#nextLine','.progress','.controls','#btnPlay','#btnPrev','#btnNext','#btnReplay','#btnSound','#btnVoice','#btnFull',
    '.finish','.finish-title','.finish-sub','.finish-warn'];
  var els = {};
  sels.forEach(function(s){ var i = info(s); if(i) els[s]=i; });

  // 控制栏按钮两两重叠
  var btns = Array.prototype.slice.call(document.querySelectorAll('.controls .btn'));
  var rects = btns.map(function(b){ var r=b.getBoundingClientRect(); return {id:b.id, l:r.left,t:r.top,r:r.right,b:r.bottom}; });
  var overlaps = [];
  for(var i=0;i<rects.length;i++) for(var j=i+1;j<rects.length;j++){
    var a=rects[i], b=rects[j];
    var ox = Math.min(a.r,b.r)-Math.max(a.l,b.l), oy = Math.min(a.b,b.b)-Math.max(a.t,b.t);
    if(ox > 1 && oy > 1) overlaps.push(a.id+'/'+b.id+'('+ox.toFixed(0)+'x'+oy.toFixed(0)+')');
  }
  // 控制栏是否换行
  var rows = {};
  rects.forEach(function(r){ rows[Math.round(r.t)] = (rows[Math.round(r.t)]||0)+1; });
  var rowCount = Object.keys(rows).length;

  // 超出视口的元素（只看可见、有尺寸的）
  var outOfView = [];
  Object.keys(els).forEach(function(s){
    var e = els[s]; if(!e || !e.visible || e.w<=0 || e.h<=0) return;
    if (s==='.finish') return;
    if (e.right > vw+1 || e.bottom > vh+1 || e.x < -1 || e.y < -1) {
      outOfView.push(s+' [x'+e.x+' y'+e.y+' r'+e.right+' b'+e.bottom+' vs '+vw+'x'+vh+']');
    }
  });

  // 主内容是否被 .stage 的 overflow:hidden 裁掉
  var stage = document.querySelector('.stage');
  var stageClip = { scrollH: stage.scrollHeight, clientH: stage.clientHeight, clipped: stage.scrollHeight > stage.clientHeight+1 };
  // 文本被省略号截断
  var ellipsis = [];
  ['#nextLine','#actionName','.line.tips','.line.breathe'].forEach(function(s){
    var e=document.querySelector(s); if(!e) return;
    if (e.scrollWidth > e.clientWidth+1) ellipsis.push(s+' (scrollW '+e.scrollWidth+' > clientW '+e.clientWidth+')');
  });

  return {
    vw:vw, vh:vh,
    docScrollW: de.scrollWidth, docScrollH: de.scrollHeight,
    scrollbar: (de.scrollWidth > vw+1 || de.scrollHeight > vh+1),
    fonts: { countdown: els['#countdown'] && els['#countdown'].font, action: els['#actionName'] && els['#actionName'].font, tips: els['.line.tips'] && els['.line.tips'].font, btn: els['.controls'] && els['#btnPrev'] && els['#btnPrev'].font },
    countdownIsLargest: (function(){
      var f=[['#countdown'],['#actionName'],['.line.tips'],['#btnPrev'],['#nextLine'],['.topbar']].map(function(k){ return els[k[0]] ? els[k[0]].fontSizePx : 0; });
      return f[0] >= Math.max.apply(null, f.slice(1));
    })(),
    ctrlRows: rowCount, btnOverlaps: overlaps,
    outOfView: outOfView, stageClip: stageClip, ellipsis: ellipsis,
    els: els
  };
})()`;

const VIEWPORTS = [
  { name: '1920x1080', w: 1920, h: 1080, mobile: false },
  { name: '1366x768', w: 1366, h: 768, mobile: false },
  { name: '1024x768', w: 1024, h: 768, mobile: false },
  { name: '390x844', w: 390, h: 844, mobile: true },
  { name: '844x390', w: 844, h: 390, mobile: true },
];

const report = { viewports: {}, console: [], exceptions: [] };
const { proc, client: c } = await launch({ port: 9342 });
try {
  c.on(m => {
    if (m.method === 'Runtime.consoleAPICalled') report.console.push({ level: m.params.type, text: m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ') });
    if (m.method === 'Runtime.exceptionThrown') report.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded') report.console.push({ level: 'log.' + m.params.entry.level, text: m.params.entry.text });
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: FILE });
  await sleep(1400);

  const jumpTo = async (n) => {
    await clickId(c, 'btnReplay'); await sleep(120);
    await clickId(c, 'btnPlay'); await sleep(80); // 暂停
    for (let i = 0; i < n; i++) { await clickId(c, 'btnNext'); await sleep(30); }
    await sleep(120);
  };

  for (const vp of VIEWPORTS) {
    const rec = {};
    await c.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile, screenWidth: vp.w, screenHeight: vp.h });
    await sleep(400);
    await c.send('Emulation.setTouchEmulationEnabled', vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await sleep(200);

    // 状态 1：动作中（第 1 个动作）
    await jumpTo(0);
    rec.exercise = await evalJs(c, PROBE);
    await screenshot(c, `${SHOTS}/${vp.name}-1-exercise.png`, { width: vp.w, height: vp.h, mobile: vp.mobile });

    // 状态 2：休息中
    await jumpTo(4);
    rec.rest = await evalJs(c, PROBE);
    rec.restState = await readState(c);
    await screenshot(c, `${SHOTS}/${vp.name}-2-rest.png`, { width: vp.w, height: vp.h, mobile: vp.mobile });

    // 状态 3：完成屏（跳到最后一阶段 → 用时钟跳跃触发 finish）
    await jumpTo(29);
    await clickId(c, 'btnPlay'); // 开始跑最后一阶段
    await sleep(150);
    await evalJs(c, `(function(){ var r=Date.now; window.__realNow=r; Date.now=function(){ return r()+61000; };
      document.dispatchEvent(new Event('visibilitychange')); return 'jumped'; })()`);
    await sleep(500);
    rec.finishState = await readState(c);
    rec.finish = await evalJs(c, PROBE);
    await screenshot(c, `${SHOTS}/${vp.name}-3-finish.png`, { width: vp.w, height: vp.h, mobile: vp.mobile });
    await evalJs(c, `(function(){ if(window.__realNow){ Date.now = window.__realNow; delete window.__realNow; } return 'restored'; })()`);

    report.viewports[vp.name] = rec;
    console.log(`[done] ${vp.name}`);
  }
} catch (e) {
  report.fatal = String(e && e.stack || e);
} finally {
  try { c.close(); } catch (e) {}
  proc.kill('SIGKILL');
}

fs.writeFileSync('/Users/shahao/Project/byyd/qa/out-layout.json', JSON.stringify(report, null, 2));

for (const [name, rec] of Object.entries(report.viewports)) {
  for (const state of ['exercise', 'rest', 'finish']) {
    const p = rec[state];
    if (!p) continue;
    console.log(`\n=== ${name} · ${state} ===`);
    console.log('  scrollbar:', p.scrollbar, '| docScroll', p.docScrollW + 'x' + p.docScrollH, 'vs', p.vw + 'x' + p.vh);
    console.log('  fonts:', JSON.stringify(p.fonts), '| countdownLargest:', p.countdownIsLargest);
    console.log('  ctrlRows:', p.ctrlRows, '| btnOverlaps:', JSON.stringify(p.btnOverlaps));
    console.log('  outOfView:', JSON.stringify(p.outOfView));
    console.log('  stageClip:', JSON.stringify(p.stageClip), '| ellipsis:', JSON.stringify(p.ellipsis));
    const e = p.els;
    console.log('  geom: countdown', JSON.stringify(e['#countdown'] && { y: e['#countdown'].y, h: e['#countdown'].h, font: e['#countdown'].font }),
      '| action', JSON.stringify(e['#actionName'] && { y: e['#actionName'].y, h: e['#actionName'].h, b: e['#actionName'].bottom }),
      '| tips', JSON.stringify(e['.line.tips'] && { y: e['.line.tips'].y, b: e['.line.tips'].bottom }),
      '| next', JSON.stringify(e['#nextLine'] && { y: e['#nextLine'].y, b: e['#nextLine'].bottom }),
      '| ctrl', JSON.stringify(e['.controls'] && { y: e['.controls'].y, b: e['.controls'].bottom }));
  }
}
if (report.fatal) console.log('\nFATAL:', report.fatal);
console.log('\nconsole:', JSON.stringify(report.console));
console.log('exceptions:', JSON.stringify(report.exceptions));
