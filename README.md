# 备孕每日训练 · 32 分钟

面向备孕人群的居家训练计时器：12 个动作循环 2 轮，每个动作前 5 秒准备，每 4 个动作休息 1 分钟，全程配提示音、合成背景乐与中文语音引导。练完自动打卡，支持一天多次记录、连续天数、6 周日历与全局周榜。

Nuxt 4 前端 + Go 服务端：前端预渲染为静态资源并被内嵌进单个二进制，训练记录与榜单落在 SQLite；除计时器本身外，打卡与排行榜需要服务端才能跨设备可见。

## 功能概览

- **严格的时间轴推进**：54 个阶段、1920 秒；切后台、息屏或掉帧后回来，按真实时间一次性对齐，不会越走越慢
- **三段式节奏**：5 秒准备 → 60 秒动作 → 每 4 个动作 60 秒休息，12 个动作循环 2 轮
- **声音引导**：Web Audio 实时合成 124 BPM 背景乐（Am–F–C–G，无音频文件）；阶段相变音、最后 3 秒提示音；中文语音播报，播报时自动压低音乐
- **一屏界面**：环形倒计时、动作线稿、要点与呼吸提示、下一段预告、30 段整体进度、完成屏
- **设备能力**：训练期间屏幕常亮、全屏（失败降级伪全屏）、禁用滚动/下拉刷新/双指缩放、键盘快捷键
- **多端适配**：手机竖屏与横屏、笔记本、桌面、电视；刘海屏安全区；尊重“减少动态效果”偏好
- **静态交付**：前端仍是预渲染静态资源，被 Go 二进制内嵌，同源提供页面与 `/api/v1`
- **打卡记录**：每次完整训练写一条记录，同一天可多次；今日次数/分钟、连续天数、近 6 周日历
- **全局周榜**：按“本周有效训练天数”排名，并列比分钟；昵称 + 显式上榜开关，默认不上传
- **离线优先**：本地先落盘，待同步队列在联网后自动补传；清缓存或换设备会变成新用户

## 技术栈

| 项 | 选型 |
| --- | --- |
| 前端 | Nuxt 4.6 / Vue 3.5，Nitro `static` preset 预渲染 |
| 语言 | TypeScript（strict）+ Go 1.22+ |
| 服务端 | Go 标准库 `net/http` + `embed.FS`，单二进制 |
| 数据库 | SQLite（`modernc.org/sqlite`，纯 Go 免 CGO，WAL） |
| 样式 | 原生 CSS（vmin 版面 + 主题变量），无 UI 框架 |
| 依赖 | 前端无运行时第三方依赖、无外部音频文件；服务端仅 SQLite 驱动 |

## 快速开始

要求 Node.js `^20.19` 或 `>=22.12`（推荐 22 LTS）。

```bash
npm install
npm run dev        # 前端 http://localhost:3000（/api 代理到 8787）
npm run serve:server  # 另开一个终端：Go 服务 http://127.0.0.1:8787
```

只练不打卡可以单跑 `npm run dev`；要联调打卡与榜单，需要同时起 Go 服务。

项目内 `.npmrc` 默认使用 npmmirror 源；如需切回官方源，删除该文件即可。若 npm 10.9.x 解析 Nuxt peer 依赖时报 `edgesOut` 相关错误，改用 `npm install --legacy-peer-deps`。

## 可用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动前端开发服务器（`/api` 代理到 `127.0.0.1:8787`） |
| `npm run serve:server` | 用 `go run` 启动服务端（数据在 `server/data/app.db`） |
| `npm run build` | 构建（static preset，产物在 `.output/public`） |
| `npm run generate` | 预渲染整站 |
| `npm run build:dist` | 构建并导出到 `dist/` |
| `npm run build:server` | 构建前端 → 同步进 `server/internal/web/dist` → 编译 `bin/beiyun-server` |
| `npm run checkin:core` | 用 Node 22 直接跑打卡纯函数测试 |
| `npm run pack` | 构建 → 导出 → 打静态 zip（不含打卡与榜单，仅离线计时用） |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | `vue-tsc` 类型检查 |
| `npm run prepare:types` | 生成 `.nuxt` 类型声明 |

