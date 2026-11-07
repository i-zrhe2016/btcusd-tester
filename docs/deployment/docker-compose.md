# Docker Compose 与 HTTPS

部署图：[PlantUML 源码](../diagrams/deployment.puml) · [SVG](../diagrams/deployment.svg)

![单机部署](../diagrams/deployment.svg)

## 主机要求

- 64 位 Linux，Docker Engine 与 Compose 插件。
- 推荐至少 2 CPU、4 GiB 内存和 20 GiB 可用磁盘；完整十年 1 分钟数据需按实际文件增加容量。
- DNS A/AAAA 记录指向服务器，防火墙只开放 TCP `80` 与 `443`。
- 宿主机准备 Parquet、数据清单、环境变量文件和 TLS 证书。

## Compose 资源

- `web` 构建 Vue 静态文件并运行 Nginx，默认映射 `80:80` 和 `443:443`。
- `market-data` 只读挂载 `./data/market:/data:ro`，并自动热加载 Parquet 与 `live/` 尾窗的变化。
- `live-sync` 以 `python:3.12-slim` 运行 `scripts/sync_live_market.py`，通过公网网络每 60 秒更新 `./data/market/live`，尾窗由 `market-data` 合并。
- `backtest` 通过 `DATABASE_URL` 和 `MARKET_DATA_URL` 访问内部依赖。
- `postgres` 使用命名 volume，固定主版本，启用健康检查。
- `web` 同时加入公网入口 bridge 和私有后端 bridge；其他容器只加入私有后端 bridge。
- 除 `web` 外不映射宿主机端口。

仓库根目录提供 `docker-compose.yml`，生产部署前先复制 `.env.example` 为 `.env` 并替换 `POSTGRES_PASSWORD`。`.env` 不提交 Git。

## 环境变量

| 名称 | 容器 | 默认/要求 |
| --- | --- | --- |
| `POSTGRES_DB` | postgres | `btcusd` |
| `POSTGRES_USER` | postgres/backtest | `btcusd` |
| `POSTGRES_PASSWORD` | postgres/backtest | 生产必须使用随机密钥，不提交 Git |
| `WEB_HTTP_PORT` | web | 默认 `80`，本机冲突时可改为其他宿主机端口 |
| `WEB_HTTPS_PORT` | web | 默认 `443`，本机冲突时可改为其他宿主机端口 |
| `WEB_CPUS` | web | 默认 `0.50`，限制 Nginx 与静态前端容器 CPU 配额 |
| `MARKET_DATA_CPUS` | market-data | 默认 `0.75`，限制行情服务 CPU 配额 |
| `BACKTEST_CPUS` | backtest | 默认 `1.00`，限制回测服务 CPU 配额 |
| `POSTGRES_CPUS` | postgres | 默认 `0.50`，限制 PostgreSQL CPU 配额 |
| `DATABASE_URL` | backtest | 由 Compose 从上述变量构造 |
| `MARKET_DATA_URL` | backtest | `http://market-data:8081` |
| `MARKET_DATA_PARQUET` | market-data | `/data/btcusd_1m.parquet` |
| `MARKET_DATA_LIVE_DIR` | market-data | 实时尾窗目录，默认 Parquet 同级的 `live/` |
| `MARKET_DATA_RELOAD_SECONDS` | market-data | 文件变化检查间隔，默认 `5` |
| `MARKET_LIVE_INTERVAL` | live-sync | 实时尾窗抓取间隔，默认 `60` 秒 |
| `MARKET_LIVE_RETAIN_MINUTES` | live-sync | 每币保留的最近分钟数，默认 `4320` |
| `LIVE_SYNC_CPUS` | live-sync | 默认 `0.25` |
| `RUST_LOG` | Rust 服务 | 默认 `info` |
`.env.example` 只能包含无敏感默认值；生产 `.env` 权限设为 `0600` 并排除版本控制。
CPU 配额由 Docker Compose 的 `cpus` 字段下发到容器，可按服务器规格在 `.env` 中调高或调低。

## HTTPS

