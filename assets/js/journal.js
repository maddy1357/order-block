/*
 * Trading journal stored in localStorage (per browser).
 */
(function (global) {
  'use strict';
  const OB = global.OB = global.OB || {};
  const KEY = 'obs.journal.v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }

  function metrics(t) {
    const dir = t.side === 'short' ? -1 : 1;
    const risk = Math.abs(t.entry - t.sl);
    if (t.exit == null) return { pnl: null, r: null };
    const pnl = (t.exit - t.entry) * dir * t.qty;
    return { pnl, r: risk ? (t.exit - t.entry) * dir / risk : null };
  }

  function stats(list) {
    const closed = list.map(t => ({ t, ...metrics(t) })).filter(x => x.pnl !== null);
    const wins = closed.filter(x => x.pnl > 0);
    const net = closed.reduce((s, x) => s + x.pnl, 0);
    const rs = closed.filter(x => x.r !== null);
    return {
      total: list.length,
      open: list.length - closed.length,
      winRate: closed.length ? wins.length / closed.length * 100 : null,
      net,
      avgR: rs.length ? rs.reduce((s, x) => s + x.r, 0) / rs.length : null,
    };
  }

  function toCSV(list) {
    const cols = ['date', 'sym', 'side', 'qty', 'entry', 'sl', 'target', 'exit', 'setup', 'notes'];
    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(','), ...list.map(t => cols.map(c => esc(t[c])).join(','))].join('\n');
  }

  OB.journal = { load, save, metrics, stats, toCSV };
})(window);
