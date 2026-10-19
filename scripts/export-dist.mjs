#!/usr/bin/env node
/**
 * 把 `nuxt generate` 的产物 (.output/public) 导出成可上传的 dist/ 目录。
 *
 * 额外处理：
 * - 复制 index.html → 404.html，静态托管（GitHub Pages / OSS / Nginx）下未知路径也有兜底页
 * - 写入 .nojekyll，避免 GitHub Pages 忽略 _nuxt 目录
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, '.output', 'public')
const target = join(root, 'dist')

if (!existsSync(join(source, 'index.html'))) {
  console.error('[export-dist] 未找到 .output/public/index.html，请先执行 nuxt generate')
  process.exit(1)
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })

// 单页应用兜底：未知路径交给同一份预渲染页面
const notFound = join(target, '404.html')
if (!existsSync(notFound)) {
  await writeFile(notFound, await readFile(join(target, 'index.html')))
}

// GitHub Pages 默认走 Jekyll，会忽略下划线开头的目录
await writeFile(join(target, '.nojekyll'), '')

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

const files = await walk(target)
let bytes = 0
for (const file of files) {
  bytes += (await stat(file)).size
}

const html = await readFile(join(target, 'index.html'), 'utf8')
const assetCount = (html.match(/_nuxt\//g) || []).length

console.log(`[export-dist] 输出目录：${relative(root, target)}/`)
console.log(`[export-dist] 文件数：${files.length}，体积：${(bytes / 1024).toFixed(1)} KB`)
console.log(`[export-dist] index.html 引用 _nuxt 资源：${assetCount} 处`)
console.log('[export-dist] 预览：npx serve dist   （或 python3 -m http.server -d dist 4173）')
