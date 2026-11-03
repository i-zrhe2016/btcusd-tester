# Replay viewport regression verification

Scope: retain horizontal position and zoom when a same-timeframe market snapshot is replaced during replay.
Mode: normal, self-verification. Level: regression. Result: partial (automated checks pass; real browser interaction not verified).

The snapshot watcher rebuilt charts and restored only viewport width, then centered the view using the default right offset. The fix restores the logical range translated by the change in rendered candle count, matching ordinary playback updates. A changed timeframe still receives the default playback positioning.

## Acceptance evidence

| Acceptance criterion | Risk | Required dimension | Executed evidence | Result |
|---|---|---|---|---|
| Resume from the panned/zoomed position and continue following playback | medium | component/state | MarketChart.spec.ts: two ranges, resume, advance, snapshot replacement, advance again | pass |
| Main pane prefetch preserves the existing position | medium | component/regression | Same tests replace 200-candle snapshot with 300 candles without moving cursor | pass |
| Secondary pane snapshot replacement preserves relative position | medium | component/state | Clock-limited pane snapshot and clock advance together | pass |
| Actual rendered chart keeps its position during user interaction | medium | browser | Not executed; chart library is mocked in component tests | blocked |

## Test Quality Gate

| Dimension | Result | Evidence / N/A reason |
|---|---|---|
| Acceptance coverage | fail | Browser interaction remains unverified |
| Happy path/contract | pass | Three component cases check actual logical range state |
| Boundary | pass | Fractional range, different widths, history/right-space positions, unchanged and advancing rendered count |
| Negative/failure | N/A | No new error or input contract introduced |
| AuthN | N/A | No identity/session changes |
| AuthZ | N/A | No permissions/protected operations changes |
| State transition/invariant | pass | Position and width preserved across resume, append and subsequent playback |
| Integration/contract | pass | Vue watchers exercised with chart API test doubles; real renderer excluded |
| Real entrypoint/config | N/A | No transport/deployment changes; browser entrypoint remains unverified |
| Regression | pass | Temporarily disabling range restoration caused all three new cases to fail with default-position ranges; restoration returned them to green |
| Property/fuzz | N/A | Small deterministic viewport translation; representative cases used |
| Mutation/test-strength | pass | Targeted mutation disabled preservation branch; 3/3 regression cases failed |
| Browser/E2E | fail | Not executed; no active browser preview |
| Isolation/flake | pass | Fresh chart instances for each case; no timers/network in test scenarios |

Executed commands:

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend test`: 45/45 passed.
- `npm --prefix frontend test -- src/components/MarketChart.spec.ts` with restoration disabled: 3/3 failed at preserved-range assertions, as expected. Mutation removed afterward.
- `npm --prefix frontend run build && npm --prefix frontend test`: production build passed; 45/45 tests passed on final source.

No deployment performed. Full browser acceptance remains open; automated evidence cannot establish real chart renderer behavior.