## 课程与时间轴

动作清单来自 [`docs/yd.md`](docs/yd.md)，每个动作 60 秒，顺序固定：

| # | 动作 | # | 动作 |
| --- | --- | --- | --- |
| 1 | 原地碎小步 | 7 | 半蹲弹震 |
| 2 | 换脚跳 | 8 | 半蹲交替撤步 |
| 3 | 高抬腿 | 9 | 深蹲回环 |
| 4 | 后踢腿 | 10 | 深蹲 |
| 5 | 劈砍踢膝 | 11 | 空手跳绳 |
| 6 | 胯下击掌 | 12 | 开合跳 |

排课参数集中在 [`app/data/training.ts`](app/data/training.ts)：

| 参数 | 值 | 常量 |
| --- | --- | --- |
| 单个动作时长 | 60 秒 | `PHASE_SECONDS` |
| 动作前准备倒计时 | 5 秒 | `PREPARE_SECONDS` |
| 组间休息 | 60 秒 | `REST_SECONDS` |
| 每几个动作休息一次 | 4 | `ACTIONS_PER_REST` |
| 循环轮数 | 2 | `ROUNDS` |
| 阶段总数 | 54（准备 24 + 动作 24 + 休息 6） | — |
| 总时长 | 1920 秒 = 32:00（对外显示 32 分钟） | `TOTAL_SECONDS` / `TOTAL_MINUTES` |

计算方式：`24 × (5 + 60) + 6 × 60 = 1920 秒`。

底部整体进度条共 30 段（24 个动作 + 6 个休息），5 秒准备不单独占段。

## 目录结构

```
app/
├── app.vue
├── assets/css/main.css        # vmin 版面、主题色、断点、安全区、浮层样式
├── components/
│   ├── TrainingRing.vue       # 环形倒计时 + 阶段标签
│   ├── ExerciseFigure.vue     # 12 套动作线稿，每个 2–3 帧循环动画
│   ├── TrainingInfo.vue       # 动作名 / 要点 / 呼吸 / 下一段
│   ├── TrainingProgress.vue   # 30 段整体进度条
│   ├── TrainingControls.vue   # 控制栏
│   ├── TrainingFinish.vue     # 完成屏（今天第 N 次 / 本周天数 / 看周榜）
│   └── CheckinPanel.vue       # 打卡浮层：我的 / 排行榜
├── composables/
│   ├── useTrainingPlayer.ts   # 播放状态机、时间锚点计时、会话元数据
│   ├── useCheckin.ts          # 打卡状态、本地持久化、待同步队列
│   ├── useLeaderboard.ts      # 周榜请求与缓存
│   ├── useUiState.ts          # 浮层开关（播放器与页面共用）
│   ├── useAudio.ts            # 合成音乐 / 提示音 / 语音 / 偏好
│   ├── useWakeLock.ts         # 屏幕常亮
│   └── useFullscreen.ts       # 全屏与伪全屏降级
├── data/
│   ├── training.ts            # 课程数据与时间轴构建
│   ├── checkin.ts             # 打卡纯函数（日期、连续天数、日历）
│   ├── checkin-storage.ts     # 本地存储读写与容错
│   └── api.ts                 # /api/v1 客户端
└── pages/index.vue            # 页面组装

server/
├── cmd/server/main.go         # 单二进制入口：配置、内嵌资源、优雅退出
├── internal/api/api.go        # 路由、校验、限流、静态资源、缓存
├── internal/store/store.go    # SQLite、迁移、聚合查询
├── internal/web/web.go        # embed 前端产物
├── internal/web/dist/         # 由 scripts/sync-web.mjs 同步（不入库）
└── deploy/                    # systemd unit / Caddyfile / 备份脚本

scripts/sync-web.mjs           # dist → server/internal/web/dist
qa/                            # CDP 与接口校验脚本
docs/yd.md                     # 原始动作清单
```

