package web

import "embed"

// Assets 内嵌前端构建产物；构建前由 scripts/sync-web.mjs 把 dist/ 复制到 dist。
//
//go:embed all:dist
var Assets embed.FS
