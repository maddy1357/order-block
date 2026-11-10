/*
 * Flow dashboard: every stock's intraday path fanning out from the open,
 * linked into ranked bull/bear tiles, build-up profiles and signal cards.
 */
(function (global) {
  'use strict';
  const OB = global.OB;
  const { rgba, niceStep, themeColors, fmtPx } = OB.chartUtil;

  const BARS = OB.data.SESSION_MINUTES / 5;
  const TILES = 18;
  const CARDS = 3;
  const BINS = 16;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const tagOf = r => r.buildup.toUpperCase().replace('BUILDUP', 'BUILD-UP');
  const isDark = () => document.documentElement.getAttribute('data-theme') !== 'light';

  function fmtQty(v) {
    const a = Math.abs(v);
    if (a >= 1e7) return (v / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return (v / 1e5).toFixed(2) + ' L';
    return (v / 1e3).toFixed(1) + ' K';
  }

  function spark(vals, w, h, pad = 1.5) {
    if (vals.length < 2) return '';
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    return 'M' + vals.map((v, i) =>
      (i / (vals.length - 1) * w).toFixed(1) + ',' + (pad + (hi - v) / (hi - lo) * (h - 2 * pad)).toFixed(1)).join('L');
  }

  function ranked(results, bias) {
    return results.filter(r => r.bias === bias)
      .sort((a, b) => b.liquidity - a.liquidity || b.strength - a.strength);
  }

  class FlowBoard {
    constructor(root, onPick) {
      this.root = root;
      this.onPick = onPick;
      this.focus = null;
      this.results = [];
      this.bySym = new Map();
      const q = s => root.querySelector(s);
      this.el = {
        paths: q('.flow-paths canvas'), breadth: q('.flow-breadth canvas'), links: q('.flow-links'),
        tilesBull: q('.tiles.bull'), tilesBear: q('.tiles.bear'),
        profBull: q('.profiles.bull'), profBear: q('.profiles.bear'),
        cardsBull: q('.cards.bull'), cardsBear: q('.cards.bear'),
      };
      this.colors = themeColors();

      new ResizeObserver(() => this.layout()).observe(root);
      root.addEventListener('mouseover', e => {
        const t = e.target.closest('[data-sym]');
        if (t) this.setFocus(t.dataset.sym);
      });
      root.addEventListener('click', e => {
        const t = e.target.closest('[data-sym]');
        if (t) this.onPick(t.dataset.sym);
      });
      const pc = this.el.paths;
      pc.addEventListener('pointermove', e => this.hoverPaths(e.offsetX, e.offsetY));
      pc.addEventListener('click', () => { if (this.focus) this.onPick(this.focus); });
    }

    refreshTheme() { this.colors = themeColors(); this.draw(); }

    update(results) {
      this.results = results;
      this.bySym = new Map(results.map(r => [r.sym, r]));
      this.bull = ranked(results, 'bull');
      this.bear = ranked(results, 'bear');
      if (!this.focus || !this.bySym.has(this.focus)) this.focus = (this.bull[0] || this.bear[0] || results[0]).sym;
      this.renderDom();
      this.layout();
    }

    setFocus(sym) {
      if (sym === this.focus) return;
      this.focus = sym;
      this.root.querySelectorAll('[data-sym]').forEach(n => n.classList.toggle('focus', n.dataset.sym === sym));
      this.draw();
    }

    // ---------- DOM columns ----------
    tile(r) {
      if (!r) return '<div class="tile empty"></div>';
      const f = r.sym === this.focus ? ' focus' : '';
      return `<button class="tile ${r.bias}${f}" type="button" data-sym="${esc(r.sym)}">
        <span class="t-top"><b>${esc(r.sym)}</b><em>${pct(r.chg)}</em></span>
        <svg viewBox="0 0 100 18" preserveAspectRatio="none"><path d="${spark(r.path, 100, 18)}"/></svg>
        <span class="t-bot"><span>${fmtPx(r.ltp)}</span><i>${r.liquidity}</i></span>
      </button>`;
    }

    profile(r, bias) {
      if (!r) return `<div class="prof ${bias} empty"></div>`;
      const s = r.session;
      let lo = Math.min(...s.map(k => k.l)), hi = Math.max(...s.map(k => k.h));
      const ob = r.levels.ob;
      lo = Math.min(lo, ob.bottom); hi = Math.max(hi, ob.top);
      const span = hi - lo || 1;
      const bins = new Array(BINS).fill(0);
      for (const k of s) bins[Math.min(BINS - 1, Math.floor((hi - k.c) / span * BINS))] += k.v;
      const vmax = Math.max(...bins) || 1;
      const H = 160, bh = H / BINS;
      const y = p => (hi - p) / span * H;
      const bars = bins.map((v, i) =>
        `<rect x="${(60 - v / vmax * 58).toFixed(1)}" y="${(i * bh + 0.6).toFixed(1)}" width="${(v / vmax * 58).toFixed(1)}" height="${(bh - 1.2).toFixed(1)}"/>`).join('');
      const f = r.sym === this.focus ? ' focus' : '';
      return `<div class="prof ${bias}${f}" data-sym="${esc(r.sym)}">
        <span class="p-tag">${tagOf(r)}</span>
        <svg viewBox="0 0 60 ${H}" preserveAspectRatio="none">
          <rect class="zone" x="0" y="${y(ob.top).toFixed(1)}" width="60" height="${Math.max(1.5, y(ob.bottom) - y(ob.top)).toFixed(1)}"/>
          <g class="bars">${bars}</g>
          <line x1="0" x2="60" y1="${y(r.ltp).toFixed(1)}" y2="${y(r.ltp).toFixed(1)}"/>
        </svg>
        <span class="p-val">OI ${pct(r.oiChg)}</span>
      </div>`;
    }

    card(r, bias) {
      const label = bias === 'bull' ? 'BULL' : 'BEAR';
      if (!r) {
        return `<article class="fcard ${bias} empty"><span class="bb">${label}</span><span class="muted">No signal</span></article>`;
      }
      const L = r.levels;
      const s = r.session.map(k => k.c);
      let lo = Math.min(...s, L.ob.bottom), hi = Math.max(...s, L.ob.top);
      const W = 120, H = 34;
      const y = p => (1.5 + (hi - p) / (hi - lo || 1) * (H - 3)).toFixed(1);
      const key = bias === 'bull'
        ? [['S1', L.support, 'y'], ['R1', L.resistance, ''], ['R2', L.target2, '']]
        : [['R1', L.resistance, 'y'], ['S1', L.support, ''], ['S2', L.target2, '']];
      const f = r.sym === this.focus ? ' focus' : '';
      return `<article class="fcard ${bias}${f}" data-sym="${esc(r.sym)}" title="${esc(r.sym)} · ${r.sector}">
        <header>
          <span class="bb">${label}</span>
          <span class="fc-sym"><b>${esc(r.sym)}</b></span>
          <span class="fc-tag">${tagOf(r)}</span>
        </header>
        <div class="fc-mid">
          <div class="fc-px"><span><b>${fmtPx(r.ltp)}</b><em>${pct(r.chg)}</em></span>
            <small>OI ${fmtQty(r.oi)} · Δ ${pct(r.oiChg)}</small></div>
          <svg class="fc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <rect class="zone" x="0" y="${y(L.ob.top)}" width="${W}" height="${Math.max(1.5, y(L.ob.bottom) - y(L.ob.top))}"/>
            <path d="${spark(s, W, H)}"/>
          </svg>
        </div>
        <div class="fc-grid">
          <span><small>ZONE</small><b>${fmtPx(L.ob.bottom)}–${fmtPx(L.ob.top)}</b></span>
          ${key.map(([k, v, c]) => `<span><small>${k}</small><b class="${c}">${fmtPx(v)}</b></span>`).join('')}
        </div>
        <footer>
          <span><small>RISK</small><b>${L.risk.toFixed(2)}%</b></span>
          <span><small>R:R</small><b>1:${L.rr.toFixed(1)}</b></span>
          <span class="fc-score"><span class="bar"><i style="width:${r.liquidity}%"></i></span><b>${r.liquidity}</b></span>
        </footer>
      </article>`;
    }

    renderDom() {
      const slots = (list, n) => Array.from({ length: n }, (_, i) => list[i] || null);
      const { el } = this;
      el.tilesBull.innerHTML = slots(this.bull, TILES).map(r => this.tile(r)).join('');
      el.tilesBear.innerHTML = slots(this.bear, TILES).map(r => this.tile(r)).join('');
      el.profBull.innerHTML = slots(this.bull, CARDS).map(r => this.profile(r, 'bull')).join('');
      el.profBear.innerHTML = slots(this.bear, CARDS).map(r => this.profile(r, 'bear')).join('');
      el.cardsBull.innerHTML = slots(this.bull, CARDS).map(r => this.card(r, 'bull')).join('');
      el.cardsBear.innerHTML = slots(this.bear, CARDS).map(r => this.card(r, 'bear')).join('');
    }

    // ---------- Canvases ----------
    fit(cv) {
      const r = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w: r.width, h: r.height };
    }

    layout() {
      if (!this.results.length || !this.root.offsetParent) return;
      this.draw();
    }

    draw() {
      if (!this.results.length || !this.root.offsetParent) return;
      this.drawBreadth();
      this.drawPaths();
      this.drawLinks();
    }

    colorOf(bias, C) { return bias === 'bull' ? C.bull : bias === 'bear' ? C.bear : C.text; }

    drawBreadth() {
      const { ctx, w, h } = this.fit(this.el.breadth);
      const C = this.colors;
      ctx.clearRect(0, 0, w, h);
      const n = Math.max(...this.results.map(r => r.path.length));
      const total = this.results.length;
      const bw = (w - 18) / BARS;
      const mid = h / 2;
      for (let i = 0; i < n; i++) {
        let up = 0, dn = 0;
        for (const r of this.results) {
          const v = r.path[i];
          if (v > 0) up++; else if (v < 0) dn++;
        }
        const x = 8 + i * bw;
        ctx.fillStyle = rgba(C.bull, 0.75);
        ctx.fillRect(x, mid - up / total * (mid - 1), Math.max(1, bw - 1), up / total * (mid - 1));
        ctx.fillStyle = rgba(C.bear, 0.75);
        ctx.fillRect(x, mid + 1, Math.max(1, bw - 1), dn / total * (mid - 2));
      }
    }

    drawPaths() {
      const { ctx, w, h } = this.fit(this.el.paths);
      const C = this.colors;
      const dark = isDark();
      ctx.clearRect(0, 0, w, h);
      const padL = 8, padR = 10, padT = 14;
      let maxAbs = 1;
      for (const r of this.results) for (const v of r.path) maxAbs = Math.max(maxAbs, Math.abs(v));
      maxAbs *= 1.08;
      const X = i => padL + i / (BARS - 1) * (w - padL - padR);
      const Y = v => h / 2 - v / maxAbs * (h / 2 - padT);
      this.geo = { X, Y, w, h };

      // Grid
      ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      const step = niceStep(maxAbs * 2, 8);
      for (let v = step; v < maxAbs; v += step) {
        for (const s of [1, -1]) {
          const yy = Math.round(Y(v * s)) + 0.5;
          ctx.strokeStyle = rgba(C.line, 0.1);
          ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
          ctx.fillStyle = rgba(C.text, 0.6);
          ctx.fillText((s > 0 ? '+' : '−') + v.toFixed(step < 1 ? 1 : 0) + '%', w - padR - 2, yy - 7);
        }
      }
      ctx.strokeStyle = rgba(C.text, 0.35);
      ctx.beginPath(); ctx.moveTo(padL, Math.round(h / 2) + 0.5); ctx.lineTo(w - padR, Math.round(h / 2) + 0.5); ctx.stroke();

      // "Now" line
      const n = Math.max(...this.results.map(r => r.path.length));
      const nx = Math.round(X(n - 1)) + 0.5;
      ctx.strokeStyle = rgba(C.fg, dark ? 0.55 : 0.4);
      ctx.beginPath(); ctx.moveTo(nx, 4); ctx.lineTo(nx, h - 4); ctx.stroke();

      // Leaders / laggards lists in the empty corners
      ctx.textAlign = 'left';
      const list = (items, y0, dir, col) => items.forEach((r, i) => {
        const yy = y0 + dir * i * 14;
        ctx.fillStyle = rgba(C.text, 0.75);
        ctx.fillText(r.sym, padL + 4, yy);
        ctx.fillStyle = rgba(col, 0.9);
        ctx.fillText(pct(r.chg), padL + 92, yy);
      });
      const byChg = [...this.results].sort((a, b) => b.chg - a.chg);
      const rows = Math.max(3, Math.min(9, Math.floor((h / 2 - 60) / 14 * 0.6)));
      list(byChg.slice(0, rows), padT + 6, 1, C.bull);
      list(byChg.slice(-rows).reverse(), h - padT - 6, -1, C.bear);

      // Paths
      ctx.save();
      if (dark) ctx.globalCompositeOperation = 'lighter';
      for (const r of this.results) {
        if (r.sym === this.focus || r.path.length < 2) continue;
        ctx.strokeStyle = rgba(this.colorOf(r.bias, C), r.bias === 'neutral' ? 0.1 : 0.26);
        ctx.lineWidth = 1;
        ctx.beginPath();
        r.path.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
        ctx.stroke();
      }
      ctx.restore();

      // Focused path with glow and area fill
      const f = this.bySym.get(this.focus);
      if (f && f.path.length > 1) {
        const col = f.bias === 'bear' ? C.bear : f.bias === 'bull' ? C.bull : C.fg;
        const grad = ctx.createLinearGradient(0, Y(0), 0, Y(f.chg));
        grad.addColorStop(0, rgba(col, 0));
        grad.addColorStop(1, rgba(col, 0.16));
        ctx.beginPath();
        ctx.moveTo(X(0), Y(0));
        f.path.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
        ctx.lineTo(X(f.path.length - 1), Y(0));
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = dark ? 14 : 4;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        f.path.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
        ctx.stroke();
        const ex = X(f.path.length - 1), ey = Y(f.path[f.path.length - 1]);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = col;
        ctx.textAlign = 'right';
        ctx.fillText(`${f.sym} ${pct(f.chg)}`, ex - 8, ey + (f.chg >= 0 ? -12 : 12));
      }

      // Origin
      ctx.save();
      ctx.shadowColor = C.bull;
      ctx.shadowBlur = dark ? 12 : 0;
      ctx.fillStyle = dark ? '#d9fff0' : C.bull;
      ctx.beginPath(); ctx.arc(X(0), Y(0), 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    hoverPaths(mx, my) {
      if (!this.geo) return;
      const { X, Y } = this.geo;
      const i = Math.round((mx - X(0)) / (X(1) - X(0)));
      let best = null, bd = 10;
      for (const r of this.results) {
        const v = r.path[Math.min(Math.max(0, i), r.path.length - 1)];
        if (v === undefined) continue;
        const d = Math.abs(Y(v) - my);
        if (d < bd) { bd = d; best = r; }
      }
      this.el.paths.style.cursor = best ? 'pointer' : 'default';
      if (best) this.setFocus(best.sym);
    }

    drawLinks() {
      const cv = this.el.links;
      if (getComputedStyle(cv).display === 'none') return;
      const { ctx, w, h } = this.fit(cv);
      const C = this.colors;
      const dark = isDark();
      ctx.clearRect(0, 0, w, h);
      if (!this.geo) return;
      const R = this.root.getBoundingClientRect();
      const P = this.el.paths.getBoundingClientRect();
      const rect = n => {
        const r = n.getBoundingClientRect();
        return { l: r.left - R.left, r: r.right - R.left, cy: (r.top + r.bottom) / 2 - R.top, visible: r.width > 0 };
      };
      const find = (box, sym) => box.querySelector(`[data-sym="${CSS.escape(sym)}"]`);
      const curve = (x1, y1, x2, y2) => {
        const mx = x1 + (x2 - x1) * 0.55;
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1, x1 + (x2 - x1) * 0.45, y2, x2, y2);
      };

      const segments = r => {
        const tileBox = r.bias === 'bull' ? this.el.tilesBull : this.el.tilesBear;
        const tile = find(tileBox, r.sym);
        if (!tile) return [];
        const t = rect(tile);
        const sx = P.left - R.left + this.geo.X(r.path.length - 1);
        const sy = P.top - R.top + this.geo.Y(r.path[r.path.length - 1]);
        const segs = [[sx, sy, t.l, t.cy]];
        const card = find(r.bias === 'bull' ? this.el.cardsBull : this.el.cardsBear, r.sym);
        if (card) {
          const c = rect(card);
          const prof = find(r.bias === 'bull' ? this.el.profBull : this.el.profBear, r.sym);
          const p = prof && rect(prof);
          if (p && p.visible) segs.push([t.r, t.cy, p.l, p.cy], [p.r, p.cy, c.l, c.cy]);
          else segs.push([t.r, t.cy, c.l, c.cy]);
        }
        return segs;
      };

      const linked = [...this.bull.slice(0, TILES), ...this.bear.slice(0, TILES)];
      ctx.lineWidth = 1;
      for (const r of linked) {
        if (r.sym === this.focus) continue;
        ctx.strokeStyle = rgba(r.bias === 'bull' ? C.bull : C.bear, dark ? 0.16 : 0.2);
        ctx.beginPath();
        segments(r).forEach(s => curve(...s));
        ctx.stroke();
      }
      const f = this.bySym.get(this.focus);
      if (f && f.bias !== 'neutral') {
        const col = f.bias === 'bull' ? C.bull : C.bear;
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = dark ? 10 : 0;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        segments(f).forEach(s => curve(...s));
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  OB.FlowBoard = FlowBoard;
})(window);
