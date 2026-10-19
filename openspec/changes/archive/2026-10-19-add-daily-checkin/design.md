## Context

当前站点是 Nuxt 4 预渲染的纯静态页：无后端、无账号，唯一的持久化是 `localStorage` 里三个声音开关（`useAudio.ts` 的 `beiyun30.v1`）。训练完成只有一个收口 `useTrainingPlayer.finish()`，之后除了完成屏没有任何痕迹。

这次要加的是“可积累的习惯反馈”：一天可练多次、能看到今日与历史、并且有一张全局周榜。排行榜天然需要共享存储，因此项目从“纯静态托管”升级为“静态前端 + 自建 Go 服务”，但前端构建产物与交互模型保持不变。

已确认的产品前提：

- 全局公开榜（不是私密房间榜）
- 榜按“本周有效训练天数”排名，并列比本周分钟
- 后端自建：Go + SQLite，服务器部署
- 自用为主，也允许别人跟练；不做账号，不做补卡

## Goals / Non-Goals

**Goals:**

- 每次完整训练产生一条独立记录，同日多次互不覆盖
- 今日记录、连续天数、近 6 周日历即时可见，离线也能用
- 全局周榜按天计分，多次训练只影响个人统计、不放大榜单优势
- 单二进制部署：前端静态资源内嵌，数据落 SQLite 文件，可整包回滚

**Non-Goals:**

- 不做账号、微信登录、跨设备身份合并
- 不做私密房间、好友关系、评论点赞
- 不做服务端下发个人历史（本地是个人记录的唯一真源）
- 不做实时推送、WebSocket、训练中断恢复

## Decisions

### D1. 单二进制内嵌静态资源，而不是 nginx 托管 dist + 独立 API

```
┌─────────────────────────── browser ───────────────────────────┐
│  Nuxt 静态包 (dist/)                                           │
│   useCheckin ── localStorage（记录 + outbox）                  │
│        │                                                       │
│        └── useLeaderboard ── fetch /api/v1/*                   │
└───────────────────────────────┬───────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼───────────────────────────────┐
│  Go 单二进制                                                    │
│   net/http mux ── handlers ── store (SQLite, WAL)              │
│   embed.FS: dist/（含 200.html 兜底）                          │
└───────────────────────────────┬───────────────────────────────┘
                                │
                        data/app.db (+ -wal / -shm)
```

理由：前后端同一个产物发布，接口与前端版本不会漂移；部署只是“换一个二进制 + 重启”，回滚就是换回旧二进制。备选是 nginx 托管 `dist/`、Go 只做 API，多一个发布单元和一层路径配置，收益只有静态文件性能——这个站点的静态资源不到 100 KB，没必要。

代价：改前端必须重新编译二进制；`dist/` 需要先拷进 `server/web/dist` 再 `go build`。用脚本固化这一步。

### D2. 数据模型：会话为事实，天为聚合

```sql
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,              -- 客户端生成的 UUID v4
  nickname     TEXT NOT NULL,
  opt_in       INTEGER NOT NULL DEFAULT 0,   -- 是否上榜（同时代表是否上传）
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_devices_nickname ON devices(nickname COLLATE NOCASE);

CREATE TABLE sessions (
  id         TEXT NOT NULL,                   -- 客户端 UUID，幂等键
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,                   -- 'YYYY-MM-DD'（Asia/Shanghai）
  started_at INTEGER NOT NULL,                -- epoch ms
  ended_at   INTEGER NOT NULL,
  seconds    INTEGER NOT NULL,                -- 1..2400
  mode       TEXT NOT NULL,                   -- 'full' | 'partial'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, id)
);
CREATE INDEX idx_sessions_device_day ON sessions(device_id, day);
CREATE INDEX idx_sessions_day ON sessions(day);
```

