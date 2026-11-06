# 十币 1 分钟历史同步

## 数据来源

- 交易对：Kraken 真实 USD 现货。BTC 的 Kraken 代码是 `XBTUSD`，DOGE 是 `XDGUSD`，其余与项目币种代码一致。
- 完整历史：Kraken 官方 OHLCVT 归档，每币 `{pair}_1.csv`，包含从该交易对首笔交易起的所有 1 分钟 K 线。归档当前覆盖到 **2026-09-30**（不含）。
- 最近数据：归档截止后的分钟由 Kraken 公开 `Trades` 历史成交接口分页取得，再聚合成 1 分钟 K 线。普通 `OHLC` 接口只提供最近 720 根，不能用来补齐完整历史。
- 时间均为 UTC Unix 秒，K 线按分钟开盘时间对齐。Kraken 对无成交分钟不输出 K 线；项目**不合成**空分钟，缺口数写入 manifest，避免把“无交易”伪装成连续行情。
- 不使用 USDT 行情充当 USD。

## 运行

依赖见 `requirements-history-sync.txt`。脚本必须用 `-I` 运行，且下载目录只能用于下载，不解压、不执行其中内容。

```bash
python -I -m venv .venv-market-sync
.venv-market-sync/Scripts/python.exe -I -m pip install -r requirements-history-sync.txt
```

先核对远程归档结构，不写入行情目录：

```bash
.venv-market-sync/Scripts/python.exe -I scripts/sync_crypto_history.py --index
```

同步十币（可重复运行；中断后从检查点继续）：

```bash
.venv-market-sync/Scripts/python.exe -I scripts/sync_crypto_history.py
```

只做单币或某一段：

```bash
.venv-market-sync/Scripts/python.exe -I scripts/sync_crypto_history.py --symbols BTCUSD
```

```bash
.venv-market-sync/Scripts/python.exe -I scripts/sync_crypto_history.py --symbols ETHUSD --archive-only
```

`--archive-only` 只发布归档截止日之前的数据，便于先快速获得完整历史；之后不带该参数重跑会继续补齐最近数据。

## 续跑与安全性

- 每币独立 SQLite 检查点位于 `data/history-sync/kraken-usd-v1/`，记录来源、交易对、粒度、归档版本、成交游标和已提交成交 ID。来源或粒度不一致会拒绝续跑。
- 下载采用 HTTP Range 和 ETag 校验，缓存按块保留；远程归档内容变化会拒绝混用旧缓存。
- 同一时刻只允许一个同步进程（锁文件 `sync.lock`）。异常退出后确认旧进程不在运行，再删除该锁。
- 归档行必须时间递增、一分钟对齐、OHLC 关系有效；成交必须带稳定 ID，并严格按 ID 去重、按时间递增接受，避免重试造成重复计数。
- 先写临时 Parquet，再读回核对行数与首尾时间，并计算 SHA-256。若新数据起始更晚、结束更早或行数更少，会拒绝发布，防止小样本覆盖已有完整历史。
- 归档阶段的可提前发布同样受此保护：如果现有文件比归档更新，脚本会推迟发布（日志 `archive_publish_deferred`），等最近成交补齐后再一次性发布，避免复盘范围暂时后退。
- 发布使用原子替换，旧文件保留为带唯一时间戳的 `.previous-*` 备份，不再覆盖上一份备份。

## 输出与 manifest

每个币输出到行情目录（默认 `data/market/`）：

```text
btcusd_1m.parquet
btcusd_1m.manifest.json
ethusd_1m.parquet
ethusd_1m.manifest.json
...
```

manifest 包含 `symbol`、`product_id`、`source`、`quote`、`first_timestamp`、`last_timestamp`、`candle_count`、`verified_through_exclusive`、`missing_minutes`、`gap_policy`、`sha256` 和 `synced_at`。`verified_through_exclusive` 表示该币数据已核对到该时刻之前，不能只比较文件大小来判断是否最新。

服务启动时按 `{symbol}_1m.parquet` 读取十币文件，缺失的币种会返回 503，不会回退到 BTC。行情服务会在文件发布后自动热加载，无需重启；首次部署或修改 `MARKET_DATA_LIVE_DIR` 等环境变量时仍需重启。

## 最新分钟

完整归档只适合周期性发布。要让复盘跟到最新已收盘分钟，同时运行 [实时尾窗](live-market.md)：

```bash
python -I scripts/sync_live_market.py
```

Docker Compose 已包含 `live-sync` 服务；尾窗文件写入 `data/market/live/`，由 `market-data` 自动合并。若尾窗停机超过 12 小时，Kraken 的 720 分钟窗口不足以补齐，需要重新运行本文的完整同步修复更早的历史。
