// Nuxt 静态站点冒烟校验：用 headless Chrome 打开 dist 产物，验证渲染、5 秒准备与计时器交互。
// 用法：node qa/nuxt-smoke.mjs [http://127.0.0.1:4173]
import fs from 'node:fs';
import { launch, evalJs, sleep, screenshot, saveJson } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const OUT_DIR = new URL('./shots/nuxt/', import.meta.url).pathname;
fs.mkdirSync(OUT_DIR, { recursive: true });

const READ = `(function(){
  var q = function(sel){ var e = document.querySelector(sel); return e ? e.textContent.trim() : null; };
  var buttons = Array.prototype.map.call(document.querySelectorAll('.controls .btn'), function(b){
    return { text: b.textContent.trim(), cls: b.className };
  });
  var fill = document.querySelector('.pb-fill');
  var frameEls = document.querySelectorAll('.figure .frames .frame');
  var figure = Array.prototype.map.call(
    document.querySelectorAll('.figure .frame path'),
    function (p) { return p.getAttribute('d'); }
  ).join('|');
  return {
    title: document.title,
    figure: figure || null,
    frames: frameEls.length,
    anim: frameEls.length ? getComputedStyle(frameEls[0]).animationName : null,
    phase: document.querySelector('.app') ? document.querySelector('.app').getAttribute('data-phase') : null,
    tag: q('.phase-tag'),
    countdown: q('.countdown'),
    totalLeft: q('.total-left'),
    status: q('.status-text'),
    action: q('.action-name'),
    tips: q('.line.tips'),
    breathe: q('.line.breathe'),
    next: q('.next-line'),
    playLabel: q('.controls .btn-main'),
    chip: q('.today-chip'),
    segments: document.querySelectorAll('.pb-track .pb-seg').length,
    fillSegments: document.querySelectorAll('.pb-fill .pb-seg').length,
    fillClip: fill ? (fill.style.clipPath || fill.style.webkitClipPath) : null,
    finished: !!document.querySelector('.finish.show'),
    buttons: buttons
  };
})()`;

const CLICK_BY_TEXT = (text) => `(function(){
  var target = Array.prototype.find.call(document.querySelectorAll('.controls .btn, .finish .btn'), function(b){
    return b.textContent.trim().indexOf(${JSON.stringify(text)}) >= 0;
  });
  if (!target) return 'NOT_FOUND';
  target.click();
  return 'ok';
})()`;

