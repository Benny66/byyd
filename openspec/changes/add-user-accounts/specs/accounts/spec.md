## ADDED Requirements

### Requirement: 身份模型

系统 SHALL 用单一身份表承载「匿名设备」与「注册账号」两种形态：身份 MUST 由全局唯一的昵称标识，未设置密码的身份 SHALL 视为匿名身份，已设置密码的身份 SHALL 可跨端登录。昵称的唯一性 MUST 不区分大小写。

#### Scenario: 匿名身份与账号同表

- **WHEN** 未登录用户在某端完成训练
- **THEN** 记录归属于该端的匿名身份，该身份在身份表中已存在但密码为空

#### Scenario: 昵称跨形态唯一

- **WHEN** 匿名身份已使用昵称「Benny」
- **THEN** 另一个用户注册「benny」时被拒绝，返回昵称已占用

### Requirement: 注册

系统 SHALL 允许任何人用「昵称 + 密码」注册；昵称 MUST 为 2–16 个字符且不区分大小写唯一，密码 MUST 不少于 8 个字符；注册成功 MUST 返回凭证，并 MUST 立即签发有效会话。

#### Scenario: 注册成功

- **WHEN** 提交未占用的昵称与合规密码
- **THEN** 创建身份并返回 token 与该身份信息

#### Scenario: 昵称重复

- **WHEN** 提交已存在的昵称（大小写不同也算重复）
- **THEN** 返回 409 与「昵称已被占用」，不创建身份

#### Scenario: 密码过短

- **WHEN** 提交少于 8 个字符的密码
- **THEN** 返回 4xx 与明确提示，不创建身份

#### Scenario: 昵称长度越界

- **WHEN** 提交 1 个字符或超过 16 个字符的昵称
- **THEN** 返回 4xx 与长度要求提示

### Requirement: 登录

系统 SHALL 允许用「昵称 + 密码」在多端登录并签发独立凭证；密码 MUST 以可抵抗离线爆破的哈希存储，MUST NOT 以明文或可逆形式落库；登录失败 MUST 返回统一错误，MUST NOT 区分「昵称不存在」与「密码错误」。

#### Scenario: 登录成功

- **WHEN** 在第二台设备上提交正确的昵称与密码
- **THEN** 返回新 token，两台设备的记录合并为同一身份的记录

#### Scenario: 密码错误

- **WHEN** 提交正确昵称与错误密码
- **THEN** 返回 401 与统一提示「昵称或密码不正确」

#### Scenario: 昵称不存在

- **WHEN** 提交不存在的昵称
- **THEN** 返回与密码错误完全相同的状态码与提示

### Requirement: 匿名身份升级

系统 SHALL 允许已在使用匿名身份的用户在原地设置昵称与密码，升级为可登录账号；升级 MUST 保留该身份下的全部训练记录与上榜状态，MUST NOT 产生数据搬迁或记录重建。

#### Scenario: 升级后历史仍在

- **WHEN** 匿名身份有 37 条记录，用户为其设置密码
- **THEN** 升级后登录查询仍返回这 37 条记录，无需重新上报

#### Scenario: 升级时昵称冲突

- **WHEN** 设定的昵称已被其他身份占用
- **THEN** 返回 409，身份保持匿名状态不变

### Requirement: 昵称不可修改

已注册身份的昵称 MUST NOT 可修改；系统 MUST NOT 提供改名接口；未注册身份在首次设定昵称后同样不可修改。

#### Scenario: 尝试改名

- **WHEN** 已登录用户请求修改昵称
- **THEN** 系统返回 4xx，昵称保持不变

#### Scenario: 界面无改名入口

- **WHEN** 已登录用户打开账号设置
- **THEN** 界面不提供昵称编辑控件

### Requirement: 凭证与退出

系统 SHALL 通过 `Authorization: Bearer <token>` 识别身份；凭证 MUST 以哈希形式存储于服务端，MUST NOT 出现在日志中；退出登录 MUST 使当前凭证失效，MUST NOT 影响其他设备已签发的凭证。

#### Scenario: 无凭证访问受限接口

- **WHEN** 未携带 token 请求「我的记录」
- **THEN** 返回 401

#### Scenario: 退出登录

- **WHEN** 用户在设备 A 退出登录
- **THEN** 设备 A 的 token 失效，设备 B 仍可用原 token 访问

#### Scenario: 凭证不落日志

- **WHEN** 任意请求携带 token
- **THEN** 服务端访问日志中不包含该 token 的任何片段

### Requirement: 账号删除

系统 SHALL 提供删除账号能力，删除 MUST 级联清除该身份的凭证、训练记录与上榜数据，且 MUST 二次确认并在确认文案中写明不可恢复。

#### Scenario: 删除账号

- **WHEN** 已登录用户确认删除账号
- **THEN** 该身份、其凭证与全部记录被删除，榜单不再出现该昵称

#### Scenario: 删除后昵称可再用

- **WHEN** 账号删除完成后
- **THEN** 相同昵称可被重新注册
