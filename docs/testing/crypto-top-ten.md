# 十币复盘与历史数据验证记录

## 范围与结果

模式：normal；级别：regression；执行：主线程自验证，无独立验证。

用户选择按市值排序的可交易主流币，排除稳定币、质押/锚定衍生币及缺少公开交易 K 线的资产。市值查询来源：https://www.coingecko.com/ ，页面未提供排名采集时间；名单是实施查询时的静态快照，不自动跟随实时排名。

名单：BTC、ETH、BNB、XRP、SOL、TRX、ZEC、HYPE、DOGE、XMR。行情统一使用 Kraken 真实 USD 现货，不将 USDT 当作 USD。

## 数据结果

归档来源为 Kraken 官方 OHLCVT 全量归档，最近数据由公开历史成交分页聚合成 1 分钟 K 线。起止时间为 UTC，起点是该币在 Kraken 的首笔交易，不是代币创世时间。

| 品种 | 起始 | 数据截止（UTC） | K 线数 | 无成交分钟 |
| --- | --- | --- | ---: | ---: |
| BTCUSD | 2013-10-06 | 2026-11-06 04:33 | 5,081,271 | 1,799,469 |
| ETHUSD | 2015-08-07 | 2026-11-06 04:34 | 4,573,675 | 1,342,717 |
| BNBUSD | 2025-04-22 | 2026-11-06 04:34 | 441,115 | 369,039 |
| XRPUSD | 2017-05-18 | 2026-11-06 04:34 | 3,399,465 | 1,580,824 |
| SOLUSD | 2021-06-17 | 2026-11-06 04:34 | 2,413,054 | 420,209 |
| TRXUSD | 2020-03-05 | 2026-11-06 04:33 | 1,609,828 | 1,898,833 |
| ZECUSD | 2016-10-29 | 2026-11-06 04:34 | 1,348,296 | 3,922,368 |
| HYPEUSD | 2026-01-28 | 2026-11-06 04:34 | 314,846 | 90,600 |
| DOGEUSD | 2019-12-19 | 2026-11-06 04:34 | 2,220,020 | 1,399,315 |
| XMRUSD | 2017-01-02 | 2026-11-06 04:34 | 2,091,357 | 3,084,564 |

十币在补跑后做了最后一次增量对齐，截止时间相差不超过 1 分钟；最新值以各 `*_1m.manifest.json` 的 `verified_through_exclusive` 为准。Kraken 不输出无成交分钟，项目不合成空 K 线；`missing_minutes` 是统计值，不代表同步漏数据。

## 已执行证据

- 十币独立读回校验：`python -I scripts/verify_crypto_history.py --directory data/market`，全部 `pass`。校验内容：Parquet 列类型、分钟对齐、时间严格递增、OHLC 关系、文件行数与 manifest 一致、首尾时间一致、SHA-256 一致。
- 同步脚本单元测试：`python -I scripts/test_sync_crypto_history.py -v`，9 项通过。覆盖成交 ID 去重、游标原子提交、请求边界不越界、缺 ID/归档前成交拒绝、无新成交时正常收尾、无效 K 线拒绝、发布防回退。
- 前端：`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 通过；4 个相关测试文件、69 项通过。
- `data/market` 下十币 Parquet 合计约 700 MB，含 `.previous-*` 备份约 1.3 GB。

## Test Quality Gate

| Dimension | Result | Evidence / N/A reason |
| --- | --- | --- |
| Acceptance coverage | pass | 十币文件存在、可读回、到当前分钟且通过校验 |
| Happy path/contract | pass | 全量读回逐行校验 OHLCV 与时间顺序 |
| Boundary | pass | 分钟对齐、首尾时间、请求目标边界、别名与 USD/USDT 区分 |
| Negative/failure | pass | 无效 K 线、缺成交 ID、归档前成交、卡住分页、历史缩短均拒绝 |
| AuthN/AuthZ | N/A | 使用 Kraken 公开只读接口，无账户或权限变更 |
| State transition/invariant | pass | 游标与成交 ID 原子提交；重复运行幂等；发布前拒绝范围退化 |
| Integration/contract | pass | ZIP 远程 Range 读取、SQLite 检查点、Parquet 发布与独立校验器 |
| Real entrypoint/config | pass | 本地 Compose 启动 market-data；十币 `/api/market/meta` 返回与 manifest 一致，ETH 别名快照返回真实 K 线，BTCUSDT 与未知币种返回 400 |
| Regression | pass | 前端 69 项测试通过；同步脚本 8 项测试通过 |
| Property/fuzz | N/A | 固定十币目录、确定性归档解析与分页校验 |
| Mutation/test-strength | N/A | 未修改成交计算；关键测试断言具体数值、边界与拒绝行为 |
| Browser/E2E | blocked | 预览服务名额被同目录其他会话占满，未取得浏览器证据 |
| Isolation/flake | pass | 单进程锁、断点续跑；一次网络重置后从游标恢复成功 |

## 注意事项

1. 新增数据是 Kraken 单一来源的 USD 现货；与 Coinbase 等其他交易所的分钟 K 线不会完全一致。
2. 各币完整范围以 Kraken 上市时间为起点；例如 BNB 从 2025-04-22、HYPE 从 2026-01-28 开始。
3. 行情服务已在本地 Compose 中启动并加载十币；十币 `/api/market/meta` 与 manifest 的 K 线数、首尾时间一致，ETH 快照返回真实 K 线。
4. 未提交、推送或部署。