const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push({ name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}

const { proc, client } = await launch({ port: 9444 });
const consoleErrors = [];
const pageErrors = [];

try {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');

  // 统计音频合成与语音播报次数，验证音乐/鼓励语音真的在跑
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      window.__qa = { osc: 0, speak: 0 };
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        var origOsc = AC.prototype.createOscillator;
        AC.prototype.createOscillator = function(){
          window.__qa.osc++;
          return origOsc.apply(this, arguments);
        };
      }
      var ss = window.speechSynthesis;
      if (ss && typeof ss.speak === 'function') {
        var origSpeak = ss.speak.bind(ss);
        ss.speak = function(u){ window.__qa.speak++; return origSpeak(u); };
      }
    })();`
  });

  client.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
  });

  await client.send('Page.navigate', { url: BASE });
  await sleep(1600);

  const initial = await evalJs(client, READ);
  console.log('initial:', JSON.stringify(initial, null, 2));
  check('首屏进入 5 秒准备', initial.tag === '准备' && initial.countdown === '00:05', {
    tag: initial.tag,
    countdown: initial.countdown
  });
  check('首屏提示准备 1 / 12', (initial.status || '').includes('准备 1 / 12'), initial.status);
  check('首屏顶栏显示今日未练', (initial.chip || '').includes('今日未练'), initial.chip);
  check('首个动作是原地碎小步', initial.action === '原地碎小步', initial.action);
  check('进度条 30 段（24 动作 + 6 休息）', initial.segments === 30 && initial.fillSegments === 30, {
    track: initial.segments,
    fill: initial.fillSegments
  });
  check('总时长 32:00', initial.totalLeft === '总剩余 32:00', initial.totalLeft);
  check('页面标题含 32 分钟', (initial.title || '').includes('32 分钟'), initial.title);
  check('每个动作都有 SVG 示意图', !!initial.figure, initial.figure);
  check('示意图是多帧动画', initial.frames >= 2 && /fig-swap/.test(initial.anim || ''), {
    frames: initial.frames,
    anim: initial.anim
  });

  await screenshot(client, OUT_DIR + 'prepare-1920.png', { width: 1920, height: 1080 });

  // 开始：5 秒准备倒计时应在走
  check('点击开始', (await evalJs(client, CLICK_BY_TEXT('开始'))) === 'ok', null);
  await sleep(1600);
  const preparing = await evalJs(client, READ);
  check('准备倒计时在递减', preparing.countdown !== '00:05' && preparing.countdown !== '00:00', preparing.countdown);
  check('准备中按钮显示暂停', (preparing.playLabel || '').includes('暂停'), preparing.playLabel);

  // 准备结束后自动进入动作
  await sleep(4600);
  const exercising = await evalJs(client, READ);
  check('5 秒后自动进入动作', exercising.tag === '动作中', exercising.tag);
  check('动作倒计时从 1 分钟开始', /^0(0:5[0-9]|1:00)$/.test(exercising.countdown || ''), exercising.countdown);
  check('动作状态 1 / 12', (exercising.status || '').includes('动作 1 / 12'), exercising.status);
  check('总剩余在减少', exercising.totalLeft !== '总剩余 32:00', exercising.totalLeft);
  check('进度条开始推进', exercising.fillClip !== initial.fillClip, {
    before: initial.fillClip,
    after: exercising.fillClip
  });

  const audioStats = await evalJs(client, `({
    osc: window.__qa ? window.__qa.osc : -1,
    speak: window.__qa ? window.__qa.speak : -1,
    hasTts: typeof window.speechSynthesis !== 'undefined'
  })`);
  check('音乐合成在运行', audioStats.osc > 5, audioStats);
  if (audioStats.hasTts) {
    check('鼓励语音已播报', audioStats.speak >= 1, audioStats);
  }

  // 暂停后倒计时应停住
  await evalJs(client, CLICK_BY_TEXT('暂停'));
  await sleep(300);
  const pausedA = await evalJs(client, READ);
  await sleep(1300);
  const pausedB = await evalJs(client, READ);
  check('暂停后按钮显示继续', (pausedA.playLabel || '').includes('继续'), pausedA.playLabel);
  check('暂停后倒计时不动', pausedA.countdown === pausedB.countdown, {
    a: pausedA.countdown,
    b: pausedB.countdown
  });

  // 下一个动作：先进入它的 5 秒准备
  await evalJs(client, CLICK_BY_TEXT('下一个'));
  await sleep(300);
  const nextPrep = await evalJs(client, READ);
  check('切动作先进 5 秒准备', nextPrep.tag === '准备' && nextPrep.countdown === '00:05', {
    tag: nextPrep.tag,
    countdown: nextPrep.countdown
  });
  check('第 2 个动作是换脚跳', nextPrep.action === '换脚跳', nextPrep.action);
  check('准备状态 2 / 12', (nextPrep.status || '').includes('准备 2 / 12'), nextPrep.status);
  check('切换动作后示意图跟着换', nextPrep.figure !== initial.figure, {
    before: initial.figure,
    after: nextPrep.figure
  });

  // 音乐开关
  check('默认音乐开启', initial.buttons.some((b) => b.text === '音乐 开'), initial.buttons);
  await evalJs(client, CLICK_BY_TEXT('音乐'));
  await sleep(150);
  const musicOff = await evalJs(client, READ);
  check('音乐可关闭', (musicOff.buttons.find((b) => b.text.includes('音乐')) || {}).text === '音乐 关', musicOff.buttons);
  await evalJs(client, CLICK_BY_TEXT('音乐'));
  await sleep(150);
  const musicOn = await evalJs(client, READ);
  check('音乐可重新开启', (musicOn.buttons.find((b) => b.text.includes('音乐')) || {}).text === '音乐 开', musicOn.buttons);

  // 声音开关
  await evalJs(client, CLICK_BY_TEXT('声音'));
  await sleep(150);
  const soundOff = await evalJs(client, READ);
  check('声音关闭文案', (soundOff.buttons.find((b) => b.text.includes('声音')) || {}).text === '声音 关', soundOff.buttons);

  // 连点到第 5 个阶段（休息）：当前在索引 2，再点 6 次 → 索引 8
  for (let i = 0; i < 6; i++) {
    await evalJs(client, CLICK_BY_TEXT('下一个'));
    await sleep(80);
  }
  await sleep(350);
  const restPhase = await evalJs(client, READ);
  check('到达休息段（data-phase=rest）', restPhase.phase === 'rest', restPhase.phase);
  check('休息段标签', restPhase.tag === '休息', restPhase.tag);
  check('休息段不显示要点标签', !(restPhase.tips || '').startsWith('要点'), restPhase.tips);
  check('休息段换成放松示意图', restPhase.figure !== exercising.figure, {
    action: exercising.figure,
    rest: restPhase.figure
  });

  await screenshot(client, OUT_DIR + 'rest-1920.png', { width: 1920, height: 1080 });

  // 手机竖屏
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844
  });
  await client.send('Page.reload', { ignoreCache: false });
  await sleep(1800);
  const mobile = await evalJs(client, READ);
  check('移动端渲染准备态', mobile.tag === '准备', mobile.tag);
  const overflow = await evalJs(client, `(function(){
    var d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth, scrollH: d.scrollHeight, clientH: d.clientHeight };
  })()`);
  check('移动端无滚动溢出', overflow.scrollW <= overflow.clientW + 1 && overflow.scrollH <= overflow.clientH + 1, overflow);
  await screenshot(client, OUT_DIR + 'mobile-390.png', { width: 390, height: 844, mobile: true, dsf: 2 });

  check('无未捕获异常', pageErrors.length === 0, pageErrors);
  check('无 console 错误', consoleErrors.length === 0, consoleErrors);

  const report = { base: BASE, initial, preparing, exercising, paused: pausedB, nextPrep, restPhase, mobile, overflow, pageErrors, consoleErrors, failures };
  saveJson(new URL('./out-nuxt-smoke.json', import.meta.url).pathname, report);
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILURE(S)'}`);
} finally {
  client.close();
  proc.kill('SIGKILL');
}

process.exit(failures.length === 0 ? 0 : 1);
