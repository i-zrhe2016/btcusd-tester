# 实时行情尾窗

## 目的

完整历史行情由 Parquet 归档维护，适合复盘很久以前的区间；但每次发布都要重写数十到数百 MB 的文件，无法每分钟执行。实时尾窗只维护最近若干天的 1 分钟 K 线，让复盘页可以跟到最新的**已收盘**分钟。

- 数据源：Kraken 公开 `OHLC` 接口，`interval=1`，与完整历史使用相同的 USD 现货交易对。
- 每轮抓取最近 720 分钟，与本地尾窗合并；存在重叠时以最新抓取为准。
- **不发布正在形成的分钟**：复盘模型把每根 K 线都视为已收盘。
- 不合成无成交分钟；缺口原样保留。
- 尾窗默认保留 3 天（`--retain-minutes 4320`），文件约 200–400 KB/币。

## 运行

脚本只依赖 Python 标准库，必须以 `-I` 运行：

```bash
python -I scripts/sync_live_market.py
```

常用参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--output` | `data/market/live` | 尾窗 JSON 目录 |
| `--symbols` | 全部十币 | 逗号分隔的规范 USD 代码 |
| `--interval` | `60` | 循环间隔（秒），最小 10 |
| `--retain-minutes` | `4320` | 每币保留的最近 K 线根数 |
| `--pause` | `1.1` | 两次 Kraken 请求之间的间隔（秒） |
| `--once` | 关 | 只跑一轮，适合 cron/一次性检查 |

单币或单轮冒烟：

```bash
python -I scripts/sync_live_market.py --symbols BTCUSD --once
```

Docker Compose 中的 `live-sync` 服务默认每 60 秒运行一轮，向 `./data/market/live` 写入：

```text
btcusd_1m.live.json
ethusd_1m.live.json
...
```

每轮日志为单行 JSON：`live_published`、`live_unchanged`、`live_failed`、`live_cycle`。任一币失败不会终止循环，下一轮自动重试；`--once` 模式下存在失败时以非零状态退出。

## 文件格式

```json
{
  "symbol": "BTCUSD",
  "source": "Kraken OHLC",
  "interval": 60,
  "updated_at": "2026-11-06T15:10:09+00:00",
  "first_timestamp": 1793934600,
  "last_timestamp": 1793977740,
  "candle_count": 720,
  "candles": [[1793977740, 75119.3, 75211.4, 75101.3, 75211.4, 3.1154]]
}
```

- 文件通过临时文件 + 原子替换发布，读取方不会看到半个文件。
- `candles` 为 `[timestamp, open, high, low, close, volume]`，时间严格递增且按分钟对齐。
- `last_timestamp` 是最后一根已收盘 K 线的开盘时间；`verified_through_exclusive` 语义由 `last_timestamp + 60` 表达。

## market-data 合并与热加载

`market-data` 默认读取 `MARKET_DATA_LIVE_DIR`（未设置时取 Parquet 同级的 `live/`）。启动后每 `MARKET_DATA_RELOAD_SECONDS`（默认 5 秒）检查 Parquet 与尾窗文件的长度/修改时间：

1. 完整历史按 timestamp 与尾窗做有序归并。
2. 相同 timestamp 以尾窗为准（Kraken 可能修订刚收盘的分钟）。
3. 尾窗缺失但 Parquet 存在的分钟保留；尾窗之后更新的 Parquet 数据也保留。
4. 校验通过后一次性替换内存数据集，请求继续读取旧版本直到替换完成。

因此：

- 尾窗每分钟更新后，`/api/market/meta` 的 `last_timestamp` 会自动前进，**无需重启** `market-data`。
- 重新发布完整 Parquet 也会自动热加载，同样无需重启。
- 尾窗文件损坏或标签不匹配时记录 `ignoring invalid live market window`，继续使用完整历史，不影响既有复盘。

## 与完整同步的边界

- Kraken `OHLC` 单次最多返回 720 分钟。若进程停机超过 12 小时，尾窗只能从头补齐最近 12 小时；更早的空隙需要运行 `scripts/sync_crypto_history.py` 修复完整历史。
- 完整同步仍建议定期执行（例如每周），用成交数据修订历史并扩展 Parquet。尾窗不会替代完整归档。
- 实时尾窗是数据新鲜度机制，不改变复盘的训练语义：页面只在游标推进时显示 K 线，最新一根也必须是已收盘分钟。
