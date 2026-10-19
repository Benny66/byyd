## MODIFIED Requirements

### Requirement: 接口契约

服务 SHALL 在 `/api/v1` 下提供身份注册与登录、退出登录、匿名升级、我的记录查询、账号删除、设备注册与更新、训练记录上报、榜单查询与健康检查接口；响应 MUST 为 JSON，错误 MUST 使用统一错误码结构；接口版本变化 MUST 通过路径前缀区分；需要身份的接口 MUST 通过 `Authorization: Bearer` 头鉴权。

#### Scenario: 设备注册

- **WHEN** 提交设备 ID 与昵称
- **THEN** 返回身份信息，重复提交同一设备 ID 视为更新

#### Scenario: 身份注册

- **WHEN** 提交昵称与密码
- **THEN** 返回 token 与身份信息

#### Scenario: 训练上报

- **WHEN** 提交一条合法记录
- **THEN** 返回成功状态与新记录标识

#### Scenario: 我的记录

- **WHEN** 携带有效 token 请求 `/api/v1/me/sessions`
- **THEN** 返回该身份的全部记录，按开始时刻升序

#### Scenario: 错误结构

- **WHEN** 请求参数非法
- **THEN** 返回对应 4xx 状态与包含 code、message 的 JSON 错误体

#### Scenario: 未知接口

- **WHEN** 请求不存在的 `/api/v1/*` 路径
- **THEN** 返回 404 JSON 错误，不回退到前端页面

### Requirement: 幂等写入

训练记录上报 MUST 以「身份 ID + 记录 ID」为唯一键；携带 token 时归属该身份，未携带 token 时归属当前设备身份；重复上报同一条记录 MUST 返回成功语义且不产生重复数据；客户端重试 MUST 安全。

#### Scenario: 重试同一记录

- **WHEN** 同一条记录连续上报两次
- **THEN** 第二次返回成功且不新增记录，榜单统计不变

#### Scenario: 不同身份同 ID

- **WHEN** 两个身份各自上报相同记录 ID
- **THEN** 两条记录分别保存，互不覆盖

#### Scenario: 登录前后上报同一记录

- **WHEN** 未登录时上报过一条记录，登录后又重推同一条
- **THEN** 只保留一条记录，归属仍为该身份

### Requirement: 限流与容量

服务 SHALL 对认证接口单独限速，MUST NOT 与普通业务接口共用额度：注册 MUST 限制为每 IP 每小时 5 次；登录 MUST 限制为每 IP + 昵称 5 分钟内 10 次且仅失败计数；其余 `/api/v1` 接口 MUST 限制为每 IP 每分钟 120 次；单设备单日记录数上限 MUST 保持 20 条。

#### Scenario: 注册频率超限

- **WHEN** 同一 IP 一小时内第 6 次注册
- **THEN** 返回 429 与稍后重试提示

#### Scenario: 密码爆破

- **WHEN** 同一 IP 对同一昵称 5 分钟内连续 11 次密码错误
- **THEN** 返回 429，成功登录不消耗额度

#### Scenario: 业务接口不受认证额度影响

- **WHEN** 用户登录失败已达上限
- **THEN** 其查询榜单的请求仍正常返回

## ADDED Requirements

### Requirement: 身份鉴权

需要身份的接口 MUST 校验 `Authorization: Bearer` 凭证；凭证无效或缺失 MUST 返回 401 与 `unauthorized` 错误码；鉴权中间件 MUST NOT 将凭证内容写入日志或响应体。

#### Scenario: 无凭证

- **WHEN** 请求 `/api/v1/me/sessions` 且不带 Authorization 头
- **THEN** 返回 401 与 `unauthorized`

#### Scenario: 凭证失效

- **WHEN** 使用已退出的 token 请求受限接口
- **THEN** 返回 401

#### Scenario: 无效凭证不泄露细节

- **WHEN** 使用伪造 token 请求
- **THEN** 返回 401，响应体不含「token 不存在」与「身份不存在」的区分信息

### Requirement: 我的记录查询

`GET /api/v1/me/sessions` SHALL 返回该身份在服务端的全部训练记录，用于多端合并；响应 MUST 按 `started_at` 升序；记录 MUST 只包含记录本身，不含其他身份的字段；该接口 MUST NOT 触发任何写入。

#### Scenario: 多端合并

- **WHEN** 身份在设备 A 有 12 条、设备 B 有 5 条且已各自上报
- **THEN** 任一设备登录后查询均返回这 17 条

#### Scenario: 只读语义

- **WHEN** 连续调用该接口两次
- **THEN** 返回内容一致，不产生新记录
