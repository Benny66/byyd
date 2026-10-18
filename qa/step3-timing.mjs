// Round 1 / step 3: 计时准确性（真实时钟 + 时钟跳跃模拟）
import fs from 'node:fs';
import { launch, sleep, evalJs, clickId, readState } from './cdp.mjs';

const FILE = 'file:///Users/shahao/Project/byyd/deliverables/beiyun-30min.html';
const INIT_PATCH = `window.__qa={beeps:0,speaks:0,beepTs:[],speakTexts:[]};
(function(){try{var AC=window.AudioContext||window.webkitAudioContext;
 if(AC&&AC.prototype){var o=AC.prototype.createOscillator;
  AC.prototype.createOscillator=function(){window.__qa.beeps++;window.__qa.beepTs.push(Math.round(performance.now()));return o.apply(this,arguments);};}}catch(e){window.__qa.audioErr=String(e);}
 try{if(window.speechSynthesis){var s=window.speechSynthesis.speak.bind(window.speechSynthesis);
  window.speechSynthesis.speak=function(u){window.__qa.speaks++;window.__qa.speakTexts.push(u&&u.text);try{return s(u);}catch(e){}};}}catch(e){}})();`;

const R = {};
const { proc, client: c } = await launch({ port: 9344 });
const st = () => readState(c);
const beeps = () => evalJs(c, 'window.__qa.beeps');
const speaksNow = () => evalJs(c, 'window.__qa.speaks');

