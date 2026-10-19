## Why

现在每一端是一台「设备」，设备和人 1:1。用户在手机 App 练一次、在电脑浏览器练一次，两边各存一份：今日次数分裂、连续天数分裂、榜单上同一个人变成三行。要把「设备为主」翻成「人为主」——一个账号在任意端登录后看到同一份数据。

## What Changes

- 新增账号：昵称 + 密码注册，昵称全局唯一（不区分大小写）且**不可修改**
- 匿名身份与账号合并为同一张身份表：现有设备身份可以「设置密码」原地升级，历史记录不迁移、不丢失
- 训练记录归属从「设备」改为「身份」；登录后从服务端拉取全量记录，未登录仍走本地模式
- 首次登录时把本机已有记录批量上报（接口幂等），保证「登录不丢历史」
- 榜单聚合维度从设备改为身份
- 新增 `POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout`、`GET /api/v1/me/sessions`、`DELETE /api/v1/me`
- **BREAKING** 数据库迁移 v2：`devices` 升级为 `users`，`sessions` 增加身份归属，`(device_id, id)` 主键改为 `(user_id, id)`

### Non-goals

- 不做找回密码：没有邮箱/手机号，忘记密码只能删除账号重建（自用规模可接受）
- 不做第三方登录（微信、Apple）
- 不做昵称修改：账号名即榜单展示名，改名等于换账号
- 不做多账号切换：一端同时只登录一个账号
- 不做增量同步游标：第一期全量拉取，数据量在 100 KB 量级
- 不做设备管理页面：只显示「当前已登录」，不做踢出其他设备

## Capabilities

### New Capabilities

- `accounts`: 注册、登录、匿名身份升级、凭证与注销

### Modified Capabilities

- `sync-service`: 接口契约增加认证接口与「我的记录」；幂等键从设备改为身份；认证接口单独限流
- `checkin-records`: 数据来源改为「登录后以服务端为准 + 全量拉取合并」，未登录保持本地
- `leaderboard`: 计分与昵称唯一性从设备维度改为身份维度

## Impact

- 服务端：`store.go` 迁移 v2 与新查询、`auth.go` 新增、`api.go` 路由与鉴权中间件、密码哈希依赖 `golang.org/x/crypto/bcrypt`
- 前端：`app/data/account.ts` 新增、`useAccount.ts` 新增、`CheckinPanel.vue` 增加登录/注册视图、`useCheckin.ts` 增加登录后的全量同步
- 安卓壳：无需改动（WebView 内登录，token 存 localStorage）
- 数据：升级前必须备份 `data/app.db`（单副本，无云端）
