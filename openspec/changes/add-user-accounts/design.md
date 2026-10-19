# 设计与决策记录

## 约束

- 单二进制 + SQLite，没有 Redis、没有邮件服务、没有对象存储
- 只有一个真实用户（作者本人），但有"给朋友用"的可能性，不能设计成单人后门
- 数据只有一份（服务器 `data/app.db`），迁移必须可回滚、不可丢记录
- 移动端是 WebView 套壳，与浏览器共享同一套前端代码

## 决策 1：匿名设备与账号统一成一张身份表

这是整个设计的地基。

方案对比：

| 方案 | 结构 | 昵称唯一性 | 迁移 | 榜单 |
|---|---|---|---|---|
| A. 两张表（users + devices） | 两套身份并存 | 跨表查重，应用层保证，并发有竞态 | 需要把设备数据搬到用户并去重 | 两个聚合维度，口径分裂 |
| **B. 单表身份（采纳）** | `users` 吸收 `devices`，`password_hash` 可空 | 一个唯一索引天然全局 | 设备行原地升级，零搬迁 | 单一维度 |

采纳 B。匿名设备 = 没有密码的身份。用户「设置密码」就是把这一行填上哈希，历史记录天然属于它，**不需要任何数据搬迁**。

```
users
├─ id            身份 ID（沿用原 device_id，保持兼容）
├─ nickname      NOCASE 唯一，不可改
├─ password_hash 可空；为空 = 匿名身份
├─ opt_in
└─ created_at / last_seen_at
```

这个巧妙之处在于：迁移只是 `INSERT INTO users SELECT ... FROM devices`，`sessions` 只需把 `device_id` 改名成 `user_id`。整个升级过程是**改名而不是搬数据**，出错概率最低。

## 决策 2：昵称 + 密码，且不提供找回

- 密码用 bcrypt（cost 10），`golang.org/x/crypto/bcrypt`，纯 Go 无 CGO，不破坏交叉编译
- 密码策略：≥8 字符，不强制大小写/符号（长度是更强的因子，复杂度规则只会逼用户写 `Password1`）
- 无找回：没有邮箱和手机号，找回等于自建一套验证通道。忘密码的出路是「删除账号重建」，UI 必须明确写出来
- 昵称允许 2–16 字符（现有规则是 1–16，注册时收紧到 2，避免单字符昵称抢占）

## 决策 3：昵称不可修改

- 昵称同时是账号名和榜单展示名
- 允许改名会让"账号名"变成可变主键，登录态、榜单历史、口头约定都会漂移
- 现有「改昵称」功能随之删除（匿名状态下仍可在开启上榜时首次设定昵称，设定后同样不可改）

## 决策 4：未登录仍然可用

登录不是前置条件。未登录 = 现在的行为（本地记录 + 可选上榜）。登录是"升级"，不是"门槛"。

登录时刻的合并：

```
本地 sessions（可能从没上传过）
        │
        ├─ 逐条 POST /api/v1/sessions（带 token，幂等）
        ▼
服务端已有数据 ∪ 本机数据  → 全量返回
        │
        ▼
本地用返回结果覆盖缓存（同一条记录不会重复，因为 ID 是客户端 UUID）
```

因为 `(user_id, id)` 幂等，重推是安全的；两端同一天各练一次也都保留——一天多次本来就是合法语义。**这套模型里没有真正的冲突合并**。

## 决策 5：全量拉取，不做增量

一年 1000 条记录约 100 KB，全量拉取一次的成本可以忽略。增量需要游标、墓碑、时钟偏移处理，收益与复杂度不成比例。等记录过万再考虑。

## 数据模型（迁移 v2）

```sql
-- 1) 身份表吸收设备表
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    nickname      TEXT NOT NULL,
    password_hash TEXT,              -- NULL = 匿名身份
    opt_in        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_users_nickname ON users(nickname COLLATE NOCASE);

INSERT INTO users (id, nickname, password_hash, opt_in, created_at, last_seen_at)
SELECT id, nickname, NULL, opt_in, created_at, last_seen_at FROM devices;

-- 2) 训练记录换归属
CREATE TABLE sessions_new (
    id         TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER NOT NULL,
    seconds    INTEGER NOT NULL,
    mode       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
);
INSERT INTO sessions_new SELECT id, device_id, day, started_at, ended_at, seconds, mode, created_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_user_day ON sessions(user_id, day);
CREATE INDEX idx_sessions_day ON sessions(day);

-- 3) 登录凭证
CREATE TABLE tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
```

`devices` 表在 v2 之后不再使用，但**保留不删**（只读），万一需要回滚到旧二进制仍有数据可查。

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/v1/auth/register` | 无 | `{nickname, password}` → `{token, user}`；昵称冲突 409 |
| POST | `/api/v1/auth/login` | 无 | `{nickname, password}` → `{token, user}`；失败统一 401 |
| POST | `/api/v1/auth/upgrade` | 当前设备 | 匿名身份设置密码，原地升级 |
| POST | `/api/v1/auth/logout` | Bearer | 撤销当前 token |
| GET | `/api/v1/me/sessions` | Bearer | 全量记录，用于多端合并 |
| DELETE | `/api/v1/me` | Bearer | 删除账号与全部记录、退出榜单 |
| POST | `/api/v1/sessions` | 可选 Bearer | 有 token 归属身份，无 token 归属设备（兼容） |
| GET | `/api/v1/leaderboard` | 无 | 聚合维度改为身份 |

错误码沿用现有结构：`{"error":{"code","message"}}`。新增 `unauthorized` / `nickname_taken` / `invalid_credentials`。

## 凭证

- 服务端生成 32 字节随机 token，只存 SHA-256 哈希
- 客户端存 `localStorage['beiyun30.token.v1']`，请求带 `Authorization: Bearer <token>`
- 不设过期时间（自用场景），退出登录即删除服务端记录
- token 不写日志；`Log` 中间件只记路径与状态码

## 限流

现有 IP 限流 120/min 对登录太宽松。认证接口单独限速：

| 接口 | 限制 | 键 |
|---|---|---|
| register | 5 次 / 小时 | IP |
| login | 10 次 / 5 分钟，失败才计数 | IP + 昵称 |
| 其他 `/api/v1` | 120 次 / 分钟 | IP（现有） |

## 风险

| 风险 | 影响 | 处理 |
|---|---|---|
| 迁移弄坏现有数据库 | 全部记录丢失 | 升级前强制备份；迁移放在事务里；v2 只改名不删数据 |
| 忘记密码 | 无法登录 | UI 明示"密码无法找回"；提供删号重建 |
| 昵称被抢注 | 好名字被占 | 当前只有作者本人，不做；将来可加"未使用 90 天回收" |
| token 泄漏 | 他人可改数据 | 仅 HTTPS；token 只存哈希；可退出撤销 |
| 前端登录态与服务端数据不一致 | 显示错乱 | 登录后强制全量覆盖本地；未登录不读服务端 |
| WebView 与浏览器 token 不共享 | 需各登录一次 | 预期行为，不是缺陷 |

## 回滚

二进制回滚到 v1.7 之前的版本时，旧代码读 `devices` 表（仍在）与 `sessions.device_id`（已改名）——**旧二进制会读不到记录**。所以回滚只能连数据库一起回滚：升级前 `cp app.db app.db.bak`，回滚时一并还原。这一点必须在发布步骤里写死。
