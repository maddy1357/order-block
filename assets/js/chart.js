/*
 * Canvas candlestick chart with order-block zones and level lines.
 */
(function (global) {
  'use strict';
  const OB = global.OB = global.OB || {};

  const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function rgba(hex, a) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  function istDate(ms) { return new Date(ms + OB.data.IST_OFFSET); }
  function fmtTime(ms) {
    const d = istDate(ms);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function fmtDay(ms) {
    const d = istDate(ms);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }
  const fmtPx = p => p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function themeColors() {
    return {
      bg: cssVar('--chart-bg'), grid: cssVar('--chart-grid'), text: cssVar('--chart-text'),
      fg: cssVar('--text'), surface: cssVar('--surface'), border: cssVar('--border'),
      bull: cssVar('--bull-strong'), bear: cssVar('--bear-strong'),
      bullText: cssVar('--bull'), bearText: cssVar('--bear'),
      liq: cssVar('--liq'), accent: cssVar('--accent'), line: cssVar('--line'),
    };
  }

  class CandleChart {
    constructor(canvas, tip) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.tip = tip;
      this.data = [];
      this.blocks = [];
      this.levels = [];
      this.opts = { zones: true, levels: true, mitigated: false, volume: true };
      this.barW = 9;
      this.end = null;
      this.mouse = null;
      this.drag = null;
      this.axisW = 72;
      this.timeH = 24;
      this.colors = themeColors();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.bind();
      this.resize();
    }

    refreshTheme() { this.colors = themeColors(); this.draw(); }

    resize() {
      const r = this.cv.parentElement.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      this.cv.style.width = r.width + 'px';
      this.cv.style.height = r.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }

    get plotW() { return this.w - this.axisW; }
    get plotH() { return this.h - this.timeH; }

    setData(data, overlays = {}, reset = false) {
      const prevLen = this.data.length;
      const followEnd = this.end === null || this.end >= prevLen - 1;
      this.data = data;
      this.blocks = overlays.blocks || [];
      this.levels = overlays.levels || [];
      if (reset || this.end === null) this.resetView();
      else if (followEnd && data.length > prevLen) this.end += data.length - prevLen;
      this.draw();
    }

    setOptions(o) { Object.assign(this.opts, o); this.draw(); }

    resetView() {
      this.barW = this.w < 600 ? 6 : 9;
      this.end = this.data.length - 1 + 6;
    }

    zoom(factor, anchorX) {
      const ax = anchorX ?? this.plotW / 2;
      const idx = this.end - (this.plotW - ax) / this.barW;
      this.barW = Math.min(40, Math.max(2, this.barW * factor));
      this.end = idx + (this.plotW - ax) / this.barW;
      this.clampEnd();
      this.draw();
    }

    clampEnd() {
      const n = this.data.length;
      const visible = this.plotW / this.barW;
      this.end = Math.min(n - 1 + visible * 0.6, Math.max(Math.min(visible * 0.4, n - 1), this.end));
    }

    x(i) { return this.plotW - (this.end - i + 0.5) * this.barW; }
    indexAt(px) { return Math.round(this.end + 0.5 - (this.plotW - px) / this.barW); }

    bind() {
      const cv = this.cv;
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.offsetX);
      }, { passive: false });
      cv.addEventListener('pointerdown', e => {
        this.drag = { x: e.offsetX, end: this.end };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener('pointermove', e => {
        if (this.drag) {
          this.end = this.drag.end - (e.offsetX - this.drag.x) / this.barW;
          this.clampEnd();
        }
        this.mouse = { x: e.offsetX, y: e.offsetY };
        this.draw();
      });
      const up = () => { this.drag = null; };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => { this.mouse = null; this.drag = null; this.draw(); });
      cv.addEventListener('dblclick', () => { this.resetView(); this.draw(); });
    }

    draw() {
      const { ctx, data } = this;
      if (!this.w) return;
      const C = this.colors;
      const W = this.w, H = this.h, pw = this.plotW, ph = this.plotH;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      if (!data.length) return;

      const from = Math.max(0, Math.floor(this.end - pw / this.barW));
      const to = Math.min(data.length - 1, Math.ceil(this.end));
      if (to < from) return;

      // Price range: visible candles + active levels/zones
      let lo = Infinity, hi = -Infinity;
      for (let i = from; i <= to; i++) {
        if (data[i].l < lo) lo = data[i].l;
        if (data[i].h > hi) hi = data[i].h;
      }
      const span0 = hi - lo || hi * 0.01;
      const within = p => p > lo - span0 * 1.2 && p < hi + span0 * 1.2;
      if (this.opts.levels) {
        for (const L of this.levels) if (within(L.price)) { lo = Math.min(lo, L.price); hi = Math.max(hi, L.price); }
      }
      const pad = (hi - lo) * 0.08 || 1;
      lo -= pad; hi += pad;

      const volH = this.opts.volume ? ph * 0.16 : 0;
      const priceH = ph - volH - 6;
      const y = p => 8 + (hi - p) / (hi - lo) * (priceH - 8);
      this._y = y; this._lo = lo; this._hi = hi; this._priceH = priceH;

      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      // Horizontal grid + price axis
      const step = niceStep(hi - lo, priceH / 56);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.fillStyle = C.text;
      ctx.textAlign = 'left';
      for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
        const yy = Math.round(y(p)) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke();
        ctx.fillText(fmtPx(p), pw + 8, yy);
      }

      // Time axis + session separators
      const stride = Math.max(1, Math.ceil(84 / this.barW));
      ctx.textAlign = 'center';
      for (let i = from; i <= to; i++) {
        const k = data[i];
        const xx = Math.round(this.x(i)) + 0.5;
        const newSession = i > 0 && data[i - 1].s !== k.s;
        if (newSession) {
          ctx.save();
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = C.border;
          ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, ph); ctx.stroke();
          ctx.restore();
          ctx.fillStyle = C.fg;
          ctx.fillText(fmtDay(k.t), xx, ph + this.timeH / 2);
        } else if (i % stride === 0) {
          ctx.strokeStyle = C.grid;
          ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, ph); ctx.stroke();
          ctx.fillStyle = C.text;
          ctx.fillText(fmtTime(k.t), xx, ph + this.timeH / 2);
        }
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();

      // Volume
      if (volH) {
        let vmax = 0;
        for (let i = from; i <= to; i++) vmax = Math.max(vmax, data[i].v);
        const bw = Math.max(1, this.barW * 0.7);
        for (let i = from; i <= to; i++) {
          const k = data[i];
          const vh = vmax ? k.v / vmax * (volH - 4) : 0;
          ctx.fillStyle = rgba(k.c >= k.o ? C.bull : C.bear, 0.28);
          ctx.fillRect(this.x(i) - bw / 2, ph - vh, bw, vh);
        }
      }

      // Order-block zones
      if (this.opts.zones) {
        for (const b of this.blocks) {
          const mit = b.status === 'mitigated';
          if (mit && !this.opts.mitigated) continue;
          const endIdx = b.end ?? Infinity;
          if (endIdx < from || b.i > to) continue;
          const x1 = this.x(b.i) - this.barW / 2;
          const x2 = b.end === null ? pw : this.x(b.end) + this.barW / 2;
          const y1 = y(b.top), y2 = y(b.bottom);
          const col = b.type === 'bull' ? C.bull : C.bear;
          ctx.fillStyle = rgba(col, mit ? 0.06 : 0.16);
          ctx.fillRect(x1, y1, x2 - x1, Math.max(1, y2 - y1));
          ctx.strokeStyle = rgba(col, mit ? 0.3 : 0.7);
          ctx.setLineDash(mit ? [4, 3] : []);
          ctx.strokeRect(Math.round(x1) + 0.5, Math.round(y1) + 0.5, Math.round(x2 - x1), Math.max(1, Math.round(y2 - y1)));
          ctx.setLineDash([]);
          if (x2 - x1 > 70 && y2 - y1 > 2) {
            ctx.fillStyle = rgba(col, mit ? 0.5 : 0.95);
            ctx.textAlign = 'left';
            ctx.font = '600 10.5px Inter, system-ui, sans-serif';
            const label = (b.type === 'bull' ? 'Bull OB' : 'Bear OB') + (mit ? ' · mitigated' : b.tests ? ` · tested ${b.tests}×` : '');
            ctx.fillText(label, x1 + 5, b.type === 'bull' ? y2 + 8 : y1 - 8);
            ctx.font = '11px Inter, system-ui, sans-serif';
          }
        }
      }

      // Candles
      const bw = Math.max(1, Math.min(this.barW * 0.7, this.barW - 1));
      for (let i = from; i <= to; i++) {
        const k = data[i];
        const xx = this.x(i);
        const col = k.c >= k.o ? C.bull : C.bear;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(Math.round(xx) + 0.5, y(k.h));
        ctx.lineTo(Math.round(xx) + 0.5, y(k.l));
        ctx.stroke();
        const yo = y(k.o), yc = y(k.c);
        ctx.fillRect(xx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
      }

      // Levels
      if (this.opts.levels) {
        for (const L of this.levels) {
          const yy = Math.round(y(L.price)) + 0.5;
          ctx.strokeStyle = L.color;
          ctx.lineWidth = 1.25;
          ctx.setLineDash(L.dash || [6, 4]);
          ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 1;
          ctx.font = '600 10.5px Inter, system-ui, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillStyle = L.color;
          ctx.fillText(L.label, pw - 8, yy - 8);
          ctx.font = '11px Inter, system-ui, sans-serif';
        }
      }

      // Last price line
      const last = data[data.length - 1];
      const ly = Math.round(y(last.c)) + 0.5;
      const lastCol = last.c >= (data[data.length - 2] || last).c ? C.bull : C.bear;
      ctx.strokeStyle = rgba(lastCol, 0.7);
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(pw, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Axis tags (levels, then last price on top)
      if (this.opts.levels) {
        for (const L of this.levels) this.axisTag(L.price, L.color, '#fff');
      }
      this.axisTag(last.c, lastCol, '#fff');

      this.drawCrosshair(from, to);
    }

    axisTag(price, bg, fg) {
      const { ctx } = this;
      const yy = this._y(price);
      if (yy < 0 || yy > this._priceH + 4) return;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(this.plotW + 2, yy - 9, this.axisW - 4, 18, 4) : ctx.rect(this.plotW + 2, yy - 9, this.axisW - 4, 18);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = 'left';
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillText(fmtPx(price), this.plotW + 8, yy);
      ctx.font = '11px Inter, system-ui, sans-serif';
    }

    drawCrosshair(from, to) {
      const { ctx, mouse, data, tip } = this;
      const C = this.colors;
      if (!mouse || mouse.x > this.plotW || mouse.y > this.plotH) { tip.hidden = true; return; }
      const i = Math.min(to, Math.max(from, this.indexAt(mouse.x)));
      const k = data[i];
      if (!k) { tip.hidden = true; return; }
      const xx = Math.round(this.x(i)) + 0.5;
      const yy = Math.round(mouse.y) + 0.5;
      ctx.strokeStyle = rgba(C.text, 0.6);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xx, 0); ctx.lineTo(xx, this.plotH);
      ctx.moveTo(0, yy); ctx.lineTo(this.plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      if (mouse.y <= this._priceH) {
        const p = this._hi - (mouse.y - 8) / (this._priceH - 8) * (this._hi - this._lo);
        this.axisTag(p, C.fg, C.bg);
      }

      const prev = data[i - 1] || k;
      const chg = (k.c / prev.c - 1) * 100;
      const cls = k.c >= k.o ? 'up' : 'down';
      tip.innerHTML =
        `<b>${fmtDay(k.t)} · ${fmtTime(k.t)}</b><br>` +
        `<span class="k">O</span> ${fmtPx(k.o)} &nbsp;<span class="k">H</span> ${fmtPx(k.h)}<br>` +
        `<span class="k">L</span> ${fmtPx(k.l)} &nbsp;<span class="k">C</span> <span class="${cls}">${fmtPx(k.c)}</span> ` +
        `<span class="${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span><br>` +
        `<span class="k">Vol</span> ${k.v.toLocaleString('en-IN')}`;
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let tx = mouse.x + 16, ty = mouse.y + 16;
      if (tx + tw > this.plotW) tx = mouse.x - tw - 16;
      if (ty + th > this.plotH) ty = mouse.y - th - 16;
      tip.style.left = Math.max(4, tx) + 'px';
      tip.style.top = Math.max(4, ty) + 'px';
    }
  }

  OB.CandleChart = CandleChart;
  OB.chartUtil = { cssVar, rgba, niceStep, fmtTime, fmtDay, fmtPx, themeColors };
})(window);
