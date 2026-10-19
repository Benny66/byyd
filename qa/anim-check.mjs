// 校验示意图逐帧动画真的在跑：多次采样每帧 opacity，要求任意时刻只有一帧可见且可见帧会切换。
// 用法：node qa/anim-check.mjs [http://127.0.0.1:4173]
import { launch, evalJs, sleep, saveJson } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';

const SAMPLE = `(function(){
  var frames = Array.prototype.map.call(document.querySelectorAll('.figure .frames .frame'), function(g){
    return parseFloat(getComputedStyle(g).opacity);
  });
  var visible = [];
  frames.forEach(function(o, i){ if (o > 0.5) visible.push(i + 1); });
  return { n: frames.length, opacity: frames, visible: visible };
})()`;

const { proc, client } = await launch({ port: 9447 });
const samples = [];
let ok = true;
let failures = [];

function check(label, cond, detail) {
  if (!cond) {
    ok = false;
    failures.push(label);
  }
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
}

try {
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: BASE });
  await sleep(1500);

  const first = await evalJs(client, SAMPLE);
  check('示意图有多帧', first.n >= 2, first.n);

  // 采样 6 次，覆盖至少一个完整周期（2 帧 1.1s / 3 帧 1.5s）
  for (let i = 0; i < 6; i++) {
    const s = await evalJs(client, SAMPLE);
    samples.push(s);
    check(`第 ${i + 1} 次采样恰好一帧可见`, s.visible.length === 1, { visible: s.visible });
    await sleep(300);
  }

  const seen = new Set(samples.map((s) => (s.visible[0] || 0).toString()));
  check('可见帧发生切换（动画在跑）', seen.size >= 2, { frames: [...seen] });

  // 三帧动作单独验一遍：3 帧的延迟错峰与两帧不同，容易写错
  for (let i = 0; i < 40; i++) {
    const cur = await evalJs(client, `(function(){
      var el = document.querySelector('.action-name');
      return el ? el.textContent.trim() : '';
    })()`);
    if (cur === '深蹲回环') break;
    await evalJs(client, `(function(){
      var b = Array.prototype.find.call(document.querySelectorAll('.controls .btn'), function(x){ return x.textContent.indexOf('下一个') >= 0; });
      if (b) b.click();
    })()`);
    await sleep(70);
  }
  const tri = await evalJs(client, SAMPLE);
  check('深蹲回环是三帧', tri.n === 3, tri.n);
  const triSeen = new Set();
  for (let i = 0; i < 8; i++) {
    const s = await evalJs(client, SAMPLE);
    if (s.visible.length === 1) triSeen.add(s.visible[0]);
    await sleep(250);
  }
  check('三帧动作三帧都出现过', triSeen.size === 3, { frames: [...triSeen].sort() });

  saveJson(new URL('./out-anim.json', import.meta.url).pathname, { base: BASE, samples, tri: [...triSeen], failures });
} finally {
  client.close();
  proc.kill('SIGKILL');
}

console.log(ok ? '\nALL PASS' : `\nFAILED: ${failures.join(' / ')}`);
process.exit(ok ? 0 : 1);
