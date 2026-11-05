# 加载性能优化验证

日期：2026-11-03。范围：行情范围查询、项目初始化、图表模块和实例生命周期、生产资源传输及当前界面主要操作。方式：实施者自检，normal / regression / browser。

## 结果

**已获用户明确授权发布，并完成生产验收。** 实际入口为 `http://deploy.taile2c45c.ts.net:8083`。Vue 类型检查、58 个前端测试、Rust workspace 7 个常规测试、411 万根合成行情 release 基准、本地真实 Nginx/TLS 检查通过；生产真实数据性能对比、HTTP/cache 断言、11 组浏览器流程及持续四屏快放检查均通过。

生产使用 **4,117,327** 根真实分钟 K 线（Parquet 132,765,389 字节），覆盖 2019-01-01 至 2026-11-01。生产测量直接运行在该真实文件对应的已部署服务上，没有拿本地 10,080 根 fixture 或合成数据代替生产结果。最初的环境和授权阻塞已解除。

验收范围是当前软件可见的主要功能及本次加载契约；不把单一设备、网络和采样窗口的结果解释为所有设备均无等待。

## 前端构建

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| 项目库初始 JS | 336.09 kB | 110.76 kB，减少 67.0% |
| 初始 JS gzip（Vite 统计） | 112.09 kB | 41.09 kB，减少 63.3% |
| 进入复盘额外图表 JS | 已包含在入口 | 229.22 kB / gzip 74.10 kB |
| 项目库 snapshot 请求 | 1 | 0 |
| 行情追加 | 销毁重建图表 | 复用原 Canvas 和插件 |

完整复盘 JS 总量 339.98 kB / gzip 115.19 kB，有少量拆包和状态反馈开销。CSS 不变：31.87 kB / gzip 6.56 kB。收益主要是首屏少加载代码、取消未使用请求、避免重复创建图表。

## 后端运行证据

Rust 1.88 容器执行 `cargo test --locked --workspace`：回测服务 1 测试、行情服务 6 测试通过，手工基准默认忽略；随后单独运行 release 基准通过。只有回测模型现有 dead_code 警告。

新增原算法对照覆盖 `[from,to)`、缺省和空范围、缺失分钟、limit、日/周/月边界和部分桶，比较完整 candles 和 stochastic JSON，不仅比较条数。另有截止时间和非法范围检查。

4,117,327 根确定性**合成行情**，同一进程每组 20 次查询，先验证完整结果相等，再计时：

| 查询 | 原扫描总耗时 | 二分切片总耗时 |
| --- | --- | --- |
| 1m，531 根窄窗口 | 149.679 ms | 0.367 ms |
| 1h，1 根形成中 K 线 | 132.892 ms | 0.0158 ms |
| 1M，全历史范围 | 3,621.308 ms | 1,455.422 ms |

这是算法比较，不含 HTTP/序列化/网络，也不是生产真实文件的测量。大周期仍要聚合实际命中区间，没有承诺所有请求同等提速。

线上优化前公开接口单次采样：1m 窗口 HTTP 200 / TTFB 0.832 s / 115,631 字节；全历史 1M HTTP 200 / TTFB 1.144 s / 18,771 字节。这些包含当前网络成本，不是分位数，不能直接与容器内计时相除。

## 生产真实数据性能与完整体验

发布前后在同一台生产服务器、相同查询、实际 `127.0.0.1:8083` 代理入口各采样 10 次。以下为 HTTP TTFB，包含本机 Nginx/API/序列化，不含用户到服务器的网络链路：

| 查询 | 发布前中位数 | 发布后中位数 | 发布后 P90 |
| --- | --- | --- | --- |
| 1m，531 根窗口 | 12.938 ms | 2.039 ms | 2.508 ms |
| 1h，单根形成中 K 线 | 11.620 ms | 1.368 ms | 1.534 ms |
| 1M，全历史 | 536.167 ms | 301.044 ms | 325.917 ms |

发布前后的真实 1m 和全历史 1M 响应，完整 candles 与 stochastic JSON 深度比较一致。性能原始数据：[发布前](evidence/production-before.csv)、[发布后](evidence/production-after.csv)、[汇总](evidence/production-performance.json)。

实际生产入口运行 HTTP 契约脚本通过：JS gzip 40,739 字节、immutable/Vary、安全头、HTML 条件请求 304、SPA 回退、assets 404、真实行情边界及 JSON 错误契约均正确。

