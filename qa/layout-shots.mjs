// 抓桌面 / 竖屏 / 电视三种视口的实际排版图，确认示意图与倒计时环的比例。
// 用法：node qa/layout-shots.mjs [http://127.0.0.1:4173]
import fs from 'node:fs';
import { launch, evalJs, sleep, screenshot } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const OUT = new URL('./shots/nuxt/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: 'desktop', width: 1600, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'tv', width: 1920, height: 1080, mobile: false }
];

const { proc, client } = await launch({ port: 9446 });

try {
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: BASE });
  await sleep(1500);

  for (const v of VIEWS) {
    await screenshot(client, `${OUT}layout-${v.name}.png`, { ...v, dsf: 1 });
    const box = await evalJs(client, `(function(){
      var f = document.querySelector('.figure').getBoundingClientRect();
      var r = document.querySelector('.ring-wrap').getBoundingClientRect();
      return { figure: [Math.round(f.width), Math.round(f.height)], ring: Math.round(r.width), top: Math.round(f.top), ringTop: Math.round(r.top) };
    })()`);
    console.log(v.name, JSON.stringify(box));
  }

  // 隔半帧再抓一张桌面图，肉眼确认逐帧动画确实在切换
  await screenshot(client, `${OUT}layout-desktop.png`, { ...VIEWS[0], dsf: 1 });
  await sleep(600);
  await screenshot(client, `${OUT}layout-desktop-2.png`, { ...VIEWS[0], dsf: 1 });
} finally {
  client.close();
  proc.kill('SIGKILL');
}