## 快捷键

| 按键 | 行为 |
| --- | --- |
| `空格` / `回车` | 播放 / 暂停 |
| `←` / `→` | 上一个 / 下一个阶段 |
| `R` | 从头重播 |
| `F` | 切换全屏 |
| `M` | 提示音开关 |

## 声音与偏好

- 音乐、提示音、语音是三个独立开关，切换即时生效；状态写入 `localStorage`（键名 `beiyun30.v1`），下次打开自动恢复
- 音乐完全由振荡器与噪声实时合成，不请求任何音频文件；语音走浏览器 `SpeechSynthesis`（zh-CN，语速 1.02）
- 语音播报期间音乐音量从 0.32 压到 0.09，播报结束 0.12 秒内恢复
- 音频上下文在首次点击“开始”时才初始化，符合浏览器自动播放策略；不支持时静默降级，不影响计时

## 打卡与周榜

### 记录规则

- 每次**完整完成** 32 分钟训练写一条记录；同一天可以练多次，每条独立
- 归属日统一按 Asia/Shanghai 计算，跨零点的一练归到**开始日**
- 用过“上一个/下一个”跳段的训练标记为“部分训练”，本地照常记录，但不进榜单
- 本地键：`beiyun30.checkin.v1`（记录）、`beiyun30.outbox.v1`（待同步）、`beiyun30.device.v1`（设备 ID）、`beiyun30.profile.v1`（昵称/上榜开关），与声音偏好的 `beiyun30.v1` 完全隔离

### 榜单口径

- 周期：北京时间周一 00:00 至周日 24:00
- 主指标：本周有效训练天数（当天至少一条完整训练），**一天练多次只算 1 天**
- 并列：先比本周累计分钟数，再比设备注册时间
- 每行只展示昵称、本周天数、本周分钟、今日次数；不展示设备 ID 与训练明细

### 隐私

- 上榜默认关闭；关闭时**不上传任何记录**，只在本地
- 开启时明确提示“昵称与训练天数会公开”，并补传最近 7 天
- 任何时候可以关闭上榜或删除上榜数据，本地记录保留

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/devices` | 注册/更新设备，昵称大小写不敏感唯一 |
| PATCH | `/api/v1/devices/{id}` | 改昵称 / 开关上榜 |
| DELETE | `/api/v1/devices/{id}` | 删除上榜数据（级联删除记录） |
| POST | `/api/v1/sessions` | 上报一次训练，`(device_id, id)` 幂等 |
| GET | `/api/v1/leaderboard` | 周榜 + 我的排名 |
| GET | `/healthz` | 健康检查（含 DB） |

同步是本地优先：完成训练先写本地并立即更新 UI，再进待同步队列；联网、启动、完成后重试，失败按 1s→30s 退避，4xx 毒消息直接丢弃，避免堵队列。

## 构建与部署

### 单二进制

```bash
npm run build:server
# 等价于：npm run build:dist
#         node scripts/sync-web.mjs
#         cd server && go build -trimpath -ldflags "-s -w" -o ../bin/beiyun-server ./cmd/server
```

产物是 `bin/beiyun-server`（约 10 MB）：内嵌前端资源 + API + SQLite 驱动。运行时只需要三样东西——可执行文件、可写的数据库目录、监听地址。

**部署到 Linux 必须交叉编译**，否则拿到的是 macOS 的 Mach-O，在服务器上会直接报 `cannot execute binary file`：

```bash
npm run build:linux          # 同时产出 amd64 与 arm64
npm run build:linux:amd64    # 只出 x86-64（多数云服务器）
npm run build:linux:arm64    # 只出 ARM64（部分轻量云 / 鲲鹏）
```

服务器上看架构用 `uname -m`：`x86_64` → amd64，`aarch64` → arm64。SQLite 驱动是纯 Go 实现，所以交叉编译不需要 CGO，产物是静态链接的，放到 CentOS 7 这类老系统上也不缺 glibc。

```bash
BEIYUN_ADDR=127.0.0.1:8787 BEIYUN_DB_PATH=/var/lib/beiyun/app.db ./bin/beiyun-server
```

环境变量一律带 `BEIYUN_` 前缀，避免和同机其他项目或 shell profile 里的 `ADDR` / `DB_PATH` 撞车：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BEIYUN_ADDR` | `:8787` | 监听地址；生产建议只绑 `127.0.0.1` 交给反代 |
| `BEIYUN_DB_PATH` | `data/app.db` | SQLite 路径，相对路径基于工作目录 |
| `BEIYUN_BACKUP_KEEP_DAYS` | `14` | 仅 `backup.sh` 使用，备份保留天数 |

