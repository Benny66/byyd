// Round 1 / step 3b: 时钟跳变 + 走满 30 分钟 + 走时中跳段（修正单位为毫秒）
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
const { proc, client: c } = await launch({ port: 9346 });
const st = () => readState(c);
const beeps = () => evalJs(c, 'window.__qa.beeps');
const speaksNow = () => evalJs(c, 'window.__qa.speaks');
const snap = async (label) => { const s = await st(); return { label, tag: s.tag, status: s.status, action: s.action, cd: s.countdown, total: s.totalLeft, play: s.playLabel, finish: s.finishShown }; };

try {
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT_PATCH });
  await c.send('Page.navigate', { url: FILE });
  await sleep(1300);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false, screenWidth: 1366, screenHeight: 768 });
  await sleep(300);

  const jumpMs = async (ms) => evalJs(c, `(function(){
      if(!window.__realNow){ window.__realNow = Date.now; window.__jumpAcc = 0; }
      window.__jumpAcc += ${ms};
      Date.now = function(){ return window.__realNow() + window.__jumpAcc; };
      return window.__jumpAcc;
    })()`);

  /* T5：走时中时钟向前跳 125s（模拟切后台/熄屏回来） */
  await clickId(c, 'btnReplay'); await sleep(250);
  const b0 = await beeps(), s0 = await speaksNow();
  const t5a = await snap('start');
  await jumpMs(125000);
  await sleep(600);
  const t5b = await snap('+125s');
  const b1 = await beeps(), s1 = await speaksNow();
  R.T5_jump125 = { start: t5a, after: t5b, beepDelta: b1 - b0, speakDelta: s1 - s0, noSoundBurst: (b1 - b0) <= 2 && (s1 - s0) === 0 };

  /* 再跳 600s */
  await jumpMs(600000);
  await sleep(600);
  const t5c = await snap('+725s total');
  const b2 = await beeps(), s2 = await speaksNow();
  R.T5b_jump725 = { after: t5c, beepDelta: b2 - b1, speakDelta: s2 - s1, noSoundBurst: (b2 - b1) <= 2 && (s2 - s1) === 0 };

  /* T6：跳满剩余，验证 30:00 结束 */
  await jumpMs(2000000);
  await sleep(900);
  const t6 = await snap('finish');
  const b3 = await beeps(), s3 = await speaksNow();
  await sleep(1300);   // 等 finish 里的 setTimeout 音效/语音
  const b4 = await beeps(), s4 = await speaksNow();
  R.T6_finish = {
    state: t6, finishBeeps: b4 - b3, finishSpeaks: s4 - s3,
    speakTail: await evalJs(c, 'window.__qa.speakTexts.slice(-2)'),
    finishSoundOk: (b4 - b3) === 2
  };

  /* 还原时钟 */
  await evalJs(c, `(function(){ if(window.__realNow){ Date.now = window.__realNow; window.__jumpAcc = 0; } return 1; })()`);

  /* T6b：完成屏点"再来一遍" */
  await clickId(c, 'btnAgain'); await sleep(400);
  R.T6b_again = await snap('after 再来一遍');

  /* T9：走时中连点"下一个"（遥控器真实场景） */
  await clickId(c, 'btnReplay'); await sleep(200);
  await sleep(1200);                 // 先走 1 秒多
  const t9 = [];
  for (let i = 0; i < 5; i++) { await clickId(c, 'btnNext'); await sleep(120); t9.push(await snap('next#' + (i + 1))); }
  await sleep(1500);
  const t9tail = await snap('after 1.5s run');
  R.T9_nextWhileRunning = { steps: t9.map(x => `${x.status}|${x.cd}|${x.total}`), afterRun: `${t9tail.status}|${t9tail.cd}|${t9tail.total}`, eachReset60: t9.every(x => x.cd === '01:00') };

  /* T10：走时中"上一个" */
  const t10a = await snap('before prev');
  await clickId(c, 'btnPrev'); await sleep(150);
  const t10b = await snap('after prev');
  await sleep(1200);
  const t10c = await snap('prev + 1.2s');
  R.T10_prevWhileRunning = { before: t10a.status, after: t10b.status, cd: t10b.cd, runningAfter: t10c.cd, consistent: t10b.cd === '01:00' };

  /* T11：暂停很久 → 跳段 → 继续，剩余是否仍从 60 秒开始且不倒退 */
  await clickId(c, 'btnPlay'); await sleep(120);       // 暂停
  const p1 = await snap('paused');
  await sleep(3000);
  await clickId(c, 'btnNext'); await sleep(120);
  const p2 = await snap('paused+next');
  await clickId(c, 'btnPlay'); await sleep(1500);       // 继续
  const p3 = await snap('resumed 1.5s');
  R.T11_pauseThenSkip = { paused: p1.cd, afterNext: p2.cd, resumed: p3.cd, ok: p2.cd === '01:00' && (p3.cd === '00:59' || p3.cd === '00:58') };

  /* T12：声音/语音开关持久化 + 不抛错 */
  await clickId(c, 'btnSound'); await sleep(120);
  const sMute = await snap('muted');
  R.T12_toggle = { soundLabel: sMute.sound, ls: await evalJs(c, `(function(){try{return localStorage.getItem('beiyun30.v1');}catch(e){return 'ERR:'+e.name;}})()`) };
  await clickId(c, 'btnSound'); await sleep(100);

  /* T13：wakeLock 调用情况 */
  R.T13_wakelock = await evalJs(c, `(function(){ return { supported: !!(navigator.wakeLock && navigator.wakeLock.request), hidden: document.hidden }; })()`);
} catch (e) {
  R.fatal = String(e && e.stack || e);
} finally {
  try { c.close(); } catch (e) {}
  proc.kill('SIGKILL');
}
fs.writeFileSync('/Users/shahao/Project/byyd/qa/out-jump.json', JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