- 主键 `(device_id, id)` 让重复上报变成 `ON CONFLICT DO NOTHING`，天然幂等
- 只存会话，不存“今天打卡了”这种派生状态，避免两处真源打架
- `day` 由客户端按 Asia/Shanghai 计算并上报，服务端校验落在 `[今天-7, 今天+1]`（7 天窗口用于开启上榜时补传历史）

### D3. 身份：匿名设备 ID + 昵称，不做登录

首次访问 `crypto.randomUUID()` 生成 `deviceId`，存 `beiyun30.device.v1`。昵称首次上榜时填写，默认“训练者”+ ID 后四位，可改。

- 备选：微信登录/手机号——能跨设备、能防刷，但引入授权摩擦与合规负担，与“打开就练”冲突
- 残余风险：知道 `deviceId` 就能冒充；榜单不返回 `deviceId`，ID 是随机 UUID，实际不可枚举
- 换设备/清缓存 = 新用户，这是明确接受的产品事实，UI 要写清楚

### D4. 榜单计分：按天，不按次

“有效训练日” = 当天至少一条 `mode='full'` 的记录。排名键：`days DESC, minutes DESC, created_at ASC`。一天练三次只贡献 1 天，但分钟数照实累计并作为并列时的次级排序。

理由：如果按次数或分钟排名，会直接激励一天练三四轮，和页面底部“强度以能正常说话为准”的安全提示相冲突。天数口径把竞争引向“坚持”，而不是“堆量”。

周窗口固定为 Asia/Shanghai 的周一 00:00 至周日 24:00。全局只用一个时钟，避免跨时区用户出现“我的今天不是榜单的今天”。代价是海外用户在本地周日晚可能看到榜单已切周，作为已知限制接受。

### D5. 本地优先 + outbox，离线可练

完成训练 → 立即写本地记录（UI 立刻更新）→ 同一 `id` 进 outbox → 触发同步。触发点：应用启动、完成后、`online` 事件、打开面板、每 60 秒（有积压时）。

- 2xx 或 409（已存在）→ 出队
- 4xx 校验失败 → 出队并记日志（毒消息，不阻塞后续）
- 网络错误/5xx → 指数退避 1s→30s，最多 5 次后转入后台低频重试
- outbox 上限 200 条，超出丢最旧（本地记录仍在，不丢个人数据）

服务端不回传个人历史：本地是个人真源，避免“服务端有、本地没有”的第二套状态。代价是清缓存后个人历史丢失，但榜单上的天数仍在服务端。

### D6. 上榜是显式同意，且控制上传

`opt_in` 默认 0。关闭时**不上传任何训练记录**，只在本地。打开时提示“昵称与训练天数会公开”，并可选择是否补传最近 7 天。关闭后服务端把该设备从榜单查询中排除，并提供“删除我的上榜数据”接口。

这是全局公开榜下唯一合理的隐私姿势：备孕训练记录比一般运动数据敏感，不能默认公开。

### D7. 接口契约（`/api/v1`）

| 方法 | 路径 | 作用 | 关键约束 |
| --- | --- | --- | --- |
| POST | `/devices` | 注册/更新设备 | 昵称 1–16 字，大小写不敏感唯一；冲突 409 |
| PATCH | `/devices/{id}` | 改昵称 / 开关上榜 | 同上 |
| DELETE | `/devices/{id}` | 删除上榜数据 | 同时删除 sessions |
| POST | `/sessions` | 上报一次训练 | 幂等；`seconds` 60–2400；`mode` 白名单 |
| GET | `/leaderboard` | 周榜 + 我的排名 | `limit` ≤ 100；只返回 `opt_in=1` |
| GET | `/healthz` | 健康检查 | 含 DB ping |

错误统一 `{"error":{"code":"...","message":"..."}}`。限流：单 IP 120 次/分钟，单设备每日 20 条会话。

榜单在 Go 内存里排序并缓存 30 秒，不引入 Redis：规模是千人级、写入是低频，全量聚合一次也就几毫秒。