旧的无前缀写法（`ADDR`、`DB_PATH`）**不再生效**：启动时检测到会打印 `检测到未加前缀的环境变量，请改名后重启` 并直接退出，避免带着空库或错误端口跑起来。

### 服务器部署

```bash
# 1. 目录与用户
sudo useradd -r -s /usr/sbin/nologin beiyun
sudo mkdir -p /opt/beiyun /var/lib/beiyun /var/backups/beiyun
sudo chown -R beiyun:beiyun /opt/beiyun /var/lib/beiyun /var/backups/beiyun

# 2. 上传二进制与 unit
scp bin/beiyun-server root@host:/opt/beiyun/
scp server/deploy/beiyun-server.service root@host:/etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now beiyun-server

# 3. TLS：用 Caddy 反代 127.0.0.1:8787（见 server/deploy/Caddyfile）
sudo caddy reload --config /etc/caddy/Caddyfile
```

部署前检查：`curl https://your.domain/healthz` 返回 `{"status":"ok","db":"ok"}`；访问未知路径应返回训练页而不是服务器默认 404。

### 宝塔面板（Go 项目）

宝塔的「网站 → Go 项目」直接跑二进制，不用装 Go 环境，也不能把 macOS 上编好的文件传上去。

```bash
# 1. 本地按服务器架构交叉编译
uname -m                                    # 服务器上确认：x86_64 还是 aarch64
npm run build:linux:amd64                   # x86_64 用这个；ARM 机器用 build:linux:arm64

# 2. 上传并赋可执行权限（漏掉 chmod 会报 Permission denied）
scp bin/beiyun-server-linux-amd64 root@host:/www/wwwroot/byyd/beiyun-server
ssh root@host 'cd /www/wwwroot/byyd && chmod +x beiyun-server && mkdir -p data'
```

面板里新建 Go 项目：项目目录 `/www/wwwroot/byyd`、启动文件 `beiyun-server`、项目端口 `8787`，然后在「环境变量」里填：

```
BEIYUN_ADDR=127.0.0.1:8787
BEIYUN_DB_PATH=/www/wwwroot/byyd/data/app.db
```

几个容易踩的点：

- **端口冲突**：面板的「项目端口」和 `BEIYUN_ADDR` 里的端口要一致；只想让 Nginx 反代时把 `BEIYUN_ADDR` 绑 `127.0.0.1`，别让 8787 直连公网。
- **目录权限**：面板默认用 `www` 用户跑项目，`data` 目录属主必须是它，否则 SQLite 打不开会直接退出：`chown -R www:www /www/wwwroot/byyd/data`。
- **更新**：面板停项目 → 覆盖二进制（同名直接 `scp`）→ 启项目。数据库迁移只做加法，旧二进制也能读新库，回滚就是换回上一个文件。
- **备份**：把 `server/deploy/backup.sh` 传上去，用面板「计划任务 → Shell 脚本」加每日任务：
  ```bash
  BEIYUN_BACKUP_KEEP_DAYS=14 /www/wwwroot/byyd/backup.sh /www/wwwroot/byyd/data/app.db /www/backup/byyd
  ```
