// Round 1 / step 1: structure assertions + console capture, run inside real page
import fs from 'node:fs';
import { launch, CDP, sleep, evalJs, clickId, readState } from './cdp.mjs';

const FILE = 'file:///Users/shahao/Project/byyd/deliverables/beiyun-30min.html';
const SRC = '/Users/shahao/Project/byyd/deliverables/beiyun-30min.html';

const EXPECTED_NAMES = [
  '原地踏步 + 摆臂', '肩绕环 + 髋绕环', '自重深蹲', '跪姿俯卧撑', '臀桥', '平板支撑',
  '原地弓步蹲', '鸟狗式', '侧点步 + 开合手', '死虫式', '靠墙静蹲', '站姿提膝触肘',
  '相扑深蹲', '单腿臀桥', '站姿凯格尔', '慢速高抬腿', '后撤步弓步', '自重髋铰链',
  '侧向弓步', '侧平板支撑', '提踵 + 单腿平衡', '蚌式开合', '婴儿式 + 髋屈肌拉伸', '仰卧腹式呼吸',
];

const INIT_PATCH = `window.__qa = { beeps: 0, speaks: 0, beepTs: [], speakTexts: [] };
(function(){
  try{
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC && AC.prototype) {
      var orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function(){
        window.__qa.beeps++;
        window.__qa.beepTs.push(Math.round(performance.now()));
        return orig.apply(this, arguments);
      };
    } else { window.__qa.audioErr = 'no AudioContext'; }
  }catch(e){ window.__qa.audioErr = String(e); }
  try{
    if (window.speechSynthesis) {
      var os = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = function(u){
        window.__qa.speaks++;
        window.__qa.speakTexts.push(u && u.text);
        try { return os(u); } catch(e){ }
      };
    }
  }catch(e){ window.__qa.speakErr = String(e); }
})();`;

const out = { console: [], exceptions: [], structure: {}, empirical: {}, env: {} };

