# Market Data API

## 通用约定

- 公网前缀：`/api/market`
- 内容类型：`application/json`
- 时间：Unix UTC 秒，范围为左闭右开 `[from, to)`。
- 支持品种：`BTCUSD, ETHUSD, BNBUSD, XRPUSD, SOLUSD, TRXUSD, ZECUSD, HYPEUSD, DOGEUSD, XMRUSD`，接受大小写不敏感的 `BTC-USD` 等带连字符别名。USD 与 USDT 不互为别名。
- 品种目录采用实施时查询的 [CoinGecko 市值排名](https://www.coingecko.com/)，按用户选择排除稳定币、质押/锚定衍生币及缺少公开交易 K 线的资产。它是静态快照，不代表实时自动调整排名。
- 各币种分别使用 `btcusd_1m.parquet`、`ethusd_1m.parquet` 等独立文件，位于 `MARKET_DATA_PARQUET` 指定 BTC 文件的同一目录。现有 Compose 已挂载整个目录，无需为每个文件增加挂载。
- BTC 文件仍为启动必需；缺失的其他币种不会回退到 BTC，而是返回 HTTP 503、`code: market_data_unavailable` 和包含待安装文件名的 `message`。安装真实 USD 历史文件后重启行情服务。切勿把 USDT 行情文件重命名为 USD。
- 支持周期：`1m, 5m, 15m, 30m, 1h, 2h, 3h, 4h, 1d, 1w, 1M`。
- 服务把 `MARKET_DATA_LIVE_DIR` 下的实时尾窗（见 [实时行情尾窗](../data/live-market.md)）叠加到完整 Parquet 历史之上：同 timestamp 以尾窗为准，尾窗缺失的完整历史分钟保留。文件变化会在 `MARKET_DATA_RELOAD_SECONDS`（默认 5 秒）内自动热加载，不需要重启服务。
- 复盘项目通过元数据的 `last_timestamp` 选择时间范围；页面不轮询、不自动跟随最新分钟。

错误格式：

```json
{
  "code": "invalid_request",
  "message": "invalid request: limit must be between 1 and 5000"
}
```

## GET `/api/market/meta`

返回指定币种的数据集信息，供页面初始化时间范围。可选查询参数 `symbol`，默认 `BTCUSD`；例如 `/api/market/meta?symbol=ETHUSD`。不同币种独立计算历史覆盖范围。

```json
{
  "symbol": "BTCUSD",
  "base_timeframe": "1m",
  "source": "Parquet",
  "candle_count": 1540000,
  "first_timestamp": 1451606400,
  "last_timestamp": 1546300740,
  "supported_timeframes": ["1m", "5m", "15m", "30m", "1h", "2h", "3h", "4h", "1d", "1w", "1M"]
}
```

## GET `/api/market/snapshot`

查询参数：

| 参数 | 必填 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `symbol` | 否 | `BTCUSD` | 上述十种 USD 品种之一；对应历史文件必须已安装 |
| `timeframe` | 否 | `1h` | 使用支持周期之一，大小写敏感 |
| `from` | 否 | 数据开始 | Unix 秒 |
| `to` | 否 | 数据结束后 | Unix 秒且大于 `from` |
| `limit` | 否 | `500` | `1..5000`；超出范围返回 400 |
| `lengths` | 否 | `30,120,840` | 三个 `2..5000` 的逗号分隔整数 |

响应中的 `candles` 与 `stochastic` 按 `timestamp` 一一对齐。指标预热区用 JSON `null`，不输出 `NaN`。

```json
{
  "symbol": "BTCUSD",
  "timeframe": "1h",
  "source": "Parquet",
  "candles": [
    {
      "timestamp": 1530403200,
      "open": 6385.1,
      "high": 6412.0,
      "low": 6350.0,
      "close": 6401.2,
      "volume": 312.45
    }
  ],
  "stochastic": [
    {
      "timestamp": 1530403200,
      "k": [22.41, null, null],
      "d": [19.87, null, null]
    }
  ]
}
```

如果聚合结果超过 `limit`，返回时间范围内最新的 `limit` 根。请求范围无数据时返回 200 和两个空数组，前端显示空状态。

## 前端按需加载

复盘页面不会把项目的完整时间范围一次发送给浏览器。前端将项目范围拆成最多 60 根 K 线的窗口：

1. 首次请求从项目开始时间起的第一个窗口，并把 `limit` 设为 `60`。
2. 当前窗口只剩 15 根未播放时，前端在后台请求下一个时间窗口；播放继续使用已加载数据。
3. 用户点击“加载更多 K 线”，或播放到当前窗口末尾时，前端也会请求下一个时间窗口；末尾请求进行中时等待，失败时暂停并显示手动重试。
4. 新窗口按 `timestamp` 去重、排序后追加，浏览器不会预先加载整个项目范围。

窗口请求仍使用本接口的 `from`、`to` 和 `limit` 参数；服务端不会为懒加载引入额外的公网接口。按需加载流程见[行情窗口加载时序图](../diagrams/market-data-lazy-loading.svg)。

## GET `/health`

内部健康探针。服务完成 Parquet 加载后才开始监听；正常响应为：

```json
{"status":"ok","service":"market-data"}
```

Nginx 不向公网代理此路径。