- `data/` 已在 `.gitignore` 里，别把线上库提交回仓库。

#### Nginx 配置

站点配置有两种写法，推荐第二种。

**用面板的「反向代理」**：网站 → 设置 → 反向代理 → 添加，目标 URL 填 `http://127.0.0.1:8787`、发送域名 `$host`。够用，但面板生成的文件里转发头写的是 `$proxy_add_x_forwarded_for`，见下面第 2 点，需要手工改一行。

**手写配置**（完整示例见 `server/deploy/nginx.bt.conf.example`）：网站 → 设置 → 配置文件，把 `location /` 贴进现有 `server` 块。注意别整体覆盖面板生成的文件——`#SSL-START/#SSL-END` 和伪静态 `include` 两段是面板在维护的。

```nginx
client_max_body_size 64k;

location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # 覆盖，不要用 $proxy_add_x_forwarded_for
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;

    gzip_proxied any;
}

location = /healthz {
    access_log off;
    proxy_pass http://127.0.0.1:8787;
}
```

三个要点：

1. **不要配 `root` / `try_files`**。前端产物已经编进二进制，静态资源和 SPA 回退（未知路径返回训练页）都由 Go 处理，`/_nuxt/` 的 immutable 缓存头也是 Go 设的，nginx 再写 `expires` 只会打架。
2. **转发头必须用 `$remote_addr` 覆盖**。`$proxy_add_x_forwarded_for` 会保留客户端自带的 `X-Forwarded-For` 再往后追加，服务端取的是最右一跳的真实地址，但只要有人直连 8787 就能自带任意值——用 `$remote_addr` 覆盖等于把伪造的可能掐掉。
3. **`/healthz` 关掉访问日志**，监控每分钟探活会把日志刷满。

### 回滚

替换 `bin/beiyun-server` 为上一版二进制并 `systemctl restart beiyun-server`。数据库迁移只做加法，旧二进制能读新库；回滚不需要动数据。

### 备份

```bash
# 建议 daily cron，14 天保留
0 4 * * * BEIYUN_BACKUP_KEEP_DAYS=14 /opt/beiyun/backup.sh /var/lib/beiyun/app.db /var/backups/beiyun
```

`sqlite3 .backup` 在 WAL 下能拿到一致快照，不阻塞在线读写。恢复时停服务、替换 `app.db`、再启动。

### 只跑计时器

`dist/` 仍可单独用静态服务器预览：

```bash
python3 -m http.server -d dist 4173
```

但**打卡上榜不可用**（没有 `/api`），本地记录与今日统计仍然正常。`npm run pack` 打出的静态 zip 同理，只适合离线计时。

> **不能双击 `index.html` 打开。** 页面用 ES Module 加载，`file://` 下浏览器按 CORS 拦截模块脚本，只剩预渲染快照。必须通过 http 访问。

## 自动化验证

`qa/` 下是基于 CDP（headless Chrome）的校验脚本，都针对构建产物跑。先起静态服务：

```bash
python3 -m http.server -d dist 4173
```

