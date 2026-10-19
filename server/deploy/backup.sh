#!/usr/bin/env bash
# 每日备份 SQLite：sqlite3 .backup 在 WAL 模式下也能拿到一致快照，不阻塞读写。
# 用法：./backup.sh [/var/lib/beiyun/app.db] [/var/backups/beiyun]
# 保留天数用 BEIYUN_BACKUP_KEEP_DAYS 覆盖（默认 14），加前缀避免和别的项目撞车。
set -euo pipefail

DB="${1:-/var/lib/beiyun/app.db}"
DEST="${2:-/var/backups/beiyun}"
KEEP_DAYS="${BEIYUN_BACKUP_KEEP_DAYS:-14}"

if [ ! -f "$DB" ]; then
  echo "[backup] 数据库不存在: $DB" >&2
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$DEST/app-$STAMP.db"

sqlite3 "$DB" ".backup '$TARGET'"
find "$DEST" -name 'app-*.db' -type f -mtime "+$KEEP_DAYS" -delete

echo "[backup] $TARGET ($(du -h "$TARGET" | cut -f1))"
