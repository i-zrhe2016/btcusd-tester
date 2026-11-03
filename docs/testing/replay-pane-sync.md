# 多周期跳转同步验证

2026-11-03。单代理自验证；RED-GREEN/browser；regression。本地通过，尚未提交或部署。

## 原因和修复

副屏旧窗口请求尚未完成时主屏跳转，syncReplayPanes 会跳过 loading 副屏；旧请求完成时没有重新检查窗口是否仍覆盖最新游标。跳转也没有统一作废副屏窗口与未完成 K 线请求。同步监听没有包含主屏加载完成状态。

主屏重载时清理副屏窗口/形成中 K 线并作废旧请求；监听主屏加载状态与项目区间。副屏窗口返回时检查当前锚点，过期窗口不发布，加载结束后追赶最新位置。未完成 K 线返回时检查当前共享时钟，回跳时清除较晚价格。同步失败显示错误和重试入口。

| 验收条件 | 风险 | 维度 | 已执行证据 | 结果 |
| --- | --- | --- | --- | --- |
| 副屏旧请求未完成时跳转仍能同步 | 中 | 竞态、回归 | App.test.ts deferred 旧副屏请求；修复前目标不在副屏窗口，测试失败；修复后通过 | pass |
| 播放跨出正在加载的窗口后追赶 | 中 | 状态、边界 | 小周期副屏延迟返回，主屏推进后断言最新目标存在于副屏及形成 K 线截止位置正确 | pass |
| 同一时间重新跳转会重新同步 | 中 | 生命周期 | App.test.ts 同一时间跳转，迟到部分行情不得覆盖新副屏 | pass |
| 回跳不展示较晚部分行情 | 中 | 数据可见性、竞态 | 旧/新部分行情分别延迟，旧 close=999 返回后副屏仍不发布该价格，新请求返回后时间戳和价格正确 | pass |
| 请求失败可见且可恢复 | 中 | 负向、恢复 | 副屏错误文字/加载结束/空窗口断言，重试后错误消失并形成当前 K 线 | pass |
| 大跨度与历史补齐不退化 | 中 | 回归 | 原有有界跳转、完整历史补齐及失败重试测试继续通过 | pass |
| 四屏不同周期同步 | 中 | 浏览器、HTTP | localhost:4175：1m/5m/1h/1m；回跳2027-02-03T12:17，各屏目标桶分别12:17/12:15/12:00/12:17，播放暂停后12:31/12:30/12:00/12:31；无alert及控制台错误，取得截图 | pass |

## Test Quality Gate

| Dimension | Result | Evidence / N/A reason |
| --- | --- | --- |
| Acceptance coverage / contract | pass | 上述矩阵 |
| Boundary | pass | 窗口外推进、同时间重载、同桶回跳 |
| Negative/failure | pass | 副屏请求失败后显示中文错误与重试，重试恢复 |
| State/invariant | pass | 共享时钟一致，旧响应不覆盖新位置，不显示回跳后的未来部分行情 |
| Integration/contract | pass | 组件请求→副屏props及保存进度；浏览器HTTP模拟行情 |
| Real entrypoint/config | pass | 产品首页工作台→四屏→跳转→播放暂停，本地生产构建，合成行情 |
| Regression | pass | npm --prefix frontend test：72项通过；新增复现用例先失败后通过 |
| Static | pass | npm --prefix frontend run build 与 npm --prefix frontend run typecheck |
| Browser | pass | 四屏交互、状态/网络读取、截图，控制台无错误 |
| Isolation/flake | pass | 独立deferred控制返回顺序，不依赖延迟睡眠；storage/mock每例重置 |
| AuthN | N/A | 无身份或会话变更 |
| AuthZ | N/A | 无权限或受保护操作变更 |
| Property/fuzz | N/A | 此次为请求生命周期竞态，确定性响应顺序覆盖风险 |
| Mutation | N/A | 明确RED复现证明旧实现违反新断言；未涉及高风险金融计算 |

未验证生产部署、真实Rust行情服务延迟和远端代理。截图及浏览器验证使用本地合成行情，不代表线上已修复。
