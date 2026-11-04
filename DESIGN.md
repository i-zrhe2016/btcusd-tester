---
name: grailab
description: Warm-paper landing surface for a historical market replay trainer
colors:
  paper: "#FAF7F2"
  paper-soft: "#F3ECE2"
  paper-raise: "#FFFDF9"
  ink: "#342B25"
  ink-soft: "#6B5F55"
  ink-dim: "#75685C"
  terracotta: "#C46F50"
  terracotta-fill: "#AD5A3D"
  terracotta-deep: "#9E4E33"
  chart-ground: "#17120F"
  chart-candle: "#EFE5D8"
  chart-muted: "#94877B"
  statement-ground: "#2B211B"
  danger: "#A33A2E"
typography:
  display:
    fontFamily: "Schibsted Grotesk, Grailab Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(44px, 5.4vw, 78px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Schibsted Grotesk, Grailab Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(30px, 3.2vw, 45px)"
    fontWeight: 700
    lineHeight: 1.26
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Schibsted Grotesk, Grailab Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Schibsted Grotesk, Grailab Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.9
    letterSpacing: "0em"
  label:
    fontFamily: "Schibsted Grotesk, Grailab Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "9px"
  md: "11px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "32px"
  xl: "56px"
  section: "clamp(72px, 9vw, 118px)"
  container: "1200px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta-fill}"
    textColor: "#FFF9F4"
    rounded: "{rounded.md}"
    padding: "0 23px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.terracotta-deep}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 23px"
    height: "48px"
  plan-card:
    backgroundColor: "{colors.paper-raise}"
    rounded: "{rounded.lg}"
    padding: "36px"
---

# Design System: grailab

## Overview

**Creative North Star: "The Warm Paper Desk"**

The homepage treats grailab as a working instrument placed on warm paper. The chart is the one machine on the desk: dark, precise, always the largest object in the room. Everything around it is paper, coffee ink, hairline rules and air. Linear contributes the discipline — aligned edges, a small number of scale steps, the product itself as the argument — while Notion contributes the material softness: a warm ground instead of white, gentle radii, and shadows that sit under objects rather than around them.

The surface rejects the cold-fintech register (blue-black fields, neon data lines, glass cards), the marketing register of gradients and decorative illustrations, and the three-equal-cards template. The replay panel is the proof, so it appears before any feature list and actually runs.

**Key Characteristics:**
- One dark instrument on a warm paper field.
- Terracotta used as a sparse signal, never as a wash.
- Self-hosted Schibsted Grotesk for Latin and figures; Noto Sans SC for Chinese.
- 16px surfaces, 1px hairlines, one soft offset shadow per elevated object.
- Monochrome candles (hollow up, filled down) so direction never depends on hue.
- Generous margins and short lines of copy.

## Colors

A warm neutral field carrying a single terracotta signal, interrupted once by the near-black chart and once by a coffee statement band.

