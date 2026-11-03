# 周期切换缓存验证

日期：2026-11-03。范围：frontend/src/api.ts 的行情快照缓存。模式：normal + browser；级别：regression；结果：PASS（本地范围）。主代理自行验证，未使用独立验证代理。当前会话不提供调整运行中推理 effort 的接口。

## 验收与证据

| 验收条件 | 风险 | 维度 | 已执行证据 | 结果 |
| --- | --- | --- | --- | --- |
| 同一参数再次请求复用行情，相同并发请求合并 | 中 | 单元、浏览器 | api.spec.ts；浏览器 1h→5m→1h 再重复一轮，第二轮前后 snapshot 请求均为 9 次，主图为 1h，游标保持 2026/10/14 04:00 UTC | pass |
| 不混用不同周期、范围、上限或指标参数 | 中 | 单元 | api.spec.ts 参数隔离与周期切换案例 | pass |
| 五分钟过期刷新，最多保留 24 个快照，淘汰最久未访问项 | 中 | 边界、状态 | api.spec.ts 使用确定性时钟验证过期，验证容量及最近访问保留 | pass |
| HTTP/网络失败保留错误语义，并允许重新请求 | 中 | 失败、恢复 | api.spec.ts 检查中文服务错误及网络异常，随后重试取得完整快照 | pass |
| 不破坏现有复盘功能 | 中 | 回归、静态 | npm --prefix frontend run build；npm --prefix frontend test：6 文件、63 测试通过 | pass |

## Test Quality Gate

| Dimension | Result | Evidence / N/A reason |
| --- | --- | --- |
| Acceptance coverage | pass | 所有本次验收条件映射至上表 |
| Happy path/contract | pass | 返回完整行情数据、命中后无需新增 fetch |
| Boundary | pass | 过期临界值、24 项容量、参数隔离 |
| Negative/failure | pass | HTTP 503 服务消息、网络异常、失败后重试 |
| AuthN | N/A | 未修改身份或会话，行情接口无身份参数 |
| AuthZ | N/A | 未修改权限或受保护操作 |
| State transition/invariant | pass | 并发合并、缓存命中、过期与淘汰、失败移除 |
| Integration/contract | pass | 真实前端通过现有合成行情 HTTP 服务加载并切换周期 |
| Real entrypoint/config | pass | preview_start performance-smoke，生产构建由 localhost:4173 提供；生产 TLS/代理未修改，未验证生产部署 |
| Regression | pass | 63 项测试及生产构建通过 |
| Property/fuzz | N/A | 未新增解析器、数值算法或数据转换 |
| Mutation/test-strength | N/A | 非高风险业务逻辑；断言验证数据内容、错误消息与请求副作用 |
| Browser/E2E | pass | 实际 select 切换，确认周期、游标、请求数；无控制台错误或失败网络请求 |
| Isolation/flake | pass | 单元逐例重置模块、fetch 与时钟；并发合并案例通过，无未解释失败 |

## 第二轮：减少 Vue 深层代理读取开销

范围：api.ts 返回的完整快照使用 markRaw；App.vue 主行情状态使用 shallowRef，仍通过替换快照通知图表更新。现有代码不原地修改快照中的 candles。

| 验收条件 / Dimension | Result | 已执行证据 |
| --- | --- | --- |
| 保持普通 K 线对象身份，整份替换仍通知响应式消费者 | pass | api.spec.ts 新增案例断言数组/对象引用及 watchEffect 收到 close 从 11 到 25 的更新 |
| 静态与回归 | pass | npm --prefix frontend run build；npm --prefix frontend test：6 文件、64 项测试通过 |
| 性能 | pass | node scripts/benchmark-snapshot-reactivity.mjs：5000 根、每轮 200 次读取、7 轮交替顺序，中位耗时 deep 244.0543ms、raw 17.0857ms；校验数值总和一致 |
| Browser / integration / real entrypoint | pass | localhost:4173 加载新构建 index-BQ5SL4yE.js；1h→15m→1h，主图恢复 5/34 根、游标 04:00 UTC，四屏状态正常，无控制台错误或失败请求 |
| Boundary / negative / isolation | pass | 包含上一轮过期、容量、参数隔离、失败恢复与并发用例的 64 项回归全部通过 |
| AuthN / AuthZ / property / mutation | N/A | 无身份、权限、数值计算或解析逻辑改动；新增测试直接断言读取身份及状态通知 |

结果：本地 PASS，自行验证。性能数字仅衡量 Vue 代理读取开销，不代表端到端切换耗时。未修改 Rust 后端；本机无 cargo，未执行 Rust 检查。

限制：浏览器使用 scripts/performance-preview.mjs 的合成数据，结果证明重复切换避免网络等待，不代表生产服务器延迟改善比例。首次访问新参数仍请求服务端；缓存只在当前页面内有效，不跨刷新。未部署。