生产浏览器完整执行本地验证的 10 组流程，另增加无请求拦截上下文的第二次访问缓存断言：入口和图表 JS 的 `transferSize` 均为 0，实际命中缓存。11 组全部通过，pageerror 为空。见 [生产 HTTP 结果](evidence/production-http-results.json)、[生产浏览器结果](evidence/production-browser-results.json)、[生产四屏截图](evidence/production-four-panes.png)。

持续四屏 8x 快放：约 14.63 秒推进 120 根 1m K 线，跨越自动分页；所有原 Canvas 节点保留，无错误提示或 pageerror，未记录超过 50ms 的主线程长任务。最多同时 16 个行情请求，未出现持续增长的请求积压。本次客户端网络条件下，快照请求中位 420ms / P90 578ms，说明用户网络仍是端到端耗时的一部分，不能把服务端 1–2ms 说成用户完整请求 1–2ms。见 [持续播放结果](evidence/production-playback-results.json)。

缓存排查中确认：本地自签名 HTTPS 的 Chromium 不复用脚本，不能据此判定生产缓存失效；在生产实际 HTTP 入口及独立无 route 上下文中已实证缓存命中。本地自签名缓存项明确 N/A，其余本地流程通过。

## 真实代理 HTTP/TLS 检查

`node scripts/loading-http-check.mjs` 在 `https://localhost:8448` 执行通过，使用修改后的 Nginx 配置、生产构建及真实 Rust 服务。

- JS 返回 gzip，解压后逐字节等于原响应；本次 110,765 字节压缩至 40,739 字节。
- 带哈希资源返回一年 `immutable` 缓存及 `Vary: Accept-Encoding`。
- HTML 返回 `no-cache`，ETag 条件请求实际返回 304。
- `/replay` 返回相同入口 HTML；不存在的 assets 返回 404，不附长期缓存。
- HTML、JS 和 404 仍保留适用安全响应头；资源 location 未覆盖安全头。
- 通过 Nginx 访问真实 Parquet meta 和 snapshot；from 包含、to 排除，指标默认字段保留。
- 非法时间范围返回 400、JSON `code=invalid_request` 及准确错误消息；API 未附加静态长期缓存。
- `nginx -t` 与 `docker compose config --quiet` 均通过。

详见 [HTTP 断言结果](evidence/loading-http-results.json)。

## 完整浏览器检查

`node scripts/loading-browser-check.mjs` 使用独立 headless Chromium，入口为真实本地 HTTPS/Nginx、真实 Rust API、真实本地 Parquet 与生产 Vue 构建，无 mock 行情。10 组流程通过，pageerror 为空：

1. 项目库首次打开：零行情快照和图表 chunk 请求。
2. 创建并打开项目：一次主屏快照，Canvas 可用。
3. 绘制趋势线后追加窗口：图形持久化，原 Canvas 保留。
4. Buy → Sell（平多）→ Sell（开空）→ Buy（平空）：用户可见仓位切换正确，记录保留。
5. 11 种支持周期逐一切换：接口返回有效行情，图表可用。
6. 四屏、8x 播放、暂停：游标推进，各屏可用，无错误提示。
7. 指标六组参数修改、隐藏/显示、绘图锁定/解锁及进入/退出全屏。
8. 刷新：项目身份、游标时间、交易语义、绘图和四屏恢复。
9. 返回项目库、保存项目名称并重新打开。
10. 注入一次真实请求失败：界面显示可操作错误，重试后图表恢复。

测试过程发现并修正的是测试契约问题：最初趋势线 selector 大小写错误；恢复行情窗口后，交易 candleIndex 应按窗口重新锚定，不能断言其绝对不变。修正后比较交易时间、价格、数量、动作、盈亏等持久语义，未删除保护性断言，也未把盲目重试作为通过条件。

[浏览器流程结果](evidence/loading-browser-results.json) · [四屏实际截图](evidence/loading-four-panes.png)

早期另有合成数据生产预览，约 33 秒四屏 8x 播放无控制台错误；这些观察作为补充，正式完整流程以上述真实本地链路为准。浏览器单次交互耗时包含自动化/调度，不当作通用性能 SLA。

## 验收与质量门

