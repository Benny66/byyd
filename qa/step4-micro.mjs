// Round 1 / step 4: 音效窗口、按钮文案、焦点上按空格是否双触发、全屏降级、控制台
import fs from 'node:fs';
import { launch, sleep, evalJs, clickId, readState } from './cdp.mjs';

const FILE = 'file:///Users/shahao/Project/byyd/deliverables/beiyun-30min.html';
const INIT = `window.__qa={beeps:0,speaks:0,beepTs:[],speakTexts:[]};
(function(){try{var AC=window.AudioContext||window.webkitAudioContext;
 if(AC&&AC.prototype){var o=AC.prototype.createOscillator;
  AC.prototype.createOscillator=function(){window.__qa.beeps++;window.__qa.beepTs.push(Math.round(performance.now()));return o.apply(this,arguments);};}}catch(e){window.__qa.audioErr=String(e);}
 try{if(window.speechSynthesis){var s=window.speechSynthesis.speak.bind(window.speechSynthesis);
  window.speechSynthesis.speak=function(u){window.__qa.speaks++;window.__qa.speakTexts.push(u&&u.text);try{return s(u);}catch(e){}};}}catch(e){}})();`;
const R = { console: [], exceptions: [] };
const { proc, client: c } = await launch({ port: 9348 });
const st = () => readState(c);
try {
  c.on(m => {
    if (m.method === 'Runtime.consoleAPICalled') R.console.push({ level: m.params.type, text: m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ') });
    if (m.method === 'Runtime.exceptionThrown') R.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level !== 'info') R.console.push({ level: 'log.' + m.params.entry.level, text: m.params.entry.text });
  });
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  await c.send('Page.navigate', { url: FILE });
  await sleep(1300);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false, screenWidth: 1366, screenHeight: 768 });

  const beeps = () => evalJs(c, 'window.__qa.beeps');

  /* A. 完成音效：紧贴 finish 前后取数 */
  await clickId(c, 'btnReplay'); await sleep(200);
  await evalJs(c, `(function(){ window.__realNow=Date.now; window.__jumpAcc=0;
    Date.now=function(){ return window.__realNow() + window.__jumpAcc; }; return 1; })()`);
  await evalJs(c, `window.__jumpAcc = 1799000, 1`);     // 距结束仅剩 ~10 秒
  await sleep(400);
  R.beforeFinish = (await st()).totalLeft;
  const bA = await beeps();
  await evalJs(c, `window.__jumpAcc = 1799000 + 12000, 1`);  // 跨过终点
  await sleep(300);
  const bB = await beeps();
  await sleep(900);
  const bC = await beeps();
  const fin = await st();
  R.finishChime = { totalBefore: R.beforeFinish, totalAfter: fin.totalLeft, finishShown: fin.finishShown, beepsAt0: bB - bA, beepsAfter900: bC - bB, speaks: await evalJs(c, 'window.__qa.speakTexts.slice(-1)') };
  await evalJs(c, `(function(){ Date.now=window.__realNow; window.__jumpAcc=0; return 1; })()`);

  /* B. 声音/语音按钮文案 + off 类 */
  await clickId(c, 'btnAgain'); await sleep(250);
  await clickId(c, 'btnPlay'); await sleep(80);
  await clickId(c, 'btnSound'); await sleep(100);
  const s1 = await st();
  const cls = await evalJs(c, `({soundCls:document.getElementById('btnSound').className, voiceCls:document.getElementById('btnVoice').className})`);
  await clickId(c, 'btnVoice'); await sleep(100);
  const s2 = await st();
  R.toggles = { afterSoundOff: s1.sound, afterVoiceOff: s2.voice, cls };

  /* C. 焦点在按钮上按空格：是否双触发（应为单次） */
  await clickId(c, 'btnNext'); await sleep(120);
  const focused = await evalJs(c, 'document.activeElement && document.activeElement.id');
  const beforeC = await st();
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await sleep(200);
  const afterC = await st();
  R.spaceOnFocusedButton = { focused, beforePlay: beforeC.playLabel, afterPlay: afterC.playLabel, actionUnchanged: beforeC.action === afterC.action, singleToggle: beforeC.playLabel !== afterC.playLabel };

  /* D. 全屏按钮：headless 下 requestFullscreen 可能被拒，检查是否静默降级、无异常 */
  await clickId(c, 'btnFull'); await sleep(500);
  R.fullscreen = {
    bodyClass: await evalJs(c, 'document.body.className'),
    fsElement: await evalJs(c, '!!document.fullscreenElement'),
    stillRunning: (await st()).playLabel,
    exceptionsSoFar: R.exceptions.length
  };
  await clickId(c, 'btnFull'); await sleep(400);

  /* E. 连续按 f 键 3 次不炸 */
  for (let i = 0; i < 3; i++) {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
    await sleep(250);
  }
  R.fKeySpam = { bodyClass: await evalJs(c, 'document.body.className'), play: (await st()).playLabel };

  /* F. 快速连点开始/暂停 20 次，检查状态与剩余时间是否可解释 */
  await clickId(c, 'btnReplay'); await sleep(200);
  for (let i = 0; i < 20; i++) { await clickId(c, 'btnPlay'); await sleep(35); }
  const spam = await st();
  R.playSpam = { play: spam.playLabel, cd: spam.countdown, total: spam.totalLeft };

  /* G. 页面常驻 3 秒，检查是否有异常/定时器报错 */
  await sleep(3000);
} catch (e) { R.fatal = String(e && e.stack || e); } finally { try { c.close(); } catch (e) {} proc.kill('SIGKILL'); }
fs.writeFileSync('/Users/shahao/Project/byyd/qa/out-micro.json', JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
