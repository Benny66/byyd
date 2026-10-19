# 实施任务

## 1. 服务端：数据层

- [ ] 1.1 新增迁移 v2：`users` 表（含 `password_hash` 可空）、`tokens` 表、`users(nickname COLLATE NOCASE)` 唯一索引
- [ ] 1.2 迁移 v2：`INSERT INTO users SELECT ... FROM devices`，`devices` 保留只读
- [ ] 1.3 迁移 v2：`sessions` 重建为 `(user_id, id)` 主键，从 `device_id` 回填
- [ ] 1.4 迁移 v2 整体放在事务里，失败回滚；升级前强制备份 `app.db`
- [ ] 1.5 Store 方法：`CreateUser`、`FindUserByNickname`、`SetPassword`、`DeleteUser`、`ListSessionsByUser`
- [ ] 1.6 Store 方法：`CreateToken`、`FindUserByToken`、`DeleteToken`
- [ ] 1.7 榜单聚合从 `device_id` 改为 `user_id`，保持既有排序口径

## 2. 服务端：接口

- [ ] 2.1 `POST /api/v1/auth/register`：昵称 2–16、密码 ≥8、bcrypt 哈希、冲突 409
- [ ] 2.2 `POST /api/v1/auth/login`：统一 401，不区分昵称不存在与密码错误
- [ ] 2.3 `POST /api/v1/auth/upgrade`：当前设备匿名身份原地设置密码
- [ ] 2.4 `POST /api/v1/auth/logout`：撤销当前 token，不影响其他设备
- [ ] 2.5 `GET /api/v1/me/sessions`：全量、按 `started_at` 升序、只读
- [ ] 2.6 `DELETE /api/v1/me`：级联删除身份、token 与记录
- [ ] 2.7 `POST /api/v1/sessions` 支持可选 Bearer：有 token 归属身份，无 token 归属设备
- [ ] 2.8 鉴权中间件：解析 Bearer、查哈希、注入身份；401 使用 `unauthorized`
- [ ] 2.9 日志中间件脱敏：不记录 Authorization 头
- [ ] 2.10 认证限流：注册 5/时/IP，登录 10/5 分钟/（IP+昵称）且仅失败计数

## 3. 前端：数据层

- [ ] 3.1 `app/data/account.ts`：token 读写（`beiyun30.token.v1`）、注册/登录/升级/退出/删除请求
- [ ] 3.2 `app/data/api.ts` 支持可选 `Authorization` 头
- [ ] 3.3 `app/composables/useAccount.ts`：登录态、当前昵称、错误映射
- [ ] 3.4 `useCheckin.ts`：登录态下上报携带 token；退出后回到设备归属

## 4. 前端：多端同步

- [ ] 4.1 登录成功后：先把本机未上传记录批量上报（幂等），再 `GET /me/sessions` 全量覆盖本地
- [ ] 4.2 合并完成后提示「已同步本机 N 条记录」
- [ ] 4.3 启动时若已有 token，拉取全量并覆盖本地缓存
- [ ] 4.4 拉取失败降级：保留本地缓存并提示「稍后重试」，不阻塞训练
- [ ] 4.5 未登录路径保持现状：本地写入 + 可选上榜

## 5. 前端：界面

- [ ] 5.1 打卡浮层「我的」页签顶部增加登录/注册入口（不新增路由）
- [ ] 5.2 注册表单：昵称、密码、确认密码；错误就地提示
- [ ] 5.3 登录表单：昵称、密码；明确写「密码无法找回」
- [ ] 5.4 已登录状态：显示昵称、已同步条数、「退出登录」「删除账号」
- [ ] 5.5 匿名身份升级入口：把当前匿名身份设为账号（保留记录）
- [ ] 5.6 删除账号二次确认，文案写明不可恢复
- [ ] 5.7 移除「改昵称」入口

## 6. 部署与迁移

- [ ] 6.1 README 增加「升级到账号版」步骤：备份 `app.db` → 停服务 → 换二进制 → 启服务 → 验证
- [ ] 6.2 明确回滚要求：旧二进制需连数据库一起回滚
- [ ] 6.3 安卓壳验证：WebView 内可登录、token 持久化、杀进程后仍保持登录

## 7. 验证

- [ ] 7.1 `qa/api-smoke.mjs` 增加：注册、重名、短密码、登录成功/失败、统一 401、me/sessions、登出、删号
- [ ] 7.2 增加迁移用例：构造 v1 数据库（含设备与记录）→ 升级 → 记录条数与归属不变
- [ ] 7.3 端到端：匿名练 2 次 → 升级 → 另一浏览器登录 → 看到 2 条、今日次数一致
- [ ] 7.4 `qa/checkin.mjs` 增加登录态下的浮层断言
- [ ] 7.5 `npm run typecheck` 与 `openspec validate --strict` 通过

## 8. 收尾

- [ ] 8.1 归档变更，同步基线规格（`accounts` 新增，`sync-service`/`checkin-records`/`leaderboard` 更新）
- [ ] 8.2 更新 `README.md` 的接口表与功能概览
