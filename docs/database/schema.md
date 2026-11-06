# PostgreSQL Schema

实体关系图：[PlantUML 源码](../diagrams/data-model.puml) · [SVG](../diagrams/data-model.svg)

![数据模型](../diagrams/data-model.svg)

## `users`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键，默认 `gen_random_uuid()` |
| `email` | TEXT | 唯一、非空 |
| `display_name` | TEXT | 非空 |
| `created_at` | TIMESTAMPTZ | 非空，默认当前时间 |

M1 迁移写入固定本地访客。邮箱 `guest@local.invalid` 不用于登录或通信。

## `strategy_configs`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 外键到 `users`，级联删除 |
| `name` | TEXT | 非空 |
| `parameters` | JSONB | 非空、由 API 校验 |
| `created_at` | TIMESTAMPTZ | 非空 |
| `updated_at` | TIMESTAMPTZ | 非空 |

`parameters` 必须在应用层包含 `length, oversold, overbought`。结构增加 `schema_version` 时保留旧版本读取器。

## `backtests`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 外键到 `users`，级联删除 |
| `name` | TEXT | 非空 |
| `status` | TEXT | `running/completed/failed` |
| `config` | JSONB | 请求的不可变快照 |
| `result` | JSONB | 完成前可空 |
| `error_message` | TEXT | 失败原因，可空 |
| `created_at` | TIMESTAMPTZ | 非空 |
| `completed_at` | TIMESTAMPTZ | 运行中可空 |

索引 `(user_id, created_at DESC)` 支持历史列表。回测配置一经创建不修改，以保证结果可复现。

## `replay_projects`

复盘项目库按 Clerk 用户隔离（迁移 `0003_replay_projects.sql`，`0004_replay_indicators.sql` 增加指标选择）：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `user_id` | UUID | 外键到 `users`，级联删除；与 `id` 组成联合主键 |
| `id` | TEXT | 客户端生成的项目 ID，`1..128` 位字母、数字、`-`、`_` |
| `name` | TEXT | 非空，`1..120` 字符 |
| `symbol` | TEXT | 非空，当前只接受 `BTCUSD` |
| `timeframe` | TEXT | 非空，复盘支持的 11 个周期之一 |
| `panes` | JSONB | 非空，`1..4` 个受支持周期 |
| `range_from` / `range_to` | BIGINT | UTC 秒；`range_from < range_to` |
| `speed` | DOUBLE PRECISION | `0.25..8` |
| `cursor_index` | BIGINT | `>= 0` |
| `cursor_timestamp` | BIGINT | 可空；存在时必须落在 `[range_from, range_to]` |
| `trades` | JSONB | 非空数组，最多 10,000 条 |
| `drawings` | JSONB | 非空数组，最多 5,000 条 |
| `indicators` | JSONB | 非空对象，键为周期，每周期最多 8 项指标（迁移 `0004_replay_indicators.sql`，默认 `{}`） |
| `created_at` / `updated_at` | TIMESTAMPTZ | 非空；更新时只刷新 `updated_at` |

索引 `(user_id, updated_at DESC)` 支持项目库列表。所有读写都以认证中间件解析出的 `user_id` 过滤；联合主键允许不同用户的客户端 ID 相同而互不影响。单项目请求体上限为 1 MB（Nginx）并在应用层再次限制为 768 KB。

## `feedback_threads` / `feedback_messages`

反馈区数据（迁移 `0006_feedback.sql`）。线程对所有登录用户可见，只有作者可以追加消息；开发者回复以 `author = 'team'` 由运维写入。

| `feedback_threads` | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 外键到 `users`，级联删除 |
| `title` | TEXT | `1..120` 字符，单行 |
| `category` | TEXT | `bug/idea/other` |
| `status` | TEXT | `open/in_progress/resolved` |
| `created_at` / `updated_at` | TIMESTAMPTZ | 非空；追加消息刷新 `updated_at` |

| `feedback_messages` | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `thread_id` | UUID | 外键到 `feedback_threads`，级联删除 |
| `author` | TEXT | `user/team` |
| `body` | TEXT | `1..4000` 字符 |
| `created_at` | TIMESTAMPTZ | 非空 |

索引 `feedback_threads(updated_at DESC)` 支持列表，`feedback_messages(thread_id, created_at)` 支持对话读取。`author_code` 不落库，读取时取 Clerk subject 后 4 位。

## 所有权与迁移

- 只有回测服务运行 SQL 迁移并访问这些表。
- 迁移文件只向前追加，不修改已部署的迁移。
- 应用启动时执行迁移；失败则不开始监听端口。
- 数据库备份必须与应用镜像版本、Parquet 文件校验和一起记录。
- 复盘状态由回测服务的 `replay_projects` 表持有，写入受 Clerk 身份约束；浏览器 `localStorage` 只作为**按用户命名空间隔离**的缓存，不再是唯一来源。

