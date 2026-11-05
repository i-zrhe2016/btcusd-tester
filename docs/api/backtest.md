# Backtest API

## 策略定义

M1 只提供 `stoch-cross-long`：

- 前一根 `K <= D`、当前 `K > D` 且 `K <= oversold` 时，以当前收盘价全仓买入。
- 前一根 `K >= D`、当前 `K < D` 且 `K >= overbought` 时，以当前收盘价全部卖出。
- 只做多，不加杠杆，不允许同时持有多个仓位。
- 买卖均按成交名义金额收取 `fee_rate`，不模拟滑点。
- 结束时未平仓仓位按最后收盘价计入最终权益，但不计为完整交易。

## POST `/api/backtests`

请求：

```json
{
  "name": "1h Stoch 30",
  "symbol": "BTCUSD",
  "timeframe": "1h",
  "from": 1514764800,
  "to": 1546300800,
  "initial_capital": 10000,
  "fee_rate": 0.001,
  "strategy": {
    "length": 30,
    "oversold": 20,
    "overbought": 80
  }
}
```

校验规则：名称 `1..120` 个字符；初始资金大于 0；手续费 `0..0.05`；长度 `2..5000`；`0 <= oversold < overbought <= 100`；时间范围有效且最多处理 5,000 根聚合 K 线。

成功返回完整回测记录：

```json
{
  "id": "1a1f09a7-143d-4c16-af0b-72e7f58f1a5e",
  "user_id": "00000000-0000-0000-0000-000000000001",
  "name": "1h Stoch 30",
  "status": "completed",
  "config": {},
  "result": {
    "initial_capital": 10000,
    "final_equity": 11240.53,
    "total_return_pct": 12.4053,
    "max_drawdown_pct": 8.31,
    "completed_trades": 12,
    "win_rate_pct": 58.33,
    "buy_and_hold_return_pct": 4.12,
    "candles_processed": 876,
    "trades": []
  },
  "error_message": null,
  "created_at": "2026-08-26T10:00:00Z",
  "completed_at": "2026-08-26T10:00:01Z"
}
```

`trades` 中每项包含 `timestamp, side, price, quantity, fee, realized_pnl`。买入的 `realized_pnl` 为 `null`。

## GET `/api/backtests?limit=20`

按 `created_at` 倒序返回当前访客用户的回测记录。`limit` 被限制在 `1..100`。M1 列表返回完整结果；数据量增长后可新增摘要 DTO，但不得无版本地删除现有字段。

## GET `/api/backtests/{id}`

返回当前用户的一条记录。UUID 格式错误返回 400；记录不存在或不属于当前用户时统一返回 404。

## GET `/api/configs`

按更新时间倒序返回当前用户保存的策略配置。

## POST `/api/configs`

```json
{
  "name": "保守参数",
  "parameters": {
    "length": 30,
    "oversold": 15,
    "overbought": 85
  }
}
```

名称和参数使用与回测请求相同的校验规则。M1 配置创建后不可原地覆盖；后续更新接口必须使用显式 `PUT /api/configs/{id}`。

## 复盘项目

以下接口都要求 Clerk Bearer JWT，并按认证得到的 `user_id` 隔离；不同用户可以持有相同的客户端项目 ID。

### GET `/api/projects`

按 `updated_at` 倒序返回当前用户的项目（最多 200 条），字段与前端 `ReplayProject` 对齐：

```json
[{
  "id": "3f0a…",
  "name": "BTCUSD 1h Replay",
  "symbol": "BTCUSD",
  "timeframe": "1h",
  "panes": ["1h", "15m"],
  "from": 1700000000,
  "to": 1700100000,
  "speed": 1,
  "cursorIndex": 42,
  "cursorTimestamp": 1700025200,
  "trades": [],
  "drawings": [],
  "indicators": {
    "1h": [
      { "name": "MACD", "params": { "fast": 12, "slow": 26, "signal": 9 } },
      { "name": "KDJ", "params": { "length": 9 } }
    ]
  },
  "createdAt": "2026-11-04T10:00:00Z",
  "updatedAt": "2026-11-04T10:05:00Z"
}]
```

### PUT `/api/projects/{id}`

以路径 ID 为准执行用户内的插入或更新（`ON CONFLICT (user_id, id)`），返回同结构记录；`created_at` 保留，`updated_at` 刷新为服务端时间。校验规则：ID 为 `1..128` 位字母、数字、`-`、`_`；名称 `1..120` 字符；仅 `BTCUSD`；周期属于复盘支持的 11 个周期；`panes` 为 `1..4` 个受支持周期；`from < to`；速度 `0.25..8`；游标时间必须落在项目范围内；交易最多 10,000 条、绘图最多 5,000 条；单个项目请求体上限 768 KB（Nginx 总上限 1 MB）。

`indicators` 是可选字段，缺省为 `{}`，按周期保存图表指标选择。服务端只做结构校验：必须是对象，键为受支持的 11 个周期；每个周期最多 8 项，每项只含 `name`（`1..64` 个可打印字符）与可选 `params`（对象，最多 32 个键，键为 `1..32` 位字母、数字或 `_`，值为有限数字、布尔或不超过 128 字符的字符串）；同一周期内名称不可重复。指标名**不做白名单**：指标目录由前端维护，图表层会丢弃当前客户端不认识的名称，因此新增前端指标无需发布后端。

### DELETE `/api/projects/{id}`

删除当前用户的项目并返回 `204`；不存在或属于其他用户时同样返回 `204`，避免泄露项目是否存在。

## 失败语义

- 写入初始记录后，状态立即为 `running`。
- 行情超时、无对齐数据或计算失败时更新为 `failed`，写入不含敏感信息的 `error_message`。
- 成功结果与 `completed_at` 在同一次数据库更新中写入。
- Nginx 对同步回测使用 60 秒上游超时；超时不等于服务端任务已取消，客户端应刷新记录状态。