### D8. 前端状态与触发点

- `app/data/checkin.ts`：纯函数（`dayKey` / `dayIndex` / `aggregateByDay` / `computeStreak` / `weekDays`），不依赖 Vue，可单独测
- `app/composables/useCheckin.ts`：模块级 reactive 状态（避免多组件各持一份）、localStorage 读写、outbox、同步状态
- `app/composables/useLeaderboard.ts`：拉榜单、30 秒缓存、错误与离线态
- `app/composables/useUiState.ts`：`panelOpen`，供播放器与页面共用，避免键盘事件互相穿透

`finish()` 里新增一次 `recordSession({ startedAt, endedAt, seconds: TOTAL_SECONDS, mode })`。`mode` 由跳关计数决定：`next/prev` 触发过跳段就是 `partial`，仍然记录、但不上榜。

同日多次：每次 `finish()` 生成新 UUID；`restart()` 重置 `sessionStartedAt`，不合并、不覆盖。

### D9. 界面落点：加浮层，不加路由

- 顶栏右侧：`今日 2 次` + `总剩余 32:00`（窄屏隐藏 `v1`，保持不换行）
- 完成屏：`今天第 2 次 · 本周 3 天` + 7 个圆点 + `看周榜` / `再来一遍`
- 浮层（`z-index: 30`）：两个页签“我的 / 排行榜”；“我的”是 6 周日历 + 今日明细，榜单是前 50 名 + 自己那一行
- 不新增路由：预渲染路由不变，也不破坏“打开就练”

滚动例外：`document` 上现有的 `touchmove` 全局 `preventDefault` 会让浮层内部滚不动。处理方式是在拦截函数里判断 `event.target.closest('[data-scroll]')`，命中则放行，并给列表加 `touch-action: pan-y`。这是本次唯一需要动全局手势逻辑的地方。

## Risks / Trade-offs

- **全局公开榜的隐私** → 默认不上榜、显式同意、只暴露昵称/天数/分钟、可删除上榜数据；文案避免出现具体身体指标
- **客户端可伪造成绩** → 服务端钳制时长、限制每日条数、只计完整训练；不追求绝对防刷，接受“朋友间不好意思作弊”的社会约束
- **清缓存/换设备丢身份** → 文案明示；榜单数据仍在服务端，重新上榜会以新身份出现
- **SQLite 单点** → WAL + 每日 `.backup`，单机故障需人工恢复；千人级规模不需要主从
- **改时钟刷天数** → `day` 只接受 `[今天-7, 今天+1]`，且每天最多计 1 天，收益极低
- **前端与接口版本漂移** → 同二进制发布 + `/api/v1` 前缀，基本消除
- **浮层在小屏放不下** → 榜单列表内部滚动，页签固定，6 周日历按 vmin 缩放；QA 覆盖 360×640 与 844×390

## Migration Plan

1. 新增 `server/`，数据库为空库启动，仅新增表，无历史数据迁移
2. 前端新增本地键 `beiyun30.checkin.v1`、`beiyun30.device.v1`、`beiyun30.outbox.v1`，与现有 `beiyun30.v1` 完全隔离；旧版本页面不会覆盖新键
3. 发布：`npm run build:dist` → `node scripts/sync-web.mjs` → `go build` → 上传二进制 → `systemctl restart`
4. 回滚：保留上一个二进制，直接换回；数据库只做加法迁移，旧版本可读
5. 已验证的基线行为（训练计时、音频、全屏）不受影响，回归靠现有 `qa/*.mjs`

## Open Questions

- 昵称是否要求全局唯一：当前按唯一处理（冲突返回 409），会导致热门昵称被抢注；备选是允许重名并用 ID 后缀区分
- 是否把“今日次数”也放上榜单：当前列表展示今日次数，但不参与排名，后续看数据再定
- 是否需要“本周目标”（例如 5/7）替代无限连续天数：先按天数榜单上线，观察断签反馈
