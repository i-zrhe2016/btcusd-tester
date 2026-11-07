# GitHub CI/CD

`.github/workflows/ci-cd.yml` 在 PR 和 `main` push 时运行。一个 `changes` job 用路径过滤决定哪些检查与镜像需要运行；成功的 `main` 运行只部署受影响的服务。

## Job 结构

| Job | 何时运行 | 内容 |
| --- | --- | --- |
| `changes` | 总是 | `dorny/paths-filter` 计算 `web`/`payments`/`market_data`/`backtest`/`rust_shared`/`deploy` 六个标志 |
| `test-web` | `web` 变化 | Node 24：`npm ci`、`npm test`、`npm run build`（含 `vue-tsc`） |
| `test-payments` | `payments` 变化 | Node 22：`npm ci`、`npm test` |
| `lint-rust` | 任一 Rust 服务或 `rust_shared` 变化 | 固定 Rust 1.88：`cargo fmt --check`、`cargo clippy --workspace -D warnings` |
| `test-market-data` | `market_data` 或 `rust_shared` 变化 | `cargo test -p market-data-service --locked` |
| `test-backtest` | `backtest` 或 `rust_shared` 变化 | `cargo test -p backtest-service --locked` |
| `deploy-checks` | `deploy` 变化 | Compose 校验、部署回归测试、Python 同步脚本测试 |
| `build-web` / `build-payments` / `build-market-data` / `build-backtest` | 对应服务变化，且为 PR 或手动运行 | buildx 构建该服务镜像（`push: false`），独立 GHA 层缓存；提前暴露 Dockerfile 错误 |
| `connection-test` | 手动 `mode=connection-test` | 加入 tailnet，检查 SSH、容器与生产健康 |
| `deploy` | `main` push 且运行产物变化，或手动 `mode=deploy` | 上传 `git archive`，在主机上增量构建并部署 |

## 变更标志

| 标志 | 路径 | 影响 |
| --- | --- | --- |
| `web` | `frontend/**`、`deployment/nginx/**` | `test-web`、`build-web`、部署 `web` |
| `payments` | `services/payments/**` | `test-payments`、`build-payments`、部署 `payments` |
| `market_data` | `services/market-data/**` | `lint-rust`、`test-market-data`、`build-market-data`、部署 `market-data` |
| `backtest` | `services/backtest/**` | `lint-rust`、`test-backtest`、`build-backtest`、部署 `backtest` |
| `rust_shared` | `Cargo.toml`、`Cargo.lock`、`services/crypto_symbols.rs` | 两个 Rust 服务全部测试、构建与部署 |
| `deploy` | 上述路径加 `scripts/**`、`docker-compose*.yml`、`.dockerignore` | 是否执行部署；`docker-compose*.yml` / `.dockerignore` 不触发镜像构建 |

PR 上只运行受影响的检查与构建，不推送镜像、不部署。`main` 上不重复构建镜像，仍由生产机按变更服务增量 `docker compose build`。

PR 使用 concurrency 自动取消旧 run；所有 job 都有 `timeout-minutes`。本地文档、截图等不影响运行产物的 push 仍会产生绿色 run，但不会部署。

## 手动运行

`workflow_dispatch` 的 `mode` 输入：

- `checks`（默认）：只运行检查，不部署。
- `deploy`：选择 `main` 分支时执行完整部署；服务列表按全部服务处理。
- `connection-test`：验证 Tailscale、SSH 与生产健康，不改动生产。

## 所需配置

创建 Tailscale OAuth client，权限为创建带 `tag:ci` 的临时设备。把 client ID/secret 保存为仓库或 `production` environment 的 GitHub Actions secrets：`TS_OAUTH_CLIENT_ID`、`TS_OAUTH_SECRET`。不要提交这些值。

在 tailnet 策略中：授权 OAuth client 拥有该 tag，允许 `tag:ci` 访问部署主机，并为 `tag:ci` 到主机的 `root` SSH 添加 accept 规则。把目标限制到该主机而不是整个 tailnet。无人值守 runner 不适合交互式 SSH 审批。

可选 Actions variable `DEPLOY_HOST` 覆盖 `deploy.taile2c45c.ts.net`。主机需安装 Docker Compose（支持 `up --wait`）、curl、flock，并在 `/opt/btcusd-tester` 保留生产 `.env`、`docker-compose.override.yml`、证书和行情数据。当前 HTTP 健康端点是 8083 端口。

`production` environment 可配置 reviewer 审批。不要对不可信的 PR 代码执行部署。

## 增量部署

CI 只在 `main` 上计算受影响服务（`web`、`market-data`、`backtest`、`payments`），并通过 `BUILD_SERVICES` 传给 `deployment/deploy-ci.sh`。主机的 `deployment/deploy-release.sh`：

1. 取独占锁，校验服务名白名单；
2. 备份 PostgreSQL、源码（含 `scripts/`）到 `/opt/btcusd-tester-backups/<sha>`；
3. 记录四个服务当前镜像引用，并打 `btcusd-rollback-<service>:<sha>` 标签；
4. 只构建传入的服务，未变服务继续使用现有镜像；镜像缺失时自动全量构建；
5. `docker compose up -d --no-build --wait` 后检查 Nginx 健康、行情元数据与 payments 健康；
6. 写入 `.deployed-revision`，保留最近 5 次回滚镜像和备份，清理 dangling 镜像。

构建缓存由 Dockerfile 的 BuildKit cache mount 提供：两个 Rust 镜像共享 `rust-target` 缓存，前端复用 npm 缓存。PR 的四个 `build-*` job 各自使用独立的 GHA 缓存，因此合并前即可发现构建问题，而 `main` 上不会与主机重复构建。

## 发布与恢复

Runner 归档精确的提交，通过 Tailscale SSH 上传，并执行 `deployment/deploy-ci.sh`。脚本用 `systemd-run` 启动远端任务并轮询结果，SSH 断线会重连；远端任务以 `GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT` 命名，重试是幂等的。只有远端报告成功且 `.deployed-revision` 等于本次提交时才判定部署成功。

源码解压后任一步失败，脚本会恢复上一版源码和四个服务的镜像并重新启动。数据库备份保留用于人工恢复；脚本不会自动恢复数据库，涉及不兼容迁移时需要显式迁移与恢复方案。部署产物和备份的保留策略自动维持最近 5 次。

## 验证状态

工作流需要 Tailscale secrets 与策略才能完成端到端部署。本地语法检查不能证明 GitHub runner 连通性或 Rust CI 结果；合并前以 PR 上的实际运行结果为准。
