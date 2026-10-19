import { cpSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'dist')
const target = join(root, 'server', 'internal', 'web', 'dist')

if (!existsSync(join(source, 'index.html'))) {
  console.error('[sync-web] dist/index.html 不存在，请先执行 npm run build:dist')
  process.exit(1)
}

mkdirSync(target, { recursive: true })

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

const sourceFiles = new Set(walk(source).map((file) => relative(source, file)))
cpSync(source, target, { recursive: true, force: true })

let removed = 0
for (const stale of walk(target)) {
  const rel = relative(target, stale)
  if (sourceFiles.has(rel)) continue
  try {
    unlinkSync(stale)
    removed += 1
  } catch (error) {
    console.warn(`[sync-web] 无法删除旧文件 ${rel}: ${error.message}`)
  }
}

const files = walk(target)
const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0)
console.log(
  `[sync-web] ${files.length} 个文件 / ${(bytes / 1024).toFixed(1)} KB → server/internal/web/dist（清理旧文件 ${removed} 个）`
)
