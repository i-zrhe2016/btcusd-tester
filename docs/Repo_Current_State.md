# Repository Current State

Last verified: 2026-09-08 @ working tree

## Current Focus

- CandleKit 绘图工具迁移、项目级绘图持久化和本机 Tailscale 部署验证。

## Implemented

- Vue/Vite 复盘工作台支持 K 线播放、手动交易和 CandleKit 提供的 TradingView 风格绘图工具。
- 左侧分组工具栏支持 16 个绘图工具、选择/拖动、锁定、删除、清除和 Shift 测量。
- 绘图以通用 `drawings` 模型与复盘项目一起保存在 `btcusd.replay.projects.v2`；v1 旧趋势线升级时清空但保留 v1 原始数据。
- 图表保持黑白 K 线、无成交量副图，CandleKit 私有存储关闭，应用项目状态是唯一来源。
- Nginx 作为公网入口，行情和回测服务运行在私有网络中。

## In Progress

- 暂无本次 CandleKit 迁移范围内的未完成项。

## Known Issues / Failing Checks

- 文档描述了登录保护，但认证开关关闭时运行时不会显示认证控件或执行 guard。
- Clerk 开发实例仍会在浏览器控制台提示开发密钥警告；这不影响本机 Tailscale 部署，但生产环境仍需明确认证配置。

## Constraints

- 浏览器通过同源 `/api/...` 访问服务；本地 Vite 优先连接 `127.0.0.1:8081/8082`，否则回退到 HTTPS 网关。
- 部署使用 Tailscale 内网地址；后端仍使用固定访客用户，未完成服务端 Clerk 身份校验。
- CandleKit 版本固定为 `@getcandlekit/charts@0.1.0`；绘图持久化由应用项目模型负责，不使用 CandleKit 私有 localStorage。

## Architecture Snapshot

- `frontend/` 提供 Vue/Vite 单页工作台；`MarketChart.vue` 以 CandleKit `ChartController`、`DrawingEngine`、`DrawingController` 和 `MeasurementController` 组合 Lightweight Charts；Rust `market-data` 和 `backtest` 服务提供行情与回测 API；Nginx 负责边缘入口。
- 详细边界见 `docs/architecture/service-boundaries.md`，前端行为见 `docs/frontend/web-app.md`。

## Next

- 明确认证上线时机，并在验证 Clerk 配置后启用 `authEnabled`；继续按 Tailscale 地址维护本机部署。
