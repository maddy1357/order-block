/*
 * Order block & liquidity engine.
 *
 * Bullish order block: the last bearish candle before a displacement leg up
 * (close beyond the candle's high by >= dispATR x ATR within `lookahead` bars)
 * that breaks the most recent swing high, or a very strong displacement
 * (>= strongDispATR x ATR) without a structure break. Bearish blocks mirror this.
 *
 * Block lifecycle: fresh -> tested (price re-entered the zone) -> mitigated
 * (a close through the far side of the zone).
 *
 * Per-stock scores (0–100):
 *   strength  = 50% order-block quality + 30% trend efficiency + 20% momentum
 *   liquidity = 45% strength + 30% OI confirmation + 25% momentum
 * Choppy stocks (low efficiency ratio and small move) score zero.
 */
(function (global) {
  'use strict';
  const OB = global.OB = global.OB || {};

  const DEFAULTS = {
    atrLen: 14,
    swingL: 3,
    swingR: 3,
    dispATR: 1.6,
    strongDispATR: 2.6,
    lookahead: 3,
    maxZoneATR: 1.8,
    rsiLen: 14,
    chopER: 0.22,
    chopMove: 0.6,
    minBars: 4,
    minScore: 18,
  };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const tick = x => Math.round(x * 20) / 20;

  function atrSeries(c, n) {
    const out = new Array(c.length);
    let prev = 0;
    for (let i = 0; i < c.length; i++) {
      const k = c[i];
      const tr = i ? Math.max(k.h - k.l, Math.abs(k.h - c[i - 1].c), Math.abs(k.l - c[i - 1].c)) : k.h - k.l;
      prev = i < n ? (prev * i + tr) / (i + 1) : (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
    return out;
  }

  function rsi(c, n) {
    if (c.length < n + 1) return 50;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) {
      const d = c[i].c - c[i - 1].c;
      if (d > 0) g += d; else l -= d;
    }
    g /= n; l /= n;
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i].c - c[i - 1].c;
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
    }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }

  // Fractal pivots: strictly beyond the right side, at least equal to the left.
  function swings(c, L, R) {
    const highs = [], lows = [];
    for (let i = L; i < c.length - R; i++) {
      let isH = true, isL = true;
      for (let k = i - L; k <= i + R && (isH || isL); k++) {
        if (k === i) continue;
        if (c[k].h > c[i].h || (k > i && c[k].h === c[i].h)) isH = false;
        if (c[k].l < c[i].l || (k > i && c[k].l === c[i].l)) isL = false;
      }
      if (isH) highs.push({ i, price: c[i].h });
      if (isL) lows.push({ i, price: c[i].l });
    }
    return { highs, lows };
  }

  // Most recent pivot that formed before `limit` and was confirmed by bar `idx`.
  function lastConfirmed(list, idx, R, limit) {
    for (let n = list.length - 1; n >= 0; n--) {
      const s = list[n];
      if (s.i < limit && s.i + R <= idx) return s;
    }
    return null;
  }

  function detectBlocks(c, opt) {
    const o = { ...DEFAULTS, ...opt };
    const atr = atrSeries(c, o.atrLen);
    const sw = swings(c, o.swingL, o.swingR);
    const blocks = [];

    const avgVol = i => {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - 20); k < i; k++) { s += c[k].v; n++; }
      return n ? s / n : c[i].v;
    };

    for (let i = 1; i < c.length - 1; i++) {
      const k0 = c[i];
      if (k0.c === k0.o) continue;
      const dir = k0.c < k0.o ? 1 : -1; // bearish candle -> bullish block
      const a = atr[i] || (k0.h - k0.l) || 1e-9;

      for (let j = i + 1; j <= Math.min(i + o.lookahead, c.length - 1); j++) {
        const move = dir === 1 ? c[j].c - k0.h : k0.l - c[j].c;
        if (move < o.dispATR * a) continue;
        const pivot = dir === 1
          ? lastConfirmed(sw.highs, j, o.swingR, i + 1)
          : lastConfirmed(sw.lows, j, o.swingR, i + 1);
        const bos = !!pivot && (dir === 1 ? c[j].c > pivot.price : c[j].c < pivot.price);
        if (!bos && move < o.strongDispATR * a) continue;

        let top = k0.h, bottom = k0.l;
        if (top - bottom > o.maxZoneATR * a) {
          if (dir === 1) top = Math.max(k0.o, k0.c); else bottom = Math.min(k0.o, k0.c);
        }
        let vs = 0;
        for (let q = i + 1; q <= j; q++) vs += c[q].v;
        const b = {
          type: dir === 1 ? 'bull' : 'bear',
          i, j, t: k0.t,
          top: tick(top), bottom: tick(bottom),
          disp: move / a,
          volRatio: (vs / (j - i)) / (avgVol(i) || 1),
          bos,
          tests: 0,
          end: null,
          status: 'fresh',
        };
        const prev = blocks[blocks.length - 1];
        if (prev && prev.type === b.type && i - prev.i <= 2) {
          if (b.disp > prev.disp) blocks[blocks.length - 1] = b;
        } else {
          blocks.push(b);
        }
        break;
      }
    }

    for (const b of blocks) {
      let inside = false;
      for (let k = b.j + 1; k < c.length; k++) {
        const touch = b.type === 'bull' ? c[k].l <= b.top : c[k].h >= b.bottom;
        if (touch && !inside) b.tests++;
        inside = touch;
        if (b.type === 'bull' ? c[k].c < b.bottom : c[k].c > b.top) {
          b.end = k;
          b.status = 'mitigated';
          break;
        }
      }
      if (b.end === null && b.tests) b.status = 'tested';
    }

    return { blocks, atr, swings: sw };
  }

  // Resistance / support / liquidity around the chosen order block.
  function computeLevels(bias, ob, ltp, a, sw, prevSession, dayHigh, dayLow) {
    const highs = sw.highs.map(s => s.price);
    const lows = sw.lows.map(s => s.price);
    if (prevSession.length) {
      highs.push(Math.max(...prevSession.map(k => k.h)));
      lows.push(Math.min(...prevSession.map(k => k.l)));
    }
    highs.push(dayHigh);
    lows.push(dayLow);
    const gap = a * 0.15;
    const nearestAbove = (arr, x) => arr.filter(p => p > x + gap).reduce((m, p) => Math.min(m, p), Infinity);
    const nearestBelow = (arr, x) => arr.filter(p => p < x - gap).reduce((m, p) => Math.max(m, p), -Infinity);

    let resistance, support, liquidity;
    if (bias === 'bull') {
      resistance = nearestAbove(highs, ltp);
      if (!isFinite(resistance)) resistance = ltp + 1.5 * a;
      support = nearestBelow(lows, ob.bottom);
      if (!isFinite(support)) support = ob.bottom - a;
      liquidity = nearestBelow(lows, support);
      if (!isFinite(liquidity)) liquidity = support - a;
    } else {
      support = nearestBelow(lows, ltp);
      if (!isFinite(support)) support = ltp - 1.5 * a;
      resistance = nearestAbove(highs, ob.top);
      if (!isFinite(resistance)) resistance = ob.top + a;
      liquidity = nearestAbove(highs, resistance);
      if (!isFinite(liquidity)) liquidity = resistance + a;
    }
    return {
      resistance: tick(resistance),
      ob: { top: ob.top, bottom: ob.bottom },
      support: tick(support),
      liquidity: tick(liquidity),
    };
  }

  function analyze(c, opt) {
    const o = { ...DEFAULTS, ...opt };
    const n = c.length;
    const last = c[n - 1];
    const session = c.filter(k => k.s === last.s);
    const prevSession = c.filter(k => k.s === last.s - 1);
    const prevClose = prevSession.length ? prevSession[prevSession.length - 1].c : session[0].o;
    const prevOI = prevSession.length ? prevSession[prevSession.length - 1].oi : session[0].oi;
    const ltp = last.c;
    const chg = (ltp / prevClose - 1) * 100;
    const oiChg = (last.oi / prevOI - 1) * 100;
    const buildup = chg >= 0
      ? (oiChg >= 0 ? 'Long Buildup' : 'Short Covering')
      : (oiChg >= 0 ? 'Short Buildup' : 'Long Unwinding');

    const { blocks, atr, swings: sw } = detectBlocks(c, o);
    const a = atr[n - 1] || 1e-9;
    const r = rsi(c, o.rsiLen);

    // Kaufman efficiency ratio over the session
    let path = Math.abs(session[0].c - session[0].o);
    for (let i = 1; i < session.length; i++) path += Math.abs(session[i].c - session[i - 1].c);
    const net = ltp - session[0].o;
    const er = path ? Math.abs(net) / path : 0;

    let pv = 0, vol = 0, dayHigh = -Infinity, dayLow = Infinity;
    for (const k of session) {
      pv += (k.h + k.l + k.c) / 3 * k.v;
      vol += k.v;
      if (k.h > dayHigh) dayHigh = k.h;
      if (k.l < dayLow) dayLow = k.l;
    }
    const vwap = vol ? pv / vol : ltp;
    const settling = session.length < o.minBars;
    const choppy = !settling && er < o.chopER && Math.abs(chg) < o.chopMove;

    const side = dir => {
      const isBull = dir === 1;
      const ob = blocks
        .filter(b => b.type === (isBull ? 'bull' : 'bear') && b.status !== 'mitigated' &&
          (isBull ? b.bottom <= ltp : b.top >= ltp))
        .sort((x, y) => isBull ? y.top - x.top : x.bottom - y.bottom)[0] || null;

      let obQ = 0;
      if (ob) {
        const dist = isBull ? (ltp - ob.top) / a : (ob.bottom - ltp) / a;
        const prox = dist <= 0 ? 1 : clamp(1 - dist / 8, 0.15, 1);
        const fresh = clamp(1 - (n - 1 - ob.j) / 150, 0.3, 1);
        obQ = (clamp(ob.disp / 3.5) * 0.45 +
          clamp((ob.volRatio - 1) / 1.5) * 0.25 +
          (ob.bos ? 0.15 : 0) +
          (ob.tests === 0 ? 0.15 : ob.tests === 1 ? 0.08 : 0)) * prox * fresh;
      }
      const mom = clamp(dir * (r - 50) / 25) * 0.6 + clamp(dir * chg / 2.5) * 0.4;
      const trend = (Math.sign(net) === dir ? er : 0) * (dir * (ltp - vwap) > 0 ? 1 : 0.35);
      const oiConf = isBull
        ? ({ 'Long Buildup': 1, 'Short Covering': 0.6 }[buildup] ?? 0.1)
        : ({ 'Short Buildup': 1, 'Long Unwinding': 0.6 }[buildup] ?? 0.1);
      const strength = 100 * (0.5 * obQ + 0.3 * trend + 0.2 * mom);
      const liquidity = 100 * (0.45 * strength / 100 + 0.3 * oiConf + 0.25 * mom);
      return { ob, obQ, mom, trend, oiConf, strength, liquidity };
    };

    const bull = side(1), bear = side(-1);
    let bias = 'neutral', pick = null;
    if (!settling && !choppy) {
      const ranked = [['bull', bull], ['bear', bear]]
        .filter(([, s]) => s.ob && s.liquidity >= o.minScore)
        .sort((x, y) => y[1].liquidity - x[1].liquidity);
      if (ranked.length) [bias, pick] = ranked[0];
    }

    return {
      ltp, prevClose, chg, oi: last.oi, oiChg, buildup,
      rsi: r, er, vwap, atr: a, dayHigh, dayLow, volume: vol,
      settling, choppy, bias,
      strength: pick ? Math.round(pick.strength) : 0,
      liquidity: pick ? Math.round(pick.liquidity) : 0,
      components: pick,
      levels: pick ? computeLevels(bias, pick.ob, ltp, a, sw, prevSession, dayHigh, dayLow) : null,
      blocks,
      time: last.t,
    };
  }

  OB.engine = { DEFAULTS, analyze, detectBlocks, atrSeries, rsi, swings };
})(window);
