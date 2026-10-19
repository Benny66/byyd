## Why

当前页面是“打开—练—关掉”的一次性计时器：练完就没了，用户不知道自己这周坚持了几天，也没法和一起备孕的人互相督促。加打卡记录和全局周榜，把单次使用变成可积累的习惯；同时保留“一天想练几次就练几次”的自由。

## What Changes

- 每次完整训练结束写入一条训练记录，同一天允许多条；先落本地存储，再异步同步到服务端（离线可用）
- 新增“今日”视图：今天第几次、今日累计分钟、连续天数、近 6 周日历
- 新增全局周榜：按“本周有效训练天数”排名，并列时比本周累计分钟；展示昵称，上榜需显式开启
- 新增 Go + SQLite 服务：JSON API + 内嵌前端静态资源，单二进制部署
- 完成屏与顶栏接入打卡状态；新增浮层面板（我的 / 排行榜），不新增页面路由
- **BREAKING** 交付形态从“纯静态托管”变为“单二进制 + SQLite 数据文件”，需要一台带持久磁盘的服务器

### Non-goals

- 不做账号体系与微信登录：身份是匿名设备 ID，换设备或清缓存会变成新用户
- 不做私密房间榜、好友关系、评论与点赞（全局榜之外的社交能力留到后续版本）
- 不做补卡：记录只能由真实完成训练产生
- 不做公开的训练明细：榜单只暴露昵称、天数、分钟数

## Capabilities

### New Capabilities

- `checkin-records`: 训练记录的写入、同日多次、每日聚合、今日统计、连续天数与本地优先持久化
- `leaderboard`: 全局周榜的计分口径、昵称与上榜开关、排名展示与自身定位
- `sync-service`: Go + SQLite 服务端的接口契约、幂等写入、静态资源内嵌与运行约束

### Modified Capabilities

- `session-hud`: 顶栏增加今日次数与连续天数，完成屏增加本次序号与周统计，新增打卡浮层入口
- `workout-session`: 每次完成训练产生一条独立记录；同日重播不再视为“覆盖”，完成态需要携带本次会话信息
- `static-delivery`: 交付形态由纯静态托管改为单二进制内嵌静态资源，404 兜底由服务端处理
- `responsive-layout`: 浮层面板在手机竖屏/横屏与电视上的布局约束，以及面板内滚动例外
- `device-integration`: 浮层打开时的键盘行为（Esc 关闭、空格不穿透到训练控制）

## Impact

- 前端新增：`app/data/checkin.ts`、`app/composables/useCheckin.ts`、`app/composables/useLeaderboard.ts`、`app/components/CheckinPanel.vue`、`app/components/LeaderboardList.vue`
- 前端修改：`app/pages/index.vue`、`app/components/TrainingFinish.vue`、`app/composables/useTrainingPlayer.ts`、`app/assets/css/main.css`
- 新增服务端：`server/`（Go 模块、SQLite 迁移、API 路由、静态资源 embed），构建产物为单二进制
- 构建与部署：`npm run build:dist` 后把 `dist/` 拷入 `server/web/dist`，`go build` 内嵌；新增数据文件目录与备份脚本
- 依赖：Go 1.22+、`modernc.org/sqlite`（纯 Go，免 CGO）；前端不新增运行时依赖
- 验证：`qa/checkin.mjs`（本地记录与榜单渲染）、`qa/api-smoke.mjs`（接口幂等、周榜排序、越界参数）
