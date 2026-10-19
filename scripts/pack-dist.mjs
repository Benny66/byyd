#!/usr/bin/env node
/**
 * 把 dist/ 打成可分发的 zip 包（含一份部署说明）。
 *
 * 用法：npm run pack      （会先构建再打包）
 *      node scripts/pack-dist.mjs   （只打包已存在的 dist/）
 *
 * 包内没有顶层目录，解压后 index.html 就在根上，直接丢到静态托管即可。
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const releaseDir = join(root, 'release')
const stage = join(releaseDir, '.stage')

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[pack] 未找到 dist/index.html，请先执行 npm run build:dist')
  process.exit(1)
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const zipName = `beiyun-30min-static-${stamp}.zip`
const zipPath = join(releaseDir, zipName)

await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
await cp(dist, stage, { recursive: true })

const readme = `备孕每日训练 · 32 分钟（静态站点）
========================================

这是一个纯静态站点，无需 Node、无需数据库，任何能托管静态文件的地方都能跑。

【重要】不能直接双击 index.html 打开
  页面用的是 ES Module（<script type="module">），浏览器的 file:// 协议
  会以 CORS 规则拦截模块脚本，双击只会看到白屏。必须通过 http(s) 访问。

本地预览（任选其一，在解压后的目录里执行）
  python3 -m http.server 4173
  npx serve .
  php -S 127.0.0.1:4173

  然后浏览器打开 http://127.0.0.1:4173/

部署到服务器
  把本目录下所有文件上传到站点根目录即可（index.html 在根上）。
  已经附带：
    404.html      单页兜底页（未知路径回落到同一份页面）
    .nojekyll     避免 GitHub Pages 的 Jekyll 忽略 _nuxt 目录
    _payload.json 预渲染数据

  Nginx 最小配置：
    location / {
      root /var/www/beiyun;
      try_files $uri $uri/ /index.html;
    }

  GitHub Pages：推到仓库后，Pages 源选该分支根目录即可（.nojekyll 已带）。

部署到子目录（例如 https://example.com/beiyun/）
  当前资源引用是绝对路径 /_nuxt/...，只能部署在域名根目录。
  要放到子目录，请回到源码重新构建并把 app.baseURL 设成 '/beiyun/'：
    1. nuxt.config.ts 里加 app: { baseURL: '/beiyun/' }
    2. npm run build:dist && npm run pack

文件清单
  index.html     页面骨架与首屏预渲染内容
  200.html /
  404.html       单页兜底
  _payload.json  预渲染数据
  _nuxt/         打包后的 JS / CSS（含哈希文件名，可长期缓存）
  favicon.svg    站点图标

内容说明
  12 个动作 × 2 轮，每 4 个动作休息 1 分钟，总共 32 分钟。
  每个动作前有 5 秒语音倒数准备；训练中有合成背景音乐与鼓励式语音提示。
  所有声音都靠 Web Audio 与 SpeechSynthesis 实时生成，不依赖任何音频文件。

快捷键
  空格 / 回车  开始、暂停
  ← / →        上一个、下一个动作
  R            重播
  F            全屏（电视端会降级为伪全屏）
  M            静音

浏览器要求
  Chrome / Edge / Safari 16+ / Firefox 最新版。
  Wake Lock（训练时不息屏）在部分浏览器不可用，会自动降级，不影响计时。
`

await writeFile(join(stage, 'README.txt'), readme, 'utf8')

if (existsSync(zipPath)) await rm(zipPath, { force: true })
// -X 去掉扩展属性，避免解压到 Linux 时出现多余元数据
await run('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: stage })

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

const files = await walk(dist)
let bytes = 0
for (const file of files) bytes += (await stat(file)).size
const zipBytes = (await stat(zipPath)).size

// 临时组装目录不留在 release/ 里，避免和压缩包混在一起
await rm(stage, { recursive: true, force: true })

const html = await readFile(join(dist, 'index.html'), 'utf8')
if (!/\/_nuxt\//.test(html)) {
  console.error('[pack] 警告：index.html 里没有找到 /_nuxt/ 资源引用，产物可能不完整')
}

console.log(`[pack] 压缩包：${relative(root, zipPath)}`)
console.log(`[pack] 源目录 ${files.length} 个文件 / ${(bytes / 1024).toFixed(1)} KB → 压缩后 ${(zipBytes / 1024).toFixed(1)} KB`)
console.log('[pack] 解压后直接上传到静态托管根目录；本地预览用 npx serve . 或 python3 -m http.server')