- HTTP 入口只执行 `301` 重定向到同一主机 HTTPS。
- HTTPS 端口收到明文 HTTP 请求时，Nginx 使用 `497` 错误页规则重定向到同一 host 的 HTTPS 地址。
- 生产证书只读挂载为 `/etc/nginx/certs/fullchain.pem` 和 `privkey.pem`；Nginx 启动脚本会把它们链接到运行时目录 `/run/nginx-certs/`。
- 未挂载证书时，容器会生成 7 天有效的 localhost 自签名证书，仅用于本地 Compose 冒烟。
- Nginx 只启用 TLS 1.2/1.3，并设置 HSTS、`X-Content-Type-Options`、`Referrer-Policy` 和 CSP；CSP 只对样式放开 inline style，以兼容图表库动态尺寸和颜色。
- 本地开发可生成自签名证书；浏览器警告是预期行为，不能把自签名证书用于公网。
- 证书续期由宿主机 Certbot 或同等工具处理；续期后执行 `nginx -s reload`，无需重启后端。

## 配置校验

在没有行情文件和证书的机器上也可以先校验 Compose 语法：

```bash
docker compose config
```

有 `data/market/btcusd_1m.parquet` 后执行完整构建和启动：

```bash
docker compose up -d --build
```

公网入口检查：

```bash
curl -I http://localhost/
curl -k https://localhost/healthz
```

## 加载性能配置

`deployment/nginx/default.conf` 对文本资源（包括 JS、CSS、JSON）启用 gzip，并返回 `Vary: Accept-Encoding`。`/assets/` 下带内容哈希的构建资源使用一年 `immutable` 缓存；`index.html` 使用 `no-cache`，每次重新验证，确保新版本入口及时生效。缺失的 assets 返回 404，不回退到 HTML；普通前端路由继续使用 SPA 回退。行情 API 不启用代理响应缓存。

缓存头与现有安全头在同一 server 层设置，资源 location 不覆盖安全头。如果部署通过 Compose override 挂载另一份 HTTP/Nginx 配置，需要同步 map、压缩及资源 location 规则；只更新镜像内的默认配置不会改变被覆盖的文件。Tailnet 部署可使用 `deployment/nginx/default.http.conf`，通过 `node scripts/generate-http-nginx.mjs` 从标准配置生成，保留 HTTP 直达和 HTTPS 两种入口。发布前以 `nginx -T` 确认有效配置，并检查实际入口（包括非标准端口）的 JS `Content-Encoding`、`Vary`、`Cache-Control`、HTML 重新验证和缺失资源 404。API 与普通路由仍须保留原有安全响应头。

## 发布流程

1. PR 按改动路径只运行相关检查：前端、支付、Rust（含 `cargo fmt --check`、`cargo clippy -D warnings`、测试、Compose 校验、部署脚本与 Python 同步脚本测试）。PR 还会构建受影响的 Docker 镜像作为校验，但不推送镜像仓库。
2. 合并到 `main` 后，路径过滤决定是否部署；纯文档或其他不影响运行产物的改动会跳过部署。
3. CI 把受影响的服务列表传给主机；主机只重建这些服务，未变服务沿用现有镜像。列表为空时传 `--no-rebuild`，不构建任何镜像。
4. 主机备份 PostgreSQL 和源码，并把当前四个服务的镜像打上 `btcusd-rollback-<service>:<sha>` 标签。
5. 构建只使用 BuildKit 缓存挂载（Cargo registry/target、npm cache），跨次部署复用依赖编译结果；无需镜像仓库。
6. 启动后检查容器健康、Nginx `/healthz`、行情元数据与 payments 健康状态；失败自动恢复上一版源码和镜像。
7. 成功后写入 `.deployed-revision`，并只保留最近 5 次发布对应的回滚镜像与备份目录，同时清理 dangling 镜像。

冒烟基准（固定窗口 `2019-09-01T00:00Z`–`2019-09-02T00:00Z`，`1m`，Stoch `length=10/oversold=20/overbought=80`，初始资金 10,000，费率 0.0004）：处理 1,440 根 K 线、26 笔完成交易、最终权益 9,892.53；重复执行结果必须一致。

当前内网环境运行 `main@d6f3472`（Stoch 副图新增 50 中轴虚线），前端镜像 `btcusd-web:d6f3472`；该版本未改动服务端代码，`btcusd-market-data:5935791` 与 `btcusd-backtest:5935791` 继续沿用。回滚镜像为 `btcusd-web:6fa1751`，更早版本 `btcusd-web:5935791`、`btcusd-web:137ac43`、`btcusd-backtest:137ac43`、`btcusd-market-data:137ac43`、`btcusd-web:cd30e40`、`btcusd-backtest:cd30e40`、`btcusd-market-data:06a77bf` 仍保留。前端镜像不再需要任何 Clerk 构建参数。

数据库迁移失败、行情文件校验失败或冒烟结果不一致时停止发布并回滚镜像；不得跳过校验继续上线。
