---
version: 1
slug: "frontend-src-productapp-vue"
primary_target: "frontend/src/ProductApp.vue"
related_targets: []
---

# Landing page (/)

## Scope

Marketing home for grailab, rendered by `frontend/src/ProductApp.vue` at `/`. Sign-in gate and payment-return states of the same component adopt the same visual system. The replay workspace (`App.vue`) is out of scope and keeps its own dark chart interface.

## Mode

Persuade. A first-time visitor must understand within seconds that grailab replays years of market history at controllable speed for deliberate trade practice, believe it because the replay actually runs on the page, and take the primary action (start practicing / create an account).

## Audience and job

Traders who want more repetitions per hour than live markets allow. They evaluate the tool by whether the chart, controls and trade flow feel like a real instrument, not by marketing claims.

## Proof and content

- The working replay preview is the proof: timeframe switching, play/pause, speed, progress, buy/sell markers.
- Real capabilities only: 11 timeframes, 0.25×–8×, 1–4 synchronized panes, manual buy/sell/close, Stoch, drawings.
- Existing Chinese copy, price (US$12.99/month) and test-payment note stay factual. No testimonials, logos or performance claims exist, so none may be invented.
- All demo market data is synthetic and labelled as such.

## Constraints

- Warm-white system is binding: `#FAF7F2` ground, `#342B25` ink, `#C46F50` the only primary accent. Soft radii, hairline borders, very light shadows, generous whitespace, no cold fintech blue, no heavy gradients.
- Chart keeps a professional palette: warm near-black panel, monochrome candles (hollow up / filled down) plus the brand accent only for the sell marker, so direction never depends on decoration.
- Reference registers: Linear's disciplined layout, Notion's soft material quality.
- Accessibility floor: 4.5:1 body contrast, keyboard operability, 44px touch targets, reduced-motion support.

## Direction contract

THESIS: A calm trading instrument laid on warm paper. The page refuses the fintech template of centred claim, subcopy, button and three equal feature cards; the first viewport's lower half is a working replay panel, and the product proves itself before it is described.

OWN-WORLD: Paper `#FAF7F2` with a slightly deeper `#F3ECE2` section band and deep-coffee ink `#342B25`; hairline rules at 12% ink; terracotta `#C46F50` reserved for primary actions, the replay frontier and the sell marker. Panels are 18px radius with a hairline plus one soft offset shadow; controls are 10–12px. Type is self-hosted Noto Sans SC for Chinese and Schibsted Grotesk for Latin and tabular figures, headings heavy and tight, body generous. The chart is a warm near-black instrument (`#17120F`) with monochrome candles and quiet cream axis text. No gradients, no glass, no decorative illustration.

STORY: Within one viewport the visitor sees candles replaying, a period switch, a speed control and a marked buy/sell, understands that years of history can be practised at chosen speed, then reads the multi-pane capability, the three-step workflow and the single price before starting or signing up.

FIRST VIEWPORT: A hairline header on paper with the wordmark, three text links and two quiet account actions. Below, a left-aligned two-line headline at 64–84px with tracking held at -0.02em, a right rail carrying the lead paragraph, primary terracotta action and secondary text link, and a one-line capability ticker separated by hairlines. The lower half is a full-container replay instrument: chrome with symbol, timeframe chips and a live status; chart with price axis, frontier rule and trade markers; bottom progress rail with UTC time. It sits crooked in nothing, floats on the paper with one soft shadow, and is honestly labelled 演示数据.

FORM: Brief-pinned direction (Linear layout + Notion material), ranked first of one. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
