/*
 * App shell: routing, refresh loop and view rendering.
 */
(function (global) {
  'use strict';
  const OB = global.OB;
  const { UNIVERSE, aggregate, createFeed } = OB.data;
  const { fmtPx, fmtDay, fmtTime, cssVar } = OB.chartUtil;

  const $ = s => document.querySelector(s);
  const SECTOR = Object.fromEntries(UNIVERSE.map(([s, sec]) => [s, sec]));
  const SYMBOLS = UNIVERSE.map(u => u[0]);
  const BOARD_SIZE = 20;

  const state = {
    view: 'boards',
    sym: SYMBOLS[0],
    tf: 5,
    clock: null,
    phase: null,
    results: new Map(),
    lastUpdate: 0,
  };

  const feed = createFeed();

  // ---------- Formatting ----------
  const pct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const cls = v => (v >= 0 ? 'up' : 'down');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtQty(v) {
    const a = Math.abs(v);
    if (a >= 1e7) return (v / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return (v / 1e5).toFixed(2) + ' L';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + ' K';
    return String(Math.round(v));
  }
  const fmtINR = v => (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  // ---------- Data ----------
  function refresh() {
    const now = Date.now();
    state.clock = feed.update(now);
    for (const sym of SYMBOLS) {
      const c5 = aggregate(feed.minutes(sym), 5);
      state.results.set(sym, { sym, sector: SECTOR[sym], ...OB.engine.analyze(c5) });
    }
    state.lastUpdate = now;
    renderStatus();
    renderBoards();
    if (state.view === 'chart') renderChart(false);
    if (state.view === 'xray') renderXRay();
  }

  function ranked(bias) {
    return [...state.results.values()]
      .filter(r => r.bias === bias)
      .sort((a, b) => b.liquidity - a.liquidity || b.strength - a.strength)
      .slice(0, BOARD_SIZE);
  }

  // ---------- Status ----------
  function renderStatus() {
    const c = state.clock;
    const pill = $('#mkt-status');
    const day = fmtDay(Date.parse(c.current + 'T09:15:00+05:30'));
    const label = {
      live: 'Live · NSE F&O',
      closed: `Closed · ${day} close`,
      preopen: `Pre-open · ${day} close`,
      weekend: `Weekend · ${day} close`,
    }[c.phase];
    pill.textContent = label;
    pill.className = 'pill' + (c.phase === 'live' ? ' live' : '');
  }

  function renderClock() {
    const d = new Date(Date.now() + OB.data.IST_OFFSET);
    $('#clock').textContent = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':') + ' IST';
  }

  // ---------- Boards ----------
  function renderSummary() {
    const all = [...state.results.values()];
    const bull = all.filter(r => r.bias === 'bull').length;
    const bear = all.filter(r => r.bias === 'bear').length;
    const chop = all.filter(r => r.choppy).length;
    const adv = all.filter(r => r.chg > 0).length;
    const dec = all.filter(r => r.chg < 0).length;
    const settling = all.some(r => r.settling);
    const upd = state.lastUpdate ? fmtTime(state.lastUpdate) : '—';
    $('#summary').innerHTML = `
      <div class="stat bull"><small>Bullish</small><b>${bull}</b><span>active bull order blocks</span></div>
      <div class="stat bear"><small>Bearish</small><b>${bear}</b><span>active bear order blocks</span></div>
      <div class="stat"><small>Neutral / choppy</small><b>${all.length - bull - bear}</b><span>${chop} choppy · score 0</span></div>
      <div class="stat"><small>Advance / decline</small><b>${adv} <span class="muted">/</span> ${dec}</b>
        <div class="breadth"><i class="b-up" style="width:${adv / all.length * 100}%"></i><i class="b-dn" style="width:${dec / all.length * 100}%"></i></div></div>
      <div class="stat"><small>${settling ? 'Rankings settling' : 'Last update'}</small><b class="mono" style="font-size:18px">${upd}</b><span>${all.length} F&amp;O stocks scanned</span></div>`;
  }

  function boardRows(list, bias) {
    if (!list.length) {
      const msg = [...state.results.values()].some(r => r.settling)
        ? 'Rankings settle after the first few minutes of price action.'
        : `No ${bias === 'bull' ? 'bullish' : 'bearish'} order blocks right now.`;
      return `<div class="empty">${msg}</div>`;
    }
    return list.map((r, i) => {
      const ob = r.levels.ob;
      return `<button class="row" type="button" data-sym="${esc(r.sym)}">
        <span class="rank">${i + 1}</span>
        <span class="sym"><b>${esc(r.sym)}</b><small>${r.sector} · ${r.buildup}</small></span>
        <span class="ltp"><b>${fmtPx(r.ltp)}</b><small class="${cls(r.chg)}">${pct(r.chg)}</small></span>
        <span class="zone">${fmtPx(ob.bottom)}–${fmtPx(ob.top)}<small>S ${fmtPx(r.levels.support)} · R ${fmtPx(r.levels.resistance)}</small></span>
        <span class="score"><span class="bar"><i style="width:${r.liquidity}%"></i></span><b>${r.liquidity}</b></span>
      </button>`;
    }).join('');
  }

  function renderBoards() {
    renderSummary();
    const bull = ranked('bull'), bear = ranked('bear');
    $('#bull-board').innerHTML = boardRows(bull, 'bull');
    $('#bear-board').innerHTML = boardRows(bear, 'bear');
    $('#bull-count').textContent = bull.length;
    $('#bear-count').textContent = bear.length;
  }

  // ---------- Chart ----------
  let chart = null;

  function chartLevels(r) {
    if (!r.levels) return [];
    const L = r.levels;
    return [
      { price: L.resistance, label: 'Resistance', color: cssVar('--bear') },
      { price: L.support, label: 'Support', color: cssVar('--bull') },
      { price: L.liquidity, label: 'Liquidity', color: cssVar('--liq'), dash: [2, 3] },
    ];
  }

  function renderChart(reset) {
    if (!chart) chart = new OB.CandleChart($('#price-chart'), $('#chart-tip'));
    const r = state.results.get(state.sym);
    const candles = aggregate(feed.minutes(state.sym), state.tf);
    const blocks = state.tf === 5 ? r.blocks : OB.engine.detectBlocks(candles).blocks;
    chart.setData(candles, { blocks, levels: chartLevels(r) }, reset);
    renderChartSide(r, blocks, candles);
  }

  function ladder(r) {
    if (!r.levels) {
      const why = r.settling ? 'Waiting for the session to settle.'
        : r.choppy ? 'Choppy price action. Liquidity score is zero.'
        : 'No active order block in the dominant direction.';
      return `<p class="muted" style="font-size:13px">${why}</p>`;
    }
    const L = r.levels;
    const items = [
      { p: L.resistance, cls: 'res', name: 'Resistance' },
      { p: (L.ob.top + L.ob.bottom) / 2, cls: 'ob ' + r.bias, name: 'Order Block', txt: `${fmtPx(L.ob.bottom)}–${fmtPx(L.ob.top)}` },
      { p: L.support, cls: 'sup', name: 'Support' },
      { p: L.liquidity, cls: 'liq', name: 'Liquidity' },
      { p: r.ltp, cls: 'ltp', name: 'LTP' },
    ].sort((a, b) => b.p - a.p);
    return '<ul class="ladder">' + items.map(it => it.cls === 'ltp'
      ? `<li class="ltp">▸ LTP <b>${fmtPx(r.ltp)}</b></li>`
      : `<li class="${it.cls}"><span>${it.name}</span><b>${it.txt || fmtPx(it.p)}</b></li>`).join('') + '</ul>';
  }

  function meter(label, v) {
    const n = Math.round(v * 100);
    return `<div class="meter"><span>${label}</span><span class="bar"><i style="width:${n}%"></i></span><b>${n}</b></div>`;
  }

  function renderChartSide(r, blocks, candles) {
    const badge = r.bias === 'bull' ? '<span class="badge bull">▲ Bullish</span>'
      : r.bias === 'bear' ? '<span class="badge bear">▼ Bearish</span>'
      : `<span class="badge neutral">${r.choppy ? 'Choppy' : r.settling ? 'Settling' : 'Neutral'}</span>`;
    const c = r.components;
    const recent = blocks.slice(-10).reverse();
    $('#chart-side').innerHTML = `
      <div class="panel">
        <div class="quote">
          <div><h2>${esc(r.sym)}</h2><div class="sector">${r.sector} · ${r.buildup}</div>${badge}</div>
          <div class="px"><b>${fmtPx(r.ltp)}</b><span class="${cls(r.chg)}">${pct(r.chg)}</span></div>
        </div>
      </div>
      <div class="panel"><h3>Zones</h3>${ladder(r)}</div>
      <div class="panel">
        <h3>Liquidity score</h3>
        <div class="score-big"><b>${r.liquidity}</b><span>/ 100 · strength ${r.strength}</span></div>
        ${c ? meter('Order block', c.obQ) + meter('Trend efficiency', c.trend) + meter('Momentum', c.mom) + meter('OI confirmation', c.oiConf)
            : '<p class="muted" style="font-size:13px">No score while neutral.</p>'}
      </div>
      <div class="panel">
        <h3>Session</h3>
        <div class="kv">
          <div><small>Open interest</small><b>${fmtQty(r.oi)}</b></div>
          <div><small>OI change</small><b class="${cls(r.oiChg)}">${pct(r.oiChg)}</b></div>
          <div><small>Day high</small><b>${fmtPx(r.dayHigh)}</b></div>
          <div><small>Day low</small><b>${fmtPx(r.dayLow)}</b></div>
          <div><small>VWAP</small><b>${fmtPx(r.vwap)}</b></div>
          <div><small>RSI (14, 5m)</small><b>${r.rsi.toFixed(1)}</b></div>
          <div><small>ATR (14, 5m)</small><b>${fmtPx(r.atr)}</b></div>
          <div><small>Volume</small><b>${fmtQty(r.volume)}</b></div>
        </div>
      </div>
      <div class="panel">
        <h3>Detected order blocks · ${state.tf}m</h3>
        <div class="blist">${recent.length ? recent.map(b => `
          <div><span class="tag ${b.type}">${b.type === 'bull' ? 'BULL' : 'BEAR'}</span>
          <span>${fmtPx(b.bottom)}–${fmtPx(b.top)} <span class="muted">· ${fmtDay(candles[b.i].t)} ${fmtTime(candles[b.i].t)}</span></span>
          <span class="st ${b.status}">${b.status}</span></div>`).join('')
          : '<p class="muted" style="font-size:13px">None detected.</p>'}
        </div>
      </div>`;
  }

  function setSymbol(sym) {
    state.sym = sym;
    $('#sym-select').value = sym;
    if (location.hash !== '#/chart/' + encodeURIComponent(sym)) {
      history.replaceState(null, '', '#/chart/' + encodeURIComponent(sym));
    }
    renderChart(true);
  }

  // ---------- X-Ray ----------
  let xray = null;

  function renderXRay() {
    if (!xray) xray = new OB.XRayChart($('#xray-canvas'), $('#xray-tip'), sym => go('chart', sym));
    const all = [...state.results.values()];
    xray.setData(all.map(r => ({
      sym: r.sym, sector: r.sector, x: r.chg, y: r.oiChg, liq: r.liquidity, bias: r.bias, buildup: r.buildup,
    })));

    const quad = name => all.filter(r => r.buildup === name).length;
    const sectors = {};
    for (const r of all) (sectors[r.sector] = sectors[r.sector] || []).push(r.chg);
    const rows = Object.entries(sectors)
      .map(([s, v]) => [s, v.reduce((a, b) => a + b, 0) / v.length])
      .sort((a, b) => b[1] - a[1]);
    const maxAbs = Math.max(0.5, ...rows.map(r => Math.abs(r[1])));
    const chip = r => `<button class="chip ${r.bias === 'neutral' ? '' : r.bias}" type="button" data-sym="${esc(r.sym)}">${esc(r.sym)} ${pct(r.chg)}</button>`;
    const gainers = [...all].sort((a, b) => b.chg - a.chg).slice(0, 5);
    const losers = [...all].sort((a, b) => a.chg - b.chg).slice(0, 5);

    $('#xray-side').innerHTML = `
      <div class="panel">
        <h3>OI build-up</h3>
        <div class="quad">
          <div><small>Long Buildup</small><b class="up">${quad('Long Buildup')}</b></div>
          <div><small>Short Buildup</small><b class="down">${quad('Short Buildup')}</b></div>
          <div><small>Short Covering</small><b class="up">${quad('Short Covering')}</b></div>
          <div><small>Long Unwinding</small><b class="down">${quad('Long Unwinding')}</b></div>
        </div>
      </div>
      <div class="panel">
        <h3>Sectors · leading to lagging</h3>
        <div class="sectors">${rows.map(([s, v]) => {
          const w = Math.abs(v) / maxAbs * 50;
          const pos = v >= 0 ? `left:50%;width:${w}%;background:var(--bull-strong)` : `left:${50 - w}%;width:${w}%;background:var(--bear-strong)`;
          return `<div class="sector-row"><span>${s}</span><span class="track"><i style="${pos}"></i></span><b class="${cls(v)}">${pct(v)}</b></div>`;
        }).join('')}</div>
      </div>
      <div class="panel"><h3>Top gainers</h3><div class="chips">${gainers.map(chip).join('')}</div></div>
      <div class="panel"><h3>Top losers</h3><div class="chips">${losers.map(chip).join('')}</div></div>`;
  }

  // ---------- Journal ----------
  function renderJournal() {
    const list = OB.journal.load();
    const s = OB.journal.stats(list);
    $('#journal-stats').innerHTML = `
      <div class="stat"><small>Trades</small><b>${s.total}</b><span>${s.open} open</span></div>
      <div class="stat"><small>Win rate</small><b>${s.winRate == null ? '—' : s.winRate.toFixed(0) + '%'}</b><span>closed trades</span></div>
      <div class="stat ${s.net >= 0 ? 'bull' : 'bear'}"><small>Net P&amp;L</small><b>${fmtINR(s.net)}</b><span>realised</span></div>
      <div class="stat"><small>Avg R</small><b>${s.avgR == null ? '—' : s.avgR.toFixed(2) + 'R'}</b><span>per closed trade</span></div>`;

    const table = $('#journal-table');
    if (!list.length) {
      table.innerHTML = '<tbody><tr><td class="empty" colspan="11">No trades yet. Log one with the form.</td></tr></tbody>';
      return;
    }
    table.innerHTML = `<thead><tr>
        <th>Date</th><th>Stock</th><th>Side</th><th class="num">Qty</th><th class="num">Entry</th>
        <th class="num">SL</th><th class="num">Exit</th><th class="num">P&amp;L</th><th class="num">R</th><th>Setup</th><th></th>
      </tr></thead><tbody>${list.map((t, i) => {
        const m = OB.journal.metrics(t);
        return `<tr title="${esc(t.notes || '')}">
          <td>${esc(t.date)}</td><td><b>${esc(t.sym)}</b></td>
          <td class="${t.side === 'long' ? 'up' : 'down'}">${t.side === 'long' ? 'Long' : 'Short'}</td>
          <td class="num">${t.qty}</td><td class="num">${fmtPx(t.entry)}</td><td class="num">${fmtPx(t.sl)}</td>
          <td class="num">${t.exit == null ? '<span class="muted">open</span>' : fmtPx(t.exit)}</td>
          <td class="num ${m.pnl == null ? '' : cls(m.pnl)}">${m.pnl == null ? '—' : fmtINR(m.pnl)}</td>
          <td class="num">${m.r == null ? '—' : m.r.toFixed(2)}</td>
          <td>${esc(t.setup)}</td>
          <td><button class="del" type="button" data-del="${i}" aria-label="Delete trade">×</button></td>
        </tr>`;
      }).join('')}</tbody>`;
  }

  function initJournal() {
    const form = $('#journal-form');
    const jsym = $('#j-sym');
    jsym.innerHTML = SYMBOLS.map(s => `<option>${esc(s)}</option>`).join('');
    form.date.value = state.clock ? state.clock.current : '';

    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(form);
      const num = k => (f.get(k) === '' ? null : Number(f.get(k)));
      const list = OB.journal.load();
      list.unshift({
        date: f.get('date'), sym: f.get('sym'), side: f.get('side'), qty: num('qty'),
        entry: num('entry'), sl: num('sl'), target: num('target'), exit: num('exit'),
        setup: f.get('setup'), notes: String(f.get('notes') || '').trim(),
      });
      OB.journal.save(list);
      form.reset();
      form.date.value = state.clock.current;
      renderJournal();
    });

    $('#j-fill').addEventListener('click', () => {
      const r = state.results.get(state.sym);
      jsym.value = r.sym;
      form.side.value = r.bias === 'bear' ? 'short' : 'long';
      form.entry.value = r.ltp.toFixed(2);
      if (r.levels) {
        form.sl.value = (r.bias === 'bear' ? r.levels.resistance : r.levels.support).toFixed(2);
        form.target.value = (r.bias === 'bear' ? r.levels.support : r.levels.resistance).toFixed(2);
        form.setup.value = r.bias === 'bear' ? 'Bearish OB retest' : 'Bullish OB retest';
      }
    });

    $('#journal-table').addEventListener('click', e => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const list = OB.journal.load();
      list.splice(Number(b.dataset.del), 1);
      OB.journal.save(list);
      renderJournal();
    });

    $('#j-export').addEventListener('click', () => {
      const blob = new Blob([OB.journal.toCSV(OB.journal.load())], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ob-journal.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  // ---------- Routing ----------
  function go(view, sym) {
    location.hash = '#/' + view + (sym ? '/' + encodeURIComponent(sym) : '');
  }

  function route() {
    const [, view = 'boards', sym] = location.hash.split('/');
    state.view = ['boards', 'chart', 'xray', 'journal'].includes(view) ? view : 'boards';
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + state.view));
    document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-selected', String(a.dataset.view === state.view)));
    if (state.view === 'chart') {
      const s = sym ? decodeURIComponent(sym) : state.sym;
      state.sym = SYMBOLS.includes(s) ? s : state.sym;
      $('#sym-select').value = state.sym;
      requestAnimationFrame(() => renderChart(true));
    } else if (state.view === 'xray') {
      requestAnimationFrame(renderXRay);
    } else if (state.view === 'journal') {
      renderJournal();
    }
  }

  // ---------- Theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('obs.theme', t); } catch (e) { /* ignore */ }
    chart && chart.refreshTheme();
    xray && xray.refreshTheme();
    if (state.view === 'chart') renderChart(false);
  }

  function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // ---------- Init ----------
  function init() {
    const sel = $('#sym-select');
    const bySector = {};
    for (const [s, sec] of UNIVERSE) (bySector[sec] = bySector[sec] || []).push(s);
    sel.innerHTML = Object.entries(bySector).map(([sec, list]) =>
      `<optgroup label="${sec}">${list.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</optgroup>`).join('');
    sel.addEventListener('change', () => setSymbol(sel.value));
    const step = d => setSymbol(SYMBOLS[(SYMBOLS.indexOf(state.sym) + d + SYMBOLS.length) % SYMBOLS.length]);
    $('#sym-prev').addEventListener('click', () => step(-1));
    $('#sym-next').addEventListener('click', () => step(1));

    $('#tf-seg').addEventListener('click', e => {
      const b = e.target.closest('[data-tf]');
      if (!b) return;
      state.tf = Number(b.dataset.tf);
      document.querySelectorAll('#tf-seg button').forEach(x => x.classList.toggle('on', x === b));
      renderChart(true);
    });
    for (const k of ['zones', 'levels', 'mitigated', 'volume']) {
      $('#opt-' + k).addEventListener('change', e => chart && chart.setOptions({ [k]: e.target.checked }));
    }
    $('#zoom-in').addEventListener('click', () => chart && chart.zoom(1.25));
    $('#zoom-out').addEventListener('click', () => chart && chart.zoom(1 / 1.25));
    $('#zoom-reset').addEventListener('click', () => { if (chart) { chart.resetView(); chart.draw(); } });

    document.addEventListener('click', e => {
      const row = e.target.closest('.row[data-sym], .chip[data-sym]');
      if (row) go('chart', row.dataset.sym);
    });

    $('#theme-toggle').addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      chart && chart.refreshTheme();
      xray && xray.refreshTheme();
    });

    refresh();
    state.phase = state.clock.phase;
    initJournal();
    window.addEventListener('hashchange', route);
    route();

    renderClock();
    setInterval(renderClock, 1000);
    // Live: re-scan every 3s. Otherwise only re-scan when the session flips.
    setInterval(() => {
      const c = OB.data.marketClock(Date.now());
      if (c.phase === 'live' || c.phase !== state.phase || c.current !== state.clock.current) {
        state.phase = c.phase;
        refresh();
      }
    }, 3000);
  }

  init();
})(window);
