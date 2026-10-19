// 逐个动作、逐帧抓示意图，生成核对用宫格图（每个动作几帧就抓几张）。
// 抓图前会注入样式冻结 CSS 逐帧动画，逐帧显示，保证每次截图内容一致。
// 用法：node qa/figures.mjs [http://127.0.0.1:4173]
import fs from 'node:fs';
import { launch, evalJs, sleep, saveJson } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const OUT_DIR = new URL('./shots/nuxt/', import.meta.url).pathname;
fs.mkdirSync(OUT_DIR, { recursive: true });

const NAMES = [
  '原地碎小步', '换脚跳', '高抬腿', '后踢腿', '劈砍踢膝', '胯下击掌',
  '半蹲弹震', '半蹲交替撤步', '深蹲回环', '深蹲', '空手跳绳', '开合跳'
];

const { proc, client } = await launch({ port: 9445 });
const shots = [];

/** 冻结动画并只显示第 i 帧（1 基） */
async function showFrame(i) {
  await evalJs(client, `(function(){
    var id = 'qa-freeze';
    var s = document.getElementById(id);
    if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
    s.textContent = '.figure .frame{animation:none!important;-webkit-animation:none!important;opacity:0!important}'
      + '.figure .frame:nth-of-type(${i}){opacity:1!important}';
  })()`);
  await sleep(60);
}

async function clipFigure() {
  const box = await evalJs(client, `(function(){
    var f = document.querySelector('.figure').getBoundingClientRect();
    return { x: f.x, y: f.y, w: f.width, h: f.height };
  })()`);
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: {
      x: Math.max(0, box.x - 14),
      y: Math.max(0, box.y - 14),
      width: box.w + 28,
      height: box.h + 28,
      scale: 2
    }
  });
  return Buffer.from(shot.data, 'base64');
}

async function frameCount() {
  return evalJs(client, `document.querySelectorAll('.figure .frames .frame').length`);
}

/** 时间轴里每 4 个动作插一段休息，不能按固定步数推进：一直点“下一个”直到动作名命中 */
async function seekTo(name) {
  for (let n = 0; n < 30; n++) {
    const cur = await evalJs(client, `(function(){
      var el = document.querySelector('.action-name');
      return el ? el.textContent.trim() : '';
    })()`);
    if (cur === name) return cur;
    await evalJs(client, `(function(){
      var b = Array.prototype.find.call(document.querySelectorAll('.controls .btn'), function(x){ return x.textContent.indexOf('下一个') >= 0; });
      if (b) b.click();
    })()`);
    await sleep(90);
  }
  throw new Error(`未能切换到动作：${name}`);
}

try {
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: BASE });
  await sleep(1600);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1600, screenHeight: 900
  });
  await sleep(500);

  for (let i = 0; i < NAMES.length; i++) {
    const name = await seekTo(NAMES[i]);
    const n = await frameCount();
    const files = [];
    for (let k = 1; k <= n; k++) {
      await showFrame(k);
      const file = `${OUT_DIR}fig-${String(i + 1).padStart(2, '0')}-${k}.png`;
      fs.writeFileSync(file, await clipFigure());
      files.push(file);
    }
    shots.push({ name, frames: n, files });
    console.log(`${i + 1}. ${name}：${n} 帧`);
  }

  try {
    const restName = await seekTo('休息');
    const n = await frameCount();
    const files = [];
    for (let k = 1; k <= n; k++) {
      await showFrame(k);
      const file = `${OUT_DIR}fig-13-${k}.png`;
      fs.writeFileSync(file, await clipFigure());
      files.push(file);
    }
    shots.push({ name: restName, frames: n, files });
  } catch (err) {
    console.warn('休息图跳过：', err.message);
  }

  const cells = shots
    .map((s) =>
      s.files
        .map(
          (f, k) => `<figure><img src="file://${f}"><figcaption>${s.name}${s.files.length > 1 ? ` · 第 ${k + 1} 帧` : ''}</figcaption></figure>`
        )
        .join('')
    )
    .join('');
  const html = `<!DOCTYPE html><meta charset="utf-8"><style>
    body{margin:0;background:#0b0d12;color:#e9edf7;font-family:-apple-system,"PingFang SC",sans-serif}
    .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:16px}
    figure{margin:0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:6px;text-align:center}
    img{width:100%;height:130px;object-fit:contain;display:block}
    figcaption{font-size:12px;margin-top:4px;color:#ffd166}
  </style><div class="grid">${cells}</div>`;
  const htmlPath = '/tmp/figures-grid.html';
  fs.writeFileSync(htmlPath, html);

  await client.send('Page.navigate', { url: `file://${htmlPath}` });
  await sleep(900);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1320, height: 900, deviceScaleFactor: 2, mobile: false, screenWidth: 1320, screenHeight: 900
  });
  await sleep(400);
  const grid = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
  fs.writeFileSync(`${OUT_DIR}figures-grid.png`, Buffer.from(grid.data, 'base64'));
  console.log('grid ->', `${OUT_DIR}figures-grid.png`);

  saveJson(new URL('./out-figures.json', import.meta.url).pathname, { base: BASE, shots });
} finally {
  client.close();
  proc.kill('SIGKILL');
}
