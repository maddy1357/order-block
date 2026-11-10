# OB Scanner: Order Blocks & Liquidity for F&O stocks

A dependency-free web app. It scans NSE F&O stocks for **order blocks**, ranks them on live **Bullish / Bearish boards** by a liquidity score, and plots the whole market on an **OI X-Ray**.

Open `index.html` in a browser. There is no build step and no backend.

> The app ships with a **simulated, deterministic market feed** so it runs anywhere. It is for education only and is not investment advice.

## Features

| View | What it shows |
| --- | --- |
| **Dashboard** | Flow view. Every stock's intraday % path fans out from the open (green bullish, red bearish), above a market-breadth strip. Each path is linked into ranked bull and bear tiles, then into volume profiles for the OI build-up, then into the top 3 **BULL** and **BEAR** cards. Each card shows ZONE, S1/R1/R2 (or R1/S1/S2), RISK and R:R. Hover anything to trace one stock through the flow. Click to open its chart. |
| **Boards** | Top 20 bullish and top 20 bearish stocks, strongest first. Each row shows LTP, % change, OI build-up, the active order-block zone, support / resistance and a 0–100 liquidity score. |
| **Chart** | Candlestick chart (1m / 5m / 15m) with order-block zones (fresh, tested, mitigated), plus resistance, support and liquidity lines. A side panel shows the zone ladder, a score breakdown and session stats. Scroll to zoom, drag to pan, double-click to reset. |
| **Market X-Ray** | Every stock plotted by price change against OI change. The four quadrants are Long Buildup, Short Buildup, Short Covering and Long Unwinding. Also shows sector leaders and laggards, and top gainers and losers. |
| **Journal** | Trade log kept in `localStorage`. Shows win rate, net P&L and average R, and exports to CSV. "Use current chart" pre-fills entry, stop and target from the detected levels. |

The app uses a left icon sidebar, which can expand to show labels, and a `Ctrl K` stock search. The neon dark theme is the default, and a light theme is available from the sidebar. Down to phone width, the layout reflows with a bottom navigation bar.

**RISK and R:R** on the cards assume a retest of the zone. Entry is at the near edge of the zone and the stop sits just beyond the far edge (0.1 × ATR). The target is R1 for bullish setups and S1 for bearish ones.

## How it works

### Order block detection (`assets/js/engine.js`)

- **Bullish OB**: the last *bearish* candle before a displacement leg up. Within 3 bars, a close must clear that candle's high by at least **1.6 × ATR(14)** *and* break the latest confirmed swing high (a break of structure). A displacement of 2.6 × ATR or more qualifies without a structure break.
- **Bearish OB**: the mirror image.
- Swings are 3/3 fractal pivots. Very tall candles (more than 1.8 × ATR) are trimmed to the body on the far side.
- **Lifecycle**: `fresh` → `tested` (price re-entered the zone) → `mitigated` (a close through the far side).

### Levels
For a bullish setup:

- **Resistance**: the nearest swing high (or day / previous-day high) above LTP.
- **Order block**: the nearest unmitigated bullish zone below price.
- **Support**: the nearest swing low below the zone.
- **Liquidity**: the next swing-low pool below support (resting sell-side liquidity).

Bearish setups are mirrored.

### Scores (0–100)
```
strength  = 50% order-block quality + 30% trend efficiency + 20% momentum
liquidity = 45% strength + 30% OI confirmation + 25% momentum
```
- *Order-block quality*: displacement size, volume expansion, structure break, untested bonus. It is weighted by proximity to price and by freshness.
- *Trend efficiency*: Kaufman efficiency ratio of the session in the trade direction, discounted when price is on the wrong side of VWAP.
- *Momentum*: RSI(14) on 5m plus the day's % change.
- *OI confirmation*: Long Buildup (bull) and Short Buildup (bear) score highest. Covering and unwinding score partially.
- **Choppy** stocks (efficiency below 0.22 and a move under 0.6%) score **zero**. Rankings wait for the first 4 five-minute bars before settling.

### Market hours
During market hours (09:15–15:30 IST, Mon–Fri) the feed reveals candles minute by minute and the boards re-scan every 3 seconds. Outside market hours the last session's closing board is shown. Exchange holidays are not modelled.

## Plugging in real data

`assets/js/data.js` exports `createFeed()`. Any object with this shape can replace it:

```js
{
  update(nowMs) -> { phase, sessions, current, liveMinute, liveSecond },
  minutes(symbol) -> [{ t, s, m, o, h, l, c, v, oi }, ...]   // 1-minute candles
}
```

`s` is the session index (0 = oldest) and `m` is the minute since 09:15. Everything else (aggregation, detection, scoring, UI) works unchanged.

## Project layout

```
index.html
assets/css/style.css
assets/js/data.js      simulated feed, IST market clock, candle aggregation
assets/js/engine.js    order-block detection, levels, scoring
assets/js/chart.js     canvas candlestick chart
assets/js/xray.js      canvas OI scatter
assets/js/flow.js      flow dashboard (paths, tiles, profiles, cards)
assets/js/journal.js   localStorage journal
assets/js/app.js       routing, refresh loop, rendering
```

## License

MIT
