## 1. 记录层与纯函数

- [x] 1.1 新建 `app/data/checkin.ts`：`dayKey`（Asia/Shanghai）、`dayIndex`（UTC 天序号）、`aggregateByDay`、`computeStreak`、`weekDays`
- [x] 1.2 新建 `qa/checkin-core.mjs`：用 Node 22 `--experimental-strip-types` 直接跑纯函数，覆盖跨月、跨年、断签、今天未练、42 格边界
- [x] 1.3 新建 `app/data/checkin-storage.ts`：`beiyun30.checkin.v1` 的读写、版本字段、损坏数据容错，写入失败不抛错
- [x] 1.4 新建 `app/composables/useCheckin.ts`：模块级状态、今日统计、`recordSession`、outbox 入队/出队、同步状态
- [x] 1.5 新建 `app/composables/useUiState.ts`：`panelOpen` 与打开/关闭方法，供播放器与页面共用

## 2. 播放器接入

- [x] 2.1 `useTrainingPlayer` 增加 `sessionStartedAt` 与 `skipCount`，首次开始与重播时重置
- [x] 2.2 `goTo`（上一个/下一个）累加 `skipCount`，暂停恢复不重置
- [x] 2.3 `finish()` 调用 `recordSession`，按 `skipCount` 判定 `full` / `partial`，并保证只写一次
- [x] 2.4 键盘处理接入 `panelOpen`：浮层打开时屏蔽空格/方向键/R/F/M，Esc 关闭浮层

## 3. 界面

- [x] 3.1 顶栏右侧增加“今日 N 次 / 今日未练”，窄屏与总剩余同排不换行
- [x] 3.2 完成屏增加“今天第 N 次 · 本周 M 天”、7 个圆点与“看周榜”按钮
- [x] 3.3 新建 `app/components/CheckinPanel.vue`：对话框语义、两个页签、关闭按钮、遮罩
- [x] 3.4 “我的”页签：今日次数/分钟/连续天数、今日记录列表、6 周日历与图例
- [x] 3.5 “排行榜”页签：前 50 名、我的排名、未上榜空态、刷新与离线提示
- [x] 3.6 `main.css` 增加浮层、页签、日历、榜单样式，头部固定、内容区滚动、大屏限宽
- [x] 3.7 触摸拦截放行 `[data-scroll]` 区域并设置 `touch-action: pan-y`，页面本身仍不滚动

## 4. Go 服务与 SQLite

- [x] 4.1 新建 `server/go.mod` 与 `cmd/server/main.go`，支持 `ADDR`、`DB_PATH` 环境变量
- [x] 4.2 实现 `internal/store`：SQLite 连接、WAL、`busy_timeout`、外键、启动迁移与 `schema_migrations`
- [x] 4.3 实现设备接口：注册/更新、昵称唯一校验、删除上榜数据（级联删除记录）
- [x] 4.4 实现训练上报：字段校验、`seconds` 60–2400、`mode` 白名单、`(device_id,id)` 幂等
- [x] 4.5 实现榜单聚合：按天去重、天数/分钟排序、前 100 截断、我的排名、30 秒内存缓存
- [x] 4.6 实现静态服务：`embed.FS` 提供 `dist/`，未知路径回退 `200.html`，哈希资源长缓存、入口页不缓存
- [x] 4.7 增加限流（单 IP 每分钟、单设备每日）、结构化访问日志、`/healthz`
- [x] 4.8 统一 Asia/Shanghai 时区与归属日 `[今天-7, 今天+1]` 校验（7 天用于补传）

## 5. 同步与榜单联调

- [x] 5.1 新建 `app/composables/useLeaderboard.ts`：请求、30 秒缓存、离线回退、手动刷新
- [x] 5.2 同步队列：启动/完成/online/面板打开/60 秒重试触发，2xx 与 409 出队、4xx 丢弃、5xx 退避
- [x] 5.3 上榜开关：默认关闭、开启时提示与补传最近 7 天、关闭后停止上传、删除数据入口
- [x] 5.4 昵称设置与冲突提示，默认昵称生成规则
- [x] 5.5 本地起服务做端到端联调：完成→本地记录→同步→榜单出现→再次完成只加天数不重复

## 6. 构建与部署

- [x] 6.1 新建 `scripts/sync-web.mjs`：清空并复制 `dist/` 到 `server/internal/web/dist`，缺失入口 HTML 时报错
- [x] 6.2 `package.json` 增加 `build:server` 与 `serve:server`，串起前端构建、资源同步与 `go build`
- [x] 6.3 编写 systemd unit、Caddy/nginx 反代示例与部署/回滚说明，更新 README
- [x] 6.4 提供每日 SQLite 备份命令（`.backup`）与恢复步骤

## 7. 验证

- [x] 7.1 `qa/checkin.mjs`：注入造好的记录，验证顶栏、今日列表、日历、连续天数
- [x] 7.2 `qa/api-smoke.mjs`：昵称冲突、重复上报、越界时长、日期越界、榜单排序与截断
- [x] 7.3 更新 `qa/nuxt-smoke.mjs`：首屏不因打卡初始化报错，完成流程不回归
- [x] 7.4 `qa/checkin.mjs` 输出浮层三档截图（390×844 竖屏、844×390 横屏、1280×720 桌面）
- [x] 7.5 `npm run typecheck`、`npm run build:dist`、全部 QA 脚本通过