| 脚本 | 作用 |
| --- | --- |
| `qa/nuxt-smoke.mjs` | 主流程冒烟：首屏准备态、5 秒自动开始、暂停与时间锚点补偿、切动作、音乐开关、休息段、移动端不溢出、多帧动画、无 console 错误 |
| `qa/checkin-core.mjs` | 打卡纯函数：时区归属、跨月跨年、断签、同日多次、42 格日历边界 |
| `qa/checkin.mjs` | 打卡界面：注入记录后核对徽标、今日统计、日历、今日列表、完成写入与新记录 |
| `qa/api-smoke.mjs` | 服务端接口：注册、昵称冲突、幂等、时长与日期边界、榜单排序、上榜开关与删除 |
| `qa/anim-check.mjs` | 逐帧动画：多次采样每帧 `opacity`，校验任一时刻只有一帧可见且会切换（含三帧动作） |
| `qa/figures.mjs` | 冻结动画后逐帧截图，输出 `qa/shots/nuxt/figures-grid.png` 核对图 |
| `qa/layout-shots.mjs` | 桌面 / 手机竖屏 / 电视三档排版截图与尺寸核对 |
| `qa/verify-package.mjs` | 解压 zip 到临时目录后验证产物真能跑（含 Vue 水合与交互） |

```bash
node qa/checkin-core.mjs
node qa/nuxt-smoke.mjs http://127.0.0.1:8787
node qa/checkin.mjs   http://127.0.0.1:8787
node qa/api-smoke.mjs http://127.0.0.1:8787
node qa/verify-package.mjs /tmp/beiyun-verify 4179
```

## 浏览器与降级

- 建议使用近两年的 Chrome / Edge / Safari；界面按现代浏览器实现，未做 IE 兼容
- 屏幕常亮（Wake Lock）与全屏需要 HTTPS 或 `localhost`，失败时自动降级：全屏退化为伪全屏样式，常亮直接跳过
- 语音音色取决于系统已安装的中文语音；无语音合成能力时只保留音乐与提示音

## OpenSpec 规格

`openspec/specs/` 下有 10 份基线能力规格，描述“当前系统应该做什么”（前 7 份从既有代码逆向整理，打卡 3 份随 `add-daily-checkin` 变更新增）：

| 能力 | 覆盖内容 |
| --- | --- |
| `training-timeline` | 12 动作、排课规则、54 阶段 / 1920 秒 |
| `workout-session` | 时间锚点计时、暂停补偿、跨阶段追赶、播放控制、完成态 |
| `session-hud` | 首屏、状态文案、环形倒计时、30 段进度、完成屏 |
| `audio-guidance` | 合成音乐、提示音、语音、ducking、开关与偏好 |
| `device-integration` | 常亮、全屏降级、手势抑制、快捷键、无障碍 |
| `responsive-layout` | 单屏不滚动、vmin 版面、断点、主题色、减少动效 |
| `static-delivery` | 预渲染、页面元信息、单二进制内嵌与发布 |
| `checkin-records` | 打卡记录、归属日、今日统计、连续天数、6 周日历 |
| `leaderboard` | 本周有效训练天数榜、昵称、上榜 opt-in、自身排名 |
| `sync-service` | 单二进制 + SQLite、上报幂等、限流、healthz 时区基准 |

上述 10 份规格均已在 `openspec/specs/` 基线中；`add-daily-checkin` 变更已归档到 `openspec/changes/archive/2026-10-19-add-daily-checkin/`。

```bash
openspec validate --specs
openspec list --specs
```

修改行为时走变更流程：`openspec new change <name>` → 编写 proposal / specs / design / tasks → 归档后更新基线规格。

## 已知问题

- `deliverables/beiyun-30min.html` 是迁移到 Nuxt 之前的单页版本（24 动作、无音乐），仅作存档，与当前课程不一致
- `dist.bak*` / `.output.bak*` 为历史构建备份（沙箱 safe-delete 拦截批量删除时留下的），确认无误后可清理
- 打卡与周榜依赖 Go 服务：纯静态部署（`npm run pack`）只能计时与本地记录，无法同步和上榜
- 榜单时间统一按 Asia/Shanghai；海外用户在本地周日晚可能看到榜单已切周
- 昵称全局唯一，热门昵称可能已被占用；换设备或清缓存会变成新身份

## 免责声明

训练强度以能正常说话为准，出现头晕、胸闷、腹痛等不适请立即停止。本项目仅提供计时与动作提示，不构成医疗建议。