| 验收项 / Dimension | Result | Evidence / N/A reason |
| --- | --- | --- |
| 本地 acceptance coverage | pass | 前端/Rust/HTTP/浏览器分别覆盖修改契约 |
| 生产 acceptance coverage | pass | 用户授权后已发布；真实 411 万根数据对比、11 组生产浏览器流程及持续四屏播放通过 |
| Happy path / contract | pass | 58 个前端测试、7 个 Rust 测试、10 组浏览器流程 |
| Boundary | pass | 原扫描对照；周/月/部分桶；未来行情裁剪、生命周期、空数据 |
| Negative / recovery | pass | 真实 JSON 错误契约；浏览器断网一次后重试；元数据/加载失败组件测试 |
| AuthN / AuthZ | N/A | 无身份或权限变更 |
| State / invariant | pass | 请求竞态和去重、游标恢复、交易和绘图持久化、图表复用 |
| Integration / contract | pass | 本地及生产 Vue → Nginx → Rust → Parquet；真实响应完整等价，原 API 指标兼容 |
| Real entrypoint / config | pass | 本地 TLS 和生产实际 HTTP 入口均验证；生产 gzip、浏览器缓存命中、304、SPA 和安全头通过 |
| Regression | pass | 前端全套和 Rust workspace 执行通过 |
| Property / fuzz | pass（对照性质） | 排序行情的范围/周期/limit 组合与原算法完整结果相等；无额外随机 fuzz |
| Mutation / strength | N/A | 无广泛变异；直接断言返回数据、截止边界、禁止请求、生命周期和错误恢复 |
| Browser / E2E | pass | 本地真实栈与生产实际入口；11 组生产流程、真实完整数据及持续快放 |
| Isolation / flake | pass | 独立浏览器上下文、稳定事件等待；每个失败有确定原因，未掩盖失败 |

## 发布记录与回滚

- 发布前核对线上源码，确认已有播放位置修复由实例复用和范围平移继续保留；上线前再次校验源码哈希及运行镜像，防止覆盖并发更新。
- 在 `/opt/btcusd-tester-releases/loading-20261103` 独立构建，随后仅重建 web 和 market-data；保留 `.env`、数据、证书、Compose override 和端口，未重建 PostgreSQL/回测服务。
- 实际 HTTP override 已同步 gzip/cache/assets 规则，源文件为 `deployment/nginx/default.http.conf`，可用 `scripts/generate-http-nginx.mjs` 从标准配置再生成。
- 生产源码备份：`/opt/btcusd-tester-backups/loading-20261103/source-before.tar.gz`；旧镜像固定为 `btcusd-tester-web:before-loading-20261103` 和 `btcusd-tester-market-data:before-loading-20261103`。发布脚本对切换失败配置了自动恢复，本次未触发回滚。
- 新 web 镜像：`sha256:9820cc7c480f5301f94eb41dacfc008216d4710126cf78aa5c26b830ff312258`；新行情镜像：`sha256:240302b98538223c5a41b1bc6041de85648ce1aac7758527abffb05e96c3a11b`。
- 最终健康检查通过。空闲采样：web 约 4.3 MiB，行情服务约 192.9 MiB，均正常；这不是负载峰值。
- 未创建 Git 提交或 PR。生产应用源码与本地本次发布版本哈希一致。

需要回滚时，将两份 `before-loading-20261103` 镜像重新标记为对应 `latest`，从上述备份恢复源码和 HTTP 配置，然后在 `/opt/btcusd-tester` 执行 `docker compose up -d --no-deps market-data web`，重新检查健康和入口。不要覆盖数据库、行情数据或环境文件。

## 重现

前端：`npm --prefix frontend run typecheck`、`npm --prefix frontend test`、`npm --prefix frontend run build`。

Rust：`cargo test --locked --workspace`；手工基准：`cargo test --locked -p market-data-service --release benchmark_indexed_snapshot -- --ignored --nocapture`。

真实本地 HTTP：`node scripts/loading-http-check.mjs`。浏览器：安装 `.verification/browser-tools` 中的 Playwright 与 Chromium，然后 `node scripts/loading-browser-check.mjs`。`.verification` 已从 Git 和 Docker 上下文排除，避免工具依赖拖慢构建。

本地服务启动项位于 `.claude/launch.json` 的 `local-market-verification` 和 `local-nginx-verification`。测试使用自签名证书，忽略证书校验仅限脚本明确限制的 localhost 验证。
