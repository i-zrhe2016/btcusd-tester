# Repository Current State

Last verified: 2026-09-08 @ working tree

## Current Focus

- 前端 Clerk 接入、复盘入口保护和本地 API 代理回退。

## Implemented

- Vue/Vite 复盘工作台支持 K 线播放、手动交易和 TradingView 风格趋势线绘制。
- 趋势线与复盘项目一起保存在浏览器 `localStorage`。
- Nginx 作为公网入口，行情和回测服务运行在私有网络中。

## In Progress

- Clerk 客户端接入和复盘访问 guard 已加入代码，但当前由 `App.vue` 的 `authEnabled = false` 关闭。

## Known Issues / Failing Checks

- 文档描述了登录保护，但认证开关关闭时运行时不会显示认证控件或执行 guard。

## Constraints

- 浏览器通过同源 `/api/...` 访问服务；本地 Vite 优先连接 `127.0.0.1:8081/8082`，否则回退到 HTTPS 网关。
- 部署使用 Tailscale 内网地址；后端仍使用固定访客用户，未完成服务端 Clerk 身份校验。

## Architecture Snapshot

- `frontend/` 提供 Vue/Vite 单页工作台；Rust `market-data` 和 `backtest` 服务提供行情与回测 API；Nginx 负责边缘入口。
- 详细边界见 `docs/architecture/service-boundaries.md`，前端行为见 `docs/frontend/web-app.md`。

## Next

- 明确认证上线时机，并在验证 Clerk 配置后启用 `authEnabled`。
