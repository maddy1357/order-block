/*
 * Market X-Ray: every stock plotted by price change (x) against OI change (y).
 * Quadrants map to the four OI build-up states.
 */
(function (global) {
  'use strict';
  const OB = global.OB = global.OB || {};
  const { rgba, niceStep, themeColors } = OB.chartUtil;

  class XRayChart {
    constructor(canvas, tip, onPick) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.tip = tip;
      this.onPick = onPick;
      this.points = [];
      this.hover = null;
      this.colors = themeColors();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      canvas.addEventListener('pointermove', e => this.move(e.offsetX, e.offsetY));
      canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
      canvas.addEventListener('click', () => { if (this.hover) this.onPick(this.hover.sym); });
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

    setData(points) { this.points = points; this.draw(); }

    move(mx, my) {
      let best = null, bd = 14 * 14;
      for (const p of this.points) {
        const d = (p.px - mx) ** 2 + (p.py - my) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      this.hover = best;
      this.cv.style.cursor = best ? 'pointer' : 'default';
      this.draw();
      const tip = this.tip;
      if (!best) { tip.hidden = true; return; }
      const sign = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
      tip.innerHTML =
        `<b>${best.sym}</b> <span class="muted">${best.sector}</span><br>` +
        `<span class="k">Price</span> <span class="${best.x >= 0 ? 'up' : 'down'}">${sign(best.x)}</span> &nbsp;` +
        `<span class="k">OI</span> ${sign(best.y)}<br>` +
        `${best.buildup} · liquidity ${best.liq}`;
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let tx = mx + 14, ty = my + 14;
      if (tx + tw > this.w) tx = mx - tw - 14;
      if (ty + th > this.h) ty = my - th - 14;
      tip.style.left = Math.max(4, tx) + 'px';
      tip.style.top = Math.max(4, ty) + 'px';
    }

    draw() {
      const { ctx } = this;
      if (!this.w) return;
      const C = this.colors;
      const W = this.w, H = this.h;
      const padL = 46, padR = 16, padT = 16, padB = 34;
      const pw = W - padL - padR, ph = H - padT - padB;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      const xr = Math.max(1, ...this.points.map(p => Math.abs(p.x))) * 1.15;
      const yr = Math.max(1, ...this.points.map(p => Math.abs(p.y))) * 1.15;
      const X = v => padL + (v + xr) / (2 * xr) * pw;
      const Y = v => padT + (yr - v) / (2 * yr) * ph;

      // Quadrant tint
      const q = [
        [0, 0, pw / 2, ph / 2, C.bear, 'Short Buildup'],
        [pw / 2, 0, pw / 2, ph / 2, C.bull, 'Long Buildup'],
        [0, ph / 2, pw / 2, ph / 2, C.bear, 'Long Unwinding'],
        [pw / 2, ph / 2, pw / 2, ph / 2, C.bull, 'Short Covering'],
      ];
      ctx.font = '600 11.5px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'top';
      q.forEach(([x, y, w, h, col, label], idx) => {
        ctx.fillStyle = rgba(col, idx === 0 || idx === 1 ? 0.06 : 0.03);
        ctx.fillRect(padL + x, padT + y, w, h);
        ctx.fillStyle = rgba(col, 0.75);
        ctx.textAlign = idx % 2 ? 'right' : 'left';
        const tx = idx % 2 ? padL + x + w - 10 : padL + x + 10;
        ctx.fillText(label, tx, idx < 2 ? padT + y + 10 : padT + y + h - 22);
      });

      // Grid + axes
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.strokeStyle = C.grid;
      ctx.fillStyle = C.text;
      ctx.lineWidth = 1;
      const xs = niceStep(2 * xr, pw / 80);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let v = Math.ceil(-xr / xs) * xs; v <= xr; v += xs) {
        const xx = Math.round(X(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + ph); ctx.stroke();
        ctx.fillText((v > 0 ? '+' : '') + v.toFixed(xs < 1 ? 1 : 0) + '%', xx, padT + ph + 6);
      }
      const ys = niceStep(2 * yr, ph / 60);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let v = Math.ceil(-yr / ys) * ys; v <= yr; v += ys) {
        const yy = Math.round(Y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + pw, yy); ctx.stroke();
        ctx.fillText((v > 0 ? '+' : '') + v.toFixed(ys < 1 ? 1 : 0) + '%', padL - 6, yy);
      }
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(X(0)) + 0.5, padT); ctx.lineTo(Math.round(X(0)) + 0.5, padT + ph);
      ctx.moveTo(padL, Math.round(Y(0)) + 0.5); ctx.lineTo(padL + pw, Math.round(Y(0)) + 0.5);
      ctx.stroke();
      ctx.lineWidth = 1;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = C.text;
      ctx.fillText('Price change →', padL + pw / 2, H - 2);

      // Points
      for (const p of this.points) {
        p.px = X(p.x);
        p.py = Y(p.y);
        const col = p.bias === 'bull' ? C.bull : p.bias === 'bear' ? C.bear : C.text;
        const r = 3.5 + p.liq / 14;
        ctx.beginPath();
        ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, p.bias === 'neutral' ? 0.35 : 0.55);
        ctx.fill();
        ctx.strokeStyle = rgba(col, 0.95);
        ctx.lineWidth = p === this.hover ? 2.5 : 1;
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      // Labels for the strongest names
      ctx.font = '600 10.5px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C.fg;
      [...this.points].sort((a, b) => b.liq - a.liq).slice(0, 8).forEach(p => {
        ctx.fillText(p.sym, p.px + 6 + p.liq / 14, p.py);
      });
    }
  }

  OB.XRayChart = XRayChart;
})(window);