### Primary
- **Terracotta Signal** (#C46F50): the brand mark, replay frontier, progress fill, sell marker, step rules, feature ticks, plan checks and focus rings. It marks action and “now”, never large backgrounds.
- **Terracotta Fill** (#AD5A3D): the fill for primary buttons that carry white text. It is the accessible sibling of the signal; white on #C46F50 only reaches 3.7:1.
- **Terracotta Deep** (#9E4E33): hover and pressed states for filled controls and hover for accent text links.

### Neutral
- **Warm Paper** (#FAF7F2): the page ground and the ambient field behind every section.
- **Paper Soft** (#F3ECE2): the guide band, used to change pace without introducing a new hue.
- **Paper Raise** (#FFFDF9): the plan card and the workspace return chip.
- **Deep Coffee Ink** (#342B25): all headings and body text on paper.
- **Soft Coffee** (#6B5F55): secondary body copy and navigation at rest.
- **Dim Coffee** (#75685C): metadata, disclaimers and chart captions; the lightest text allowed on paper.
- **Statement Ground** (#2B211B): the full-width statement band and the surface behind cream text.
- **Danger** (#A33A2E): checkout failures only; never decoration.

### Chart
- **Instrument Ground** (#17120F): the replay panel and pane-preview ground.
- **Candle** (#EFE5D8): wicks and bodies; up candles are hollow, down candles filled.
- **Chart Muted** (#94877B): axes, timestamps, inactive chrome.
- **Live Cream** (#F3EADD): active chrome and the current-price tag text ground.

### Named Rules
**The One Instrument Rule.** Only the replay chart and the pane preview are dark. A second dark block on the page would compete with the product itself; the statement band uses coffee, not the chart ground.

**The Sparse Signal Rule.** Terracotta marks actions and live state, not surfaces. If a section reads as terracotta at arm's length, the rule has been broken.

**The Legible Fill Rule.** White text on terracotta is only legal on #AD5A3D or darker. #C46F50 carries graphics, rules and large marks, never small white type.

## Typography

**Display Font:** Schibsted Grotesk with Grailab Sans SC (a self-hosted subset of Noto Sans SC)
**Body Font:** the same pair
**Label/Numeric Font:** Schibsted Grotesk, tabular where alignment matters

**Character:** Schibsted is a precise grotesk with a slightly editorial curve; Noto Sans SC keeps Chinese headlines sturdy and even at heavy weights. The pairing reads as a working publication rather than a fintech product site. Latin and figures carry the brand; Chinese carries the meaning.

### Hierarchy
- **Display** (700, clamp(44px, 5.4vw, 78px), 1.08, -0.02em): the two-line homepage headline only. English copy caps at 66px so the comma split holds two lines.
- **Headline** (700, clamp(30px, 3.2vw, 45px), 1.26, -0.02em): section titles and the statement band.
- **Title** (650, 17px, 1.35): feature and step names.
- **Body** (400, 14.5px, 1.9): product copy, held to 34–46ch.
- **Label** (600, 12px, 0.01em): captions, demo-data notice, navigation, chart chrome.

### Named Rules
**The Tabular Data Rule.** Tabular figures belong to prices, clocks, counters and axes. The plan price stays proportional so it reads as one number rather than a slot machine.

**The Two-Script Rule.** Never set a Chinese headline in Schibsted's fallback; the CJK face must load before the hero paints. Latin display and Chinese body may mix on one line, but weights are chosen per script rather than inherited blindly.

## Layout

The page uses a single 1200px container with fluid gutters from 32px to 96px. The header is a 78px hairline row: brand, three text links pushed right, then account actions. The hero is a two-column editorial masthead (1.45fr / 0.75fr) that ends on a shared baseline, followed by a full-container replay instrument. Sections are separated by hairline rules and a vertical rhythm of `clamp(72px, 9vw, 118px)`.

The feature section is asymmetric: a dark three-pane figure on the left, a four-row hairline list on the right. The guide becomes a three-column sequence in a tinted band. The statement is a full-bleed coffee band with a two-column bottom-aligned pair. Pricing is a 1fr / 0.9fr pair aligned to the top, not centred.

At 980px the hero, section heads, feature grid, statement and pricing collapse to one column. At 720px the header wraps its navigation onto a second hairline row, hero actions stack, the instrument chrome reflows, and the chart shortens to 252px. At 480px the capability separators disappear so wrapped lines never begin with a dot. The layout never scrolls horizontally, down to the 320px minimum.

**The Generous Margin Rule.** Whitespace is a material, not leftover space. A section earns separation with at least 72px of field; a divider is a refinement, never the only thing holding two sections apart.

## Elevation & Depth

Depth is shadow-only on the paper side and tonal on the chart side. A surface declares either a 1px hairline or one soft offset shadow, never both. The chart and pane figure are dark enough that they sit on the paper by contrast alone; their shadows are ambient, not structural.

### Shadow Vocabulary
- **Instrument** (`0 2px 3px rgba(52, 43, 37, 0.10), 0 48px 90px -48px rgba(52, 43, 37, 0.55)`): the replay panel and pane figure; a tight contact shadow plus a long, negative-spread ambient shadow.
- **Card** (`0 2px 4px rgba(52, 43, 37, 0.05), 0 40px 72px -50px rgba(52, 43, 37, 0.50)`): the plan card only.
- **Primary Button** (`0 1px 2px rgba(90, 45, 25, 0.18), 0 12px 26px -16px rgba(140, 70, 40, 0.70)`): the filled action; reads as a small object lifted off the paper.

**The Flat Hairline Rule.** Structure is a 1px rule at 12% ink. Elevation is a soft shadow with an offset and a blur. A hairline under a wide shadow is the ghost card and is forbidden.

## Shapes

Panels and cards use a 16px radius; buttons 11px; the segmented speed control and small chips 9px; status dots and the progress track are the only full pills. Borders are 1px and always low-contrast ink, except the dark chart's 9% cream hairlines. There is no decorative geometry, no glass, no gradient mesh, no illustration.

The brand mark is the incumbent terracotta triangle, preserved in shape and recoloured from black to the signal. It is the only polygon on the page.

## Components

### Buttons
- **Shape:** 11px radius, 48px minimum height, 23px horizontal padding.
- **Primary:** #AD5A3D fill, #FFF9F4 text, 14.5px/600, arrow icon at 18px.
- **Hover / Focus:** fill deepens to #9E4E33; focus is a 2px #C46F50 ring at 3px offset; active shifts 1px.
- **Ghost:** transparent with an inset 1px hairline, coffee text; fills with 4.5% ink on hover.
- **Small header action:** 44px minimum height, 9px radius, 13.5px text.

### Chart Chrome
- **Timeframe tabs:** 44px tall, underscore selection in 2px terracotta, inactive text in chart-muted.
- **Speed control:** three 44px targets in a 9px-radius well at 4.5% cream; the active target is 9% cream.
- **Play:** 44px circle, 1px cream hairline, no fill at rest.
- **Progress:** 3px track at 9% cream; fill in the terracotta signal.
- **Markers:** buy is a hollow cream dot with a cream `BUY #n` label; sell is a filled terracotta dot with a terracotta `SELL #n` label.

### Cards / Containers
- **Plan card:** 16px radius, #FFFDF9 fill, 36px padding, card shadow only, no border.
- **Replay instrument:** 16px radius, #17120F fill, clipped corners, instrument shadow, cream hairlines between rows.
- **Pane figure:** 16px radius, dark ground, three 92px panes separated by 7% cream rules, one shared terracotta cursor.

### Navigation
- **Header:** brand at 21px/700; links at 13.5px, soft coffee, 44px targets; account login is a text button and signup is the small primary.
- **Mobile:** the navigation becomes a second full-width row under the brand, justified across the container; the hairline above it is the only divider.

### Gate
- **Layout:** centred 440px card on the paper field, 30px terracotta mark, 25px headline, 13.5px body.
- **Actions:** ghost login plus primary signup; the payment-return state swaps the pair for a single primary action.

## Do's and Don'ts

### Do:
- **Do** keep the chart the largest and darkest object on the first screen.
- **Do** use #AD5A3D for white-on-terracotta small text and reserve #C46F50 for graphics and large marks.
- **Do** label synthetic market data in the same viewport as the chart.
- **Do** hold body copy to 34–46ch and let the page breathe at 72–118px section rhythm.
- **Do** use hollow-up / filled-down candles so direction survives colour blindness and desaturation.
- **Do** give every control a 44px target and a visible terracotta focus ring.

### Don't:
- **Don't** introduce a second accent hue for “buy” or “profit”; the chart is monochrome and the signal is terracotta.
- **Don't** put a border and a wide shadow on the same surface.
- **Don't** use gradients, glass, neon glows, or a cold blue-black fintech ground.
- **Don't** turn features into equal icon-heading-text cards; the page uses figures and hairline rows.
- **Don't** set a Chinese headline in a Latin face or vice versa; the two scripts have separate responsibilities.
- **Don't** invent testimonials, customer logos, performance data or live prices.
