// charts.js — Canvas2D time-series: population lines + trait small multiples (mean line, min–max band).
// One shared hover index drives a crosshair across every chart.
(function (SM) {
  'use strict';
  const INK = { primary: '#f0efec', secondary: '#c3c2b7', muted: '#8f8e86', grid: '#2b2b29', axis: '#46463f' };

  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  const fmtT = (t) => (t >= 1000 ? (t / 1000).toFixed(t >= 10000 ? 0 : 1) + 'k' : String(t));
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  class Charts {
    constructor(popCanvas, popLegend, traitGrid) {
      this.pop = popCanvas; this.legend = popLegend; this.grid = traitGrid;
      this.hover = -1; this.hist = []; this.lastLen = -1;
      const Cc = SM.COLORS;
      this.popSeries = [
        { k: 'free',   label: 'Free hosts',  color: Cc.host },
        { k: 'slaves', label: 'Slaves',      color: Cc.slave },
        { k: 'poly',   label: 'Slavemakers', color: Cc.slaver },
        { k: 'las',    label: 'Lasius',      color: Cc.lasius },
      ];
      // trait small multiples: host traits in host blue, slavemaker traits in slavemaker orange
      this.traits = [];
      const add = (sp, k, color) => {
        const d = SM.TRAITS[sp].find(t => t.k === k);
        this.traits.push({ sp, k, d, color, key: sp === SM.SP.F ? 'F' : sp === SM.SP.P ? 'P' : 'L' });
      };
      add(SM.SP.F, 'aggr', Cc.host); add(SM.SP.F, 'flee', Cc.host); add(SM.SP.F, 'rebel', Cc.host); add(SM.SP.F, 'repro', Cc.host);
      add(SM.SP.P, 'appease', Cc.slaver); add(SM.SP.P, 'want', Cc.slaver); add(SM.SP.P, 'recruit', Cc.slaver); add(SM.SP.P, 'range', Cc.slaver);
      add(SM.SP.P, 'scout', Cc.slaver); add(SM.SP.P, 'repro', Cc.slaver);

      traitGrid.innerHTML = '';
      for (const t of this.traits) {
        const cell = document.createElement('div');
        cell.className = 'trait';
        cell.title = t.d.tip;
        cell.innerHTML = `<div class="trait-head"><span class="trait-name"><i style="background:${t.color}"></i>${t.d.name}</span><span class="trait-val">–</span></div><canvas></canvas>`;
        traitGrid.appendChild(cell);
        t.cv = cell.querySelector('canvas'); t.val = cell.querySelector('.trait-val');
        this.bindHover(t.cv);
      }
      this.bindHover(popCanvas);
      popLegend.innerHTML = this.popSeries.map(s =>
        `<span class="lg"><i style="background:${s.color}"></i>${s.label} <b data-k="${s.k}">–</b></span>`).join('');
    }

    bindHover(cv) {
      cv.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect(), n = this.hist.length;
        if (n < 2) return;
        const pad = cv === this.pop ? 34 : 4;
        const fx = (e.clientX - r.left - pad) / (r.width - pad - 6);
        this.hover = Math.max(0, Math.min(n - 1, Math.round(fx * (n - 1))));
        this.drawAll();
      });
      cv.addEventListener('mouseleave', () => { this.hover = -1; this.drawAll(); });
    }

    update(sim, force) {
      this.hist = sim.history;
      if (!force && this.hist.length === this.lastLen && this.lastHi === sim.history[0]) return;
      this.lastLen = this.hist.length; this.lastHi = sim.history[0];
      this.drawAll();
    }

    drawAll() { this.drawPop(); for (const t of this.traits) this.drawTrait(t); }

    drawPop() {
      const { ctx, w, h } = setupCanvas(this.pop), H = this.hist, n = H.length;
      ctx.clearRect(0, 0, w, h);
      const L = 34, R = 6, T = 8, B = 18, pw = w - L - R, ph = h - T - B;
      let mx = 10;
      for (const s of H) for (const se of this.popSeries) if (s[se.k] > mx) mx = s[se.k];
      mx = niceMax(mx * 1.05);
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = INK.muted; ctx.strokeStyle = INK.grid; ctx.lineWidth = 1;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let g = 0; g <= 4; g++) {
        const yy = T + ph - ph * g / 4;
        ctx.beginPath(); ctx.moveTo(L, Math.round(yy) + 0.5); ctx.lineTo(L + pw, Math.round(yy) + 0.5); ctx.stroke();
        ctx.fillText(String(Math.round(mx * g / 4)), L - 5, yy);
      }
      if (n >= 1) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(fmtT(H[0].t), L, T + ph + 4);
        ctx.textAlign = 'right'; ctx.fillText(fmtT(H[n - 1].t) + ' ticks', L + pw, T + ph + 4);
      }
      if (n < 2) return;
      const X = (i) => L + pw * i / (n - 1), Y = (v) => T + ph - ph * v / mx;
      ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const se of this.popSeries) {
        ctx.strokeStyle = se.color; ctx.beginPath();
        for (let i = 0; i < n; i++) { const v = H[i][se.k]; i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); }
        ctx.stroke();
      }
      const hi = this.hover >= 0 ? this.hover : n - 1;
      if (this.hover >= 0) {
        ctx.strokeStyle = INK.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(X(hi)) + 0.5, T); ctx.lineTo(Math.round(X(hi)) + 0.5, T + ph); ctx.stroke();
        for (const se of this.popSeries) {
          ctx.fillStyle = se.color; ctx.strokeStyle = '#1a1a19'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(X(hi), Y(H[hi][se.k]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = INK.secondary; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('t = ' + fmtT(H[hi].t), Math.min(X(hi) + 6, L + pw - 50), T);
      }
      for (const se of this.popSeries) {
        const el = this.legend.querySelector(`b[data-k="${se.k}"]`);
        if (el) el.textContent = H[hi][se.k];
      }
    }

    drawTrait(t) {
      const { ctx, w, h } = setupCanvas(t.cv), H = this.hist, n = H.length;
      ctx.clearRect(0, 0, w, h);
      const L = 4, R = 6, T = 3, B = 3, pw = w - L - R, ph = h - T - B, lo = t.d.lo, hi = t.d.hi;
      ctx.strokeStyle = INK.grid; ctx.lineWidth = 1;
      for (const f of [0, 0.5, 1]) { const yy = Math.round(T + ph - ph * f) + 0.5; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke(); }
      const hiIdx = this.hover >= 0 ? this.hover : n - 1;
      const cur = n ? H[hiIdx][t.key][t.k] : null;
      t.val.textContent = cur && cur.mean === cur.mean ? (hi > 10 ? cur.mean.toFixed(0) : cur.mean.toFixed(hi < 0.2 ? 3 : 2)) : 'extinct';
      if (n < 2) return;
      const X = (i) => L + pw * i / (n - 1), Y = (v) => T + ph - ph * (v - lo) / (hi - lo);
      // min–max band across living colonies (only over contiguous runs where the species exists)
      ctx.fillStyle = alpha(t.color, 0.2);
      let i = 0;
      while (i < n) {
        while (i < n && !(H[i][t.key][t.k].n > 0)) i++;
        const s = i;
        while (i < n && H[i][t.key][t.k].n > 0) i++;
        if (i - s >= 2) {
          ctx.beginPath();
          for (let k = s; k < i; k++) { const v = H[k][t.key][t.k].max; k === s ? ctx.moveTo(X(k), Y(v)) : ctx.lineTo(X(k), Y(v)); }
          for (let k = i - 1; k >= s; k--) ctx.lineTo(X(k), Y(H[k][t.key][t.k].min));
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.strokeStyle = t.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
      let pen = false;
      for (let k = 0; k < n; k++) {
        const o = H[k][t.key][t.k];
        if (!(o.n > 0)) { pen = false; continue; }
        pen ? ctx.lineTo(X(k), Y(o.mean)) : ctx.moveTo(X(k), Y(o.mean)); pen = true;
      }
      ctx.stroke();
      if (this.hover >= 0) {
        ctx.strokeStyle = INK.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(X(hiIdx)) + 0.5, T); ctx.lineTo(Math.round(X(hiIdx)) + 0.5, T + ph); ctx.stroke();
      }
    }
  }
  SM.Charts = Charts;
})(globalThis.SM);
