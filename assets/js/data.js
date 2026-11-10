/*
 * Market data layer.
 *
 * Ships with a deterministic simulated NSE F&O feed so the app runs with no
 * backend. Every symbol/session pair is seeded, so the same day always
 * produces the same candles. During market hours (09:15–15:30 IST, Mon–Fri)
 * candles are revealed minute by minute; outside hours the last session's
 * close is shown.
 *
 * To plug in a real feed, provide an object with the same shape as
 * createFeed(): update(nowMs) -> clock, minutes(symbol) -> 1-minute candles.
 */
(function (global) {
  'use strict';
  const OB = global.OB = global.OB || {};

  const IST_OFFSET = 330 * 60000;
  const OPEN_MIN = 9 * 60 + 15;
  const CLOSE_MIN = 15 * 60 + 30;
  const SESSION_MINUTES = CLOSE_MIN - OPEN_MIN; // 375
  const SESSIONS = 3;

  // [symbol, sector, reference price]
  const UNIVERSE = [
    ['RELIANCE', 'Energy', 1420], ['ONGC', 'Energy', 245], ['BPCL', 'Energy', 330],
    ['NTPC', 'Power', 340], ['POWERGRID', 'Power', 300], ['TATAPOWER', 'Power', 395],
    ['HDFCBANK', 'Banking', 990], ['ICICIBANK', 'Banking', 1380], ['SBIN', 'Banking', 880],
    ['AXISBANK', 'Banking', 1180], ['KOTAKBANK', 'Banking', 2100], ['INDUSINDBK', 'Banking', 760],
    ['BANKBARODA', 'Banking', 250],
    ['BAJFINANCE', 'Finance', 1010], ['BAJAJFINSV', 'Finance', 2000], ['SHRIRAMFIN', 'Finance', 640],
    ['CHOLAFIN', 'Finance', 1600],
    ['TCS', 'IT', 3100], ['INFY', 'IT', 1500], ['WIPRO', 'IT', 245], ['HCLTECH', 'IT', 1480],
    ['TECHM', 'IT', 1450], ['LTIM', 'IT', 5400],
    ['MARUTI', 'Auto', 15800], ['TATAMOTORS', 'Auto', 680], ['M&M', 'Auto', 3500],
    ['BAJAJ-AUTO', 'Auto', 8800], ['EICHERMOT', 'Auto', 6900], ['HEROMOTOCO', 'Auto', 5400],
    ['SUNPHARMA', 'Pharma', 1680], ['CIPLA', 'Pharma', 1520], ['DRREDDY', 'Pharma', 1250],
    ['DIVISLAB', 'Pharma', 6300],
    ['HINDUNILVR', 'FMCG', 2450], ['ITC', 'FMCG', 405], ['NESTLEIND', 'FMCG', 1230],
    ['BRITANNIA', 'FMCG', 5900],
    ['TATASTEEL', 'Metals', 170], ['JSWSTEEL', 'Metals', 1150], ['HINDALCO', 'Metals', 780],
    ['VEDL', 'Metals', 480],
    ['LT', 'Infra', 3900], ['ADANIPORTS', 'Infra', 1450],
    ['ULTRACEMCO', 'Cement', 12000], ['GRASIM', 'Cement', 2800],
    ['BHARTIARTL', 'Telecom', 2050], ['TITAN', 'Consumer', 3600], ['ASIANPAINT', 'Consumer', 2450],
  ];

  // ---------- Seeded randomness ----------
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function gauss(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  // NSE tick size
  const tick = x => Math.round(x * 20) / 20;

  // ---------- IST calendar ----------
  function istParts(ms) {
    const d = new Date(ms + IST_OFFSET);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(),
      min: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds(),
    };
  }

  const dateKey = (y, mo, d) => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  function sessionStartMs(key) {
    const [y, mo, d] = key.split('-').map(Number);
    return Date.UTC(y, mo - 1, d, 9, 15) - IST_OFFSET;
  }

  function prevWeekday(y, mo, d) {
    const t = new Date(Date.UTC(y, mo, d));
    do { t.setUTCDate(t.getUTCDate() - 1); } while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
    return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()];
  }

  // Exchange holidays are not modelled; weekends are.
  function marketClock(nowMs) {
    const p = istParts(nowMs);
    const weekday = p.dow !== 0 && p.dow !== 6;
    let cur, phase;
    if (weekday && p.min >= OPEN_MIN) {
      cur = [p.y, p.mo, p.d];
      phase = p.min < CLOSE_MIN ? 'live' : 'closed';
    } else {
      cur = prevWeekday(p.y, p.mo, p.d);
      phase = weekday ? 'preopen' : 'weekend';
    }
    const sessions = [dateKey(...cur)];
    let k = cur;
    for (let i = 1; i < SESSIONS; i++) {
      k = prevWeekday(...k);
      sessions.unshift(dateKey(...k));
    }
    return {
      phase,
      sessions,
      current: sessions[sessions.length - 1],
      liveMinute: phase === 'live' ? p.min - OPEN_MIN : SESSION_MINUTES,
      liveSecond: p.sec,
    };
  }

  // ---------- Simulated price path ----------
  function generateSeries(sym, base, sessions) {
    const out = [];
    const r0 = mulberry32(hashStr(sym));
    let price = base * (1 + (r0() - 0.5) * 0.06);
    let oi = Math.round((2e6 + r0() * 18e6) / 1000) * 1000;
    const volBase = (2.5e6 / base) * (0.5 + r0());

    sessions.forEach((key, si) => {
      const rng = mulberry32(hashStr(sym + '|' + key));
      const t0 = sessionStartMs(key);
      const r = rng();
      const regime = r < 0.36 ? 1 : r < 0.72 ? -1 : 0; // up, down, chop
      const sigma = 0.0003 + rng() * 0.00035;
      const drift = regime * sigma * (0.02 + rng() * 0.05);
      const oiDir = rng() < 0.62 ? 1 : -1; // fresh positions vs. unwinding
      price *= 1 + gauss(rng) * 0.003 + regime * 0.001;
      const open = price;
      let impulse = 0, pullback = 0, impulseDir = 0;

      for (let m = 0; m < SESSION_MINUTES; m++) {
        // Occasionally stage a pullback followed by a displacement leg. The
        // last opposite candle before the leg is what the engine reads as an
        // order block.
        if (!impulse && !pullback && rng() < 0.011) {
          impulseDir = regime || (rng() < 0.5 ? 1 : -1);
          if (rng() < 0.25) impulseDir = -impulseDir;
          pullback = 2 + Math.floor(rng() * 3);
        }
        let mu = drift, s = sigma;
        if (pullback) {
          mu = -impulseDir * sigma * 1.1;
          if (--pullback === 0) impulse = 3 + Math.floor(rng() * 4);
        } else if (impulse) {
          mu = impulseDir * sigma * (1.8 + rng() * 1.4);
          s = sigma * 1.2;
          impulse--;
        }
        if (regime === 0) mu -= (price - open) / open * 0.02;

        const o = price;
        const ret = mu + gauss(rng) * s;
        const c = o * (1 + ret);
        const h = Math.max(o, c) * (1 + Math.abs(gauss(rng)) * s * 0.5);
        const l = Math.min(o, c) * (1 - Math.abs(gauss(rng)) * s * 0.5);
        const u = m / SESSION_MINUTES;
        const shape = 1 + 1.8 * Math.pow(2 * u - 1, 2) * (u < 0.5 ? 1.3 : 1); // U-shaped volume
        const v = Math.round(volBase * shape * Math.exp(gauss(rng) * 0.35) * (impulse ? 2.6 : 1));
        oi = Math.max(1000, oi + Math.round(oi * (oiDir * Math.abs(ret) * 0.35 + gauss(rng) * 0.00015)));

        out.push({ t: t0 + m * 60000, s: si, m, o: tick(o), h: tick(h), l: tick(l), c: tick(c), v, oi });
        price = c;
      }
    });
    return out;
  }

  // Slice the full session to "now", with the current minute partially formed.
  function snapshot(series, clock) {
    if (clock.phase !== 'live') return series;
    const cut = (clock.sessions.length - 1) * SESSION_MINUTES + clock.liveMinute;
    const done = series.slice(0, cut);
    const full = series[cut];
    if (!full) return done;
    const f = Math.max(0.05, clock.liveSecond / 60);
    const pc = tick(full.o + (full.c - full.o) * f);
    done.push({
      ...full,
      c: pc,
      h: tick(Math.max(full.o, pc) + (full.h - Math.max(full.o, full.c)) * f),
      l: tick(Math.min(full.o, pc) - (Math.min(full.o, full.c) - full.l) * f),
      v: Math.round(full.v * f),
      partial: true,
    });
    return done;
  }

  function aggregate(minutes, tf) {
    if (tf === 1) return minutes;
    const out = [];
    let cur = null, key = -1;
    for (const k of minutes) {
      const b = k.s * 1000 + Math.floor(k.m / tf);
      if (b !== key) {
        cur = { t: k.t, s: k.s, m: k.m, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, oi: k.oi };
        out.push(cur);
        key = b;
      } else {
        if (k.h > cur.h) cur.h = k.h;
        if (k.l < cur.l) cur.l = k.l;
        cur.c = k.c;
        cur.v += k.v;
        cur.oi = k.oi;
      }
    }
    return out;
  }

  function createFeed() {
    let key = null, clock = null, series = new Map();
    return {
      update(nowMs) {
        clock = marketClock(nowMs);
        const k = clock.sessions.join(',');
        if (k !== key) {
          key = k;
          series = new Map(UNIVERSE.map(([sym, , base]) => [sym, generateSeries(sym, base, clock.sessions)]));
        }
        return clock;
      },
      minutes(sym) { return snapshot(series.get(sym), clock); },
    };
  }

  OB.data = { UNIVERSE, IST_OFFSET, SESSION_MINUTES, tick, istParts, marketClock, aggregate, createFeed };
})(window);
