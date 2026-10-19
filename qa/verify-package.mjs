// 校验打好的 zip：解压到临时目录后起静态服务打开，确认产物是真的能跑（而不是只看构建日志）。
// 用法：node qa/verify-package.mjs <解压目录> [port]
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { launch, evalJs, sleep, screenshot, saveJson } from './cdp.mjs';

const DIR = process.argv[2] || '/tmp/beiyun-verify';
const PORT = Number(process.argv[3] || 4179);
const OUT = new URL('./shots/nuxt/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let ok = true;
const failures = [];
function check(label, cond, detail) {
  if (!cond) {
    ok = false;
    failures.push(label);
  }
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
}

if (!fs.existsSync(`${DIR}/index.html`)) {
  console.error('目录里没有 index.html：', DIR);
  process.exit(1);
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', DIR], { stdio: 'ignore' });
await sleep(900);

const { proc, client } = await launch({ port: 9448 });
const errors = [];

try {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  client.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push('exception');
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  });

  await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1800);

  const state = await evalJs(client, `(function(){
    var q = function(s){ var e = document.querySelector(s); return e ? e.textContent.trim() : null; };
    return {
      title: document.title,
      action: q('.action-name'),
      status: q('.status-text'),
      countdown: q('.countdown'),
      frames: document.querySelectorAll('.figure .frames .frame').length,
      buttons: Array.prototype.map.call(document.querySelectorAll('.controls .btn'), function(b){ return b.textContent.trim(); }),
      segs: document.querySelectorAll('.pb-track .pb-seg').length,
      css: Array.prototype.map.call(document.querySelectorAll('link[rel=stylesheet]'), function(l){ return l.sheet ? 'ok' : 'missing'; })
    };
  })()`);

  check('首页可访问且标题正确', (state.title || '').includes('备孕每日训练'), state.title);
  check('样式表已加载', state.css.every((v) => v === 'ok'), state.css);
  check('首屏是 5 秒准备', state.countdown === '00:05' && (state.status || '').includes('准备'), {
    countdown: state.countdown,
    status: state.status
  });
  check('示意图多帧已渲染', state.frames >= 2, state.frames);
  check('进度条 30 段', state.segs === 30, state.segs);
  check('控制栏按钮齐全', state.buttons.length >= 6, state.buttons);

  // 交互：首屏是「准备」阶段，点一次只进到同一动作的「动作」阶段，
  // 点两次才会换到下一个动作——用来确认 Vue 已水合接管（不是静态死页面）。
  const before = state.action;
  const statusBefore = state.status;
  for (let i = 0; i < 2; i++) {
    await evalJs(client, `(function(){
      var b = Array.prototype.find.call(document.querySelectorAll('.controls .btn'), function(x){ return x.textContent.indexOf('下一个') >= 0; });
      if (b) b.click();
    })()`);
    await sleep(350);
  }
  const after = await evalJs(client, `document.querySelector('.action-name').textContent.trim()`);
  const statusAfter = await evalJs(client, `document.querySelector('.status-text').textContent.trim()`);
  check('点“下一个”能切动作（Vue 已水合）', after && after !== before, { before, after });
  check('状态文案跟着推进', statusAfter !== statusBefore, { statusBefore, statusAfter });

  check('无 JS 异常与 console 错误', errors.length === 0, errors.slice(0, 3));

  await screenshot(client, `${OUT}package-check.png`, { width: 1440, height: 900 });

  saveJson(new URL('./out-package.json', import.meta.url).pathname, { dir: DIR, state, after, errors, failures });
} finally {
  client.close();
  proc.kill('SIGKILL');
  server.kill('SIGKILL');
}

console.log(ok ? '\nALL PASS' : `\nFAILED: ${failures.join(' / ')}`);
process.exit(ok ? 0 : 1);