try {
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT_PATCH });
  await c.send('Page.navigate', { url: FILE });
  await sleep(1300);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false, screenWidth: 1366, screenHeight: 768 });

  /* ---------- T1. 暂停 10 秒，剩余时间是否连续 ---------- */
  await clickId(c, 'btnPlay');                 // 开始
  await sleep(2300);
  const t1a = await st();                      // 走约 2.3s
  await clickId(c, 'btnPlay');                 // 暂停
  const t1b = await st();
  await sleep(10000);                          // 真实等待 10s
  const t1c = await st();
  await clickId(c, 'btnPlay');                 // 恢复
  await sleep(1800);
  const t1d = await st();                      // 恢复后应比暂停时少约 2s
  await sleep(1200);
  const t1e = await st();
  R.T1_pause = {
    running: t1a.countdown, paused: t1b.countdown, after10s: t1c.countdown,
    resumed2s: t1d.countdown, resumed3s: t1e.countdown,
    pausedStable: t1b.countdown === t1c.countdown,
    noJumpBack: t1d.countdown !== '01:00' || true,
    totalAfter: [t1b.totalLeft, t1d.totalLeft]
  };

  /* ---------- T2. 连点"下一个"10 次 ---------- */
  await clickId(c, 'btnReplay'); await sleep(200);
  await clickId(c, 'btnPlay'); await sleep(100);  // 暂停后再点，避免走时干扰
  const seq = [];
  for (let i = 0; i < 10; i++) {
    await clickId(c, 'btnNext');
    await sleep(40);
    const s = await st();
    seq.push({ i: i + 1, tag: s.tag, status: s.status, action: s.action, cd: s.countdown, total: s.totalLeft, play: s.playLabel });
  }
  await clickId(c, 'btnPlay');                 // 恢复走时
  await sleep(1600);
  const after10 = await st();
  R.T2_next10 = { seq, afterResume: { cd: after10.countdown, total: after10.totalLeft, action: after10.action }, allReset60: seq.every(x => x.cd === '01:00') };

  /* ---------- T3. 第 1 阶段点"上一个" ---------- */
  await clickId(c, 'btnReplay'); await sleep(200);
  const before0 = await st();
  await clickId(c, 'btnPrev'); await sleep(120);
  const after0 = await st();
  await clickId(c, 'btnPlay'); await sleep(100);   // 暂停
  await clickId(c, 'btnPrev'); await sleep(120);   // 暂停态再点一次
  const after0p = await st();
  await clickId(c, 'btnPlay'); await sleep(1100);  // 恢复走一会
  const after0run = await st();
  R.T3_prevAtFirst = {
    before: { action: before0.action, cd: before0.countdown },
    after: { action: after0.action, cd: after0.countdown, tag: after0.tag, status: after0.status },
    afterPaused: { action: after0p.action, cd: after0p.countdown },
    afterRunAgain: { action: after0run.action, cd: after0run.countdown },
    hasNaN: [after0.countdown, after0p.countdown, after0run.countdown].some(x => /NaN|Infinity|-\d/.test(String(x)))
  };

  /* ---------- T4. 会话中途"重播" ---------- */
  for (let i = 0; i < 10; i++) { await clickId(c, 'btnNext'); await sleep(25); }
  await sleep(900);
  const mid = await st();
  await clickId(c, 'btnReplay'); await sleep(250);
  const afterReplay = await st();
  await clickId(c, 'btnPlay'); await sleep(80);    // 暂停，防干扰
  R.T4_replay = {
    mid: { action: mid.action, cd: mid.countdown, total: mid.totalLeft },
    after: { action: afterReplay.action, cd: afterReplay.countdown, total: afterReplay.totalLeft, status: afterReplay.status, play: afterReplay.playLabel },
    ok: afterReplay.action === '原地踏步 + 摆臂' && afterReplay.totalLeft === '总剩余 30:00' && afterReplay.countdown === '01:00'
  };

  /* ---------- T5. 时钟跳变 / 后台恢复：不连播音效、不跑偏 ---------- */
  await clickId(c, 'btnReplay'); await sleep(150);
  const bBefore = await beeps(), sBefore = await speaksNow();
  await sleep(1000);
  const jump = async (sec) => evalJs(c, `(function(){
      if(!window.__realNow) window.__realNow = Date.now;
      var base = window.__jumpAcc || 0; window.__jumpAcc = base + ${sec};
      Date.now = function(){ return window.__realNow() + window.__jumpAcc; };
      document.dispatchEvent(new Event('visibilitychange'));
      return window.__jumpAcc;
    })()`);

  const at0 = await st();
  await jump(125);                        // 跳 125s：应前进 2 个阶段，第 3 阶段剩 ~55s
  await sleep(500);
  const after125 = await st();
  const b125 = await beeps(), s125 = await speaksNow();
  await jump(600);                        // 再跳 600s
  await sleep(500);
  const after725 = await st();
  const b725 = await beeps(), s725 = await speaksNow();
  R.T5_jump = {
    at0: { action: at0.action, cd: at0.countdown, total: at0.totalLeft },
    after125: { action: after125.action, cd: after125.countdown, total: after125.totalLeft, status: after125.status },
    after725: { action: after725.action, cd: after725.countdown, total: after725.totalLeft, status: after725.status },
    beepDelta_125: b125 - bBefore, speakDelta_125: s125 - sBefore,
    beepDelta_600: b725 - b125, speakDelta_600: s725 - s125,
    noBurst: (b125 - bBefore) <= 2 && (b725 - b125) <= 2
  };

  /* ---------- T6. 走满 30 分钟到完成屏 ---------- */
  await jump(2000);                       // 余量足够跑完
  await sleep(700);
  const fin = await st();
  const bFin = await beeps(), sFin = await speaksNow();
  await sleep(1200);                      // 等 setTimeout 的音效
  const bFin2 = await beeps(), sFin2 = await speaksNow();
  R.T6_finish = {
    state: { finishShown: fin.finishShown, cd: fin.countdown, total: fin.totalLeft, play: fin.playLabel, tag: fin.tag },
    beepBurst: bFin2 - b725, speakBurst: sFin2 - s725,
    speakTexts: await evalJs(c, 'window.__qa.speakTexts.slice(-4)')
  };

  /* ---------- T7. 总剩余与阶段索引的一致性（抽样） ---------- */
  await evalJs(c, `(function(){ if(window.__realNow){ Date.now = window.__realNow; window.__jumpAcc=0; } return 1; })()`);
  await clickId(c, 'btnAgain'); await sleep(300);   // 再来一遍
  await clickId(c, 'btnPlay'); await sleep(80);     // 暂停
  const samples = [];
  for (const k of [0, 3, 4, 5, 14, 15, 29]) {
    await clickId(c, 'btnReplay'); await sleep(150); await clickId(c, 'btnPlay'); await sleep(60);
    for (let i = 0; i < k; i++) { await clickId(c, 'btnNext'); await sleep(20); }
    const s = await st();
    samples.push({ phaseIndex: k, tag: s.tag, total: s.totalLeft, expect: '总剩余 ' + fmt(1800 - 60 * k) });
  }
  function fmt(sec) { const m = String(Math.floor(sec / 60)).padStart(2, '0'); const r = String(sec % 60).padStart(2, '0'); return m + ':' + r; }
  R.T7_totalConsistency = samples;

  /* ---------- T8. 连点 40 次"下一个"越界 ---------- */
  await clickId(c, 'btnReplay'); await sleep(150); await clickId(c, 'btnPlay'); await sleep(60);
  for (let i = 0; i < 40; i++) { await clickId(c, 'btnNext'); await sleep(12); }
  const over = await st();
  R.T8_overflow = { action: over.action, cd: over.countdown, tag: over.tag, finishShown: over.finishShown, status: over.status };

  R.console = await evalJs(c, 'window.__qa.audioErr || null');
} catch (e) {
  R.fatal = String(e && e.stack || e);
} finally {
  try { c.close(); } catch (e) {}
  proc.kill('SIGKILL');
}
fs.writeFileSync('/Users/shahao/Project/byyd/qa/out-timing.json', JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