const { proc, client: c } = await launch({ port: 9341 });
try {
  c.on(m => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const lvl = m.params.type;
      const txt = m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ');
      out.console.push({ level: lvl, text: txt });
    } else if (m.method === 'Runtime.exceptionThrown') {
      out.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    } else if (m.method === 'Log.entryAdded') {
      out.console.push({ level: 'log.' + m.params.entry.level, text: m.params.entry.text, url: m.params.entry.url });
    }
  });

  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT_PATCH });
  await c.send('Page.navigate', { url: FILE });
  await sleep(1600);

  out.env = await evalJs(c, `(function(){
    return {
      ua: navigator.userAgent,
      innerW: innerWidth, innerH: innerHeight,
      hasWakeLock: !!(navigator.wakeLock && navigator.wakeLock.request),
      hasFS: !!document.documentElement.requestFullscreen,
      hasAudio: !!(window.AudioContext || window.webkitAudioContext),
      hasSpeech: !!window.speechSynthesis,
      hasRAF: !!window.requestAnimationFrame,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight
    };
  })()`);

  /* ---------- 1A. 结构断言：直接跑交付文件里的真实代码 ---------- */
  const html = fs.readFileSync(SRC, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  let script = m[1];
  const patched = script.replace(
    /\n\s*init\(\);\s*\n\}\)\(\);/,
    `\n  window.__QA = { PHASES: PHASES, TOTAL: TOTAL_SECONDS, CUM: CUM_START, EX: EXERCISES };\n})();`
  );
  if (patched === script) throw new Error('could not patch script (init anchor not found)');
  await evalJs(c, patched + '\n"ok"');

  out.structure = await evalJs(c, `(function(){
    var Q = window.__QA, P = Q.PHASES;
    var restIdx = [], exIdx = [], exNames = [];
    for (var i=0;i<P.length;i++){ if(P[i].type==='rest'){ restIdx.push(i); } else { exIdx.push(i); exNames.push(P[i].exercise.name); } }
    // rest position measured in "number of exercises completed before it"
    var restAfter = restIdx.map(function(i){ var n=0; for(var j=0;j<i;j++){ if(P[j].type==='exercise') n++; } return n; });
    // group boundaries: cumulative seconds at end of each rest with endsGroup
    var groupEnds = [];
    var acc = 0;
    for (var k=0;k<P.length;k++){ acc += P[k].duration; if(P[k].type==='rest' && P[k].endsGroup) groupEnds.push({ restAt:k, cumSec: acc }); }
    var durations = P.map(function(p){ return p.duration; });
    var badDur = durations.filter(function(d){ return d!==60; }).length;
    var groups = P.map(function(p){ return p.group; });
    return {
      phaseCount: P.length,
      exerciseCount: exIdx.length,
      restCount: restIdx.length,
      totalSeconds: Q.TOTAL,
      allDurations60: badDur === 0,
      restAfterExerciseNo: restAfter,
      groupEndCumSec: groupEnds,
      exNames: exNames,
      groupsPerPhase: groups,
      cum: Q.CUM,
      firstHalfPhases: P.filter(function(p){return p.group===1;}).length,
      secondHalfPhases: P.filter(function(p){return p.group===2;}).length
    };
  })()`);

  /* ---------- 1B. 空跑：实际点 29 次"下一个"，记录真实 DOM ---------- */
  await evalJs(c, `document.getElementById('finish').className='finish'; document.getElementById('btnReplay').click(); 'ok'`);
  await sleep(300);
  await clickId(c, 'btnPlay'); // 暂停
  await sleep(200);
  const walk = [];
  walk.push(await readState(c));
  for (let i = 0; i < 29; i++) {
    await clickId(c, 'btnNext');
    await sleep(45);
    walk.push(await readState(c));
  }
  out.empirical.walk = walk.map(s => ({ tag: s.tag, action: s.action, status: s.status, countdown: s.countdown }));

  /* ---------- 键盘测试 ---------- */
  const key = async (k, code, vk) => {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(150);
  };
  await clickId(c, 'btnReplay');
  await sleep(250);
  const kbd = {};
  kbd.afterReplay = await readState(c);
  await key(' ', 'Space', 32);          // 暂停
  kbd.afterSpace = await readState(c);
  await key('ArrowRight', 'ArrowRight', 39);
  kbd.afterArrowRight = await readState(c);
  await key('ArrowLeft', 'ArrowLeft', 37);
  kbd.afterArrowLeft = await readState(c);
  await key('m', 'KeyM', 77);
  kbd.afterM = await readState(c);
  await key('m', 'KeyM', 77);
  await key('Enter', 'Enter', 13);      // 恢复
  kbd.afterEnter = await readState(c);
  await key('r', 'KeyR', 82);           // 重播
  kbd.afterR = await readState(c);
  out.empirical.keyboard = kbd;

  await sleep(700);
  out.env.consoleFromPage = out.console;
  out.procOk = true;
} catch (e) {
  out.fatal = String(e && e.stack || e);
} finally {
  try { c.close(); } catch (e) {}
  proc.kill('SIGKILL');
}

fs.writeFileSync('/Users/shahao/Project/byyd/qa/out-structure.json', JSON.stringify(out, null, 2));
const S = out.structure, E = out.empirical;
console.log('--- FATAL:', out.fatal || 'none');
console.log('--- ENV:', JSON.stringify(out.env));
console.log('--- STRUCT:', JSON.stringify({
  phaseCount: S.phaseCount, exerciseCount: S.exerciseCount, restCount: S.restCount,
  totalSeconds: S.totalSeconds, allDurations60: S.allDurations60,
  restAfterExerciseNo: S.restAfterExerciseNo, groupEndCumSec: S.groupEndCumSec,
  firstHalfPhases: S.firstHalfPhases, secondHalfPhases: S.secondHalfPhases,
}));
const nameDiff = [];
S.exNames.forEach((n, i) => { if (n !== EXPECTED_NAMES[i]) nameDiff.push({ i: i + 1, got: n, want: EXPECTED_NAMES[i] }); });
console.log('--- NAME DIFF:', JSON.stringify(nameDiff));
console.log('--- WALK:', JSON.stringify((E.walk || []).map(w => `${w.tag}|${w.status}|${w.action}|${w.countdown}`)));
console.log('--- KEYBOARD:', JSON.stringify(Object.fromEntries(Object.entries(E.keyboard || {}).map(([k, v]) => [k, { tag: v.tag, n: v.action, cd: v.countdown, play: v.playLabel, sound: v.sound, total: v.totalLeft }]))));
console.log('--- CONSOLE:', JSON.stringify(out.console));
console.log('--- EXCEPTIONS:', JSON.stringify(out.exceptions));
