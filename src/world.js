// world.js — multi-channel pheromone field, food (carcasses, crumbs, honeydew) and aphid plants.
//
// Each chemical signal is its own planar Float32 grid with its own evaporation and diffusion rate,
// loosely matched to the volatility of the real compounds:
//   FTRAIL  Formica recruitment / food trail
//   LTRAIL  Lasius food trail (species do not follow each other's trails)
//   RAID    Polyergus raid trail laid by a returning scout (long-lived; Topoff et al. 1984)
//   ALARM   host alarm signal (formic acid / undecane: very volatile)
//   PROP    Polyergus Dufour's-gland secretion (appeasement; Mori et al. 2000)
(function (SM) {
  'use strict';
  const C = SM.CFG;

  SM.CH = { FTRAIL: 0, LTRAIL: 1, RAID: 2, ALARM: 3, PROP: 4 };
  SM.NCH = 5;
  SM.CH_INFO = [
    { name: 'Formica trail',    decay: 0.988,  diff: 0.10 },
    { name: 'Lasius trail',     decay: 0.988,  diff: 0.10 },
    { name: 'Raid trail',       decay: 0.9975, diff: 0.015 },
    { name: 'Alarm',            decay: 0.90,   diff: 0.35 },
    { name: 'Dufour secretion', decay: 0.965,  diff: 0.25 },
  ];
  const CAP = 12;

  class World {
    constructor() {
      const W = C.W, H = C.H;
      this.W = W; this.H = H;
      this.ph = []; this.tmp = [];
      this.bb = []; this.bbT = [];        // bounding boxes of possibly non-zero cells, per buffer
      for (let c = 0; c < SM.NCH; c++) {
        this.ph.push(new Float32Array(W * H)); this.tmp.push(new Float32Array(W * H));
        this.bb.push(null); this.bbT.push(null);
      }
      this.food = new Float32Array(W * H);
      this.totalFood = 0;
      this.foodDirty = true;
      this.plants = [];                    // {x, y, r, rate, seed}
    }

    idx(x, y) {
      let cx = x | 0, cy = y | 0;
      if (cx < 0) cx = 0; else if (cx >= this.W) cx = this.W - 1;
      if (cy < 0) cy = 0; else if (cy >= this.H) cy = this.H - 1;
      return cy * this.W + cx;
    }
    get(x, y, ch) { return this.ph[ch][this.idx(x, y)]; }
    around(x, y, ch, r) {
      const g = this.ph[ch], W = this.W, H = this.H;
      let s = 0, n = 0;
      for (let yy = (y | 0) - r; yy <= (y | 0) + r; yy++) {
        if (yy < 0 || yy >= H) continue;
        for (let xx = (x | 0) - r; xx <= (x | 0) + r; xx++) {
          if (xx < 0 || xx >= W) continue;
          s += g[yy * W + xx]; n++;
        }
      }
      return n ? s / n : 0;
    }
    deposit(x, y, ch, amt) {
      const k = this.idx(x, y), g = this.ph[ch];
      const v = g[k] + amt;
      g[k] = v > CAP ? CAP : v;
      const cx = k % this.W, cy = (k / this.W) | 0;
      const b = this.bb[ch];
      if (!b) this.bb[ch] = { x0: cx, y0: cy, x1: cx, y1: cy };
      else {
        if (cx < b.x0) b.x0 = cx; else if (cx > b.x1) b.x1 = cx;
        if (cy < b.y0) b.y0 = cy; else if (cy > b.y1) b.y1 = cy;
      }
    }

    // diffusion + evaporation, restricted to each channel's active region
    updateField() {
      const W = this.W, H = this.H;
      for (let c = 0; c < SM.NCH; c++) {
        const A = this.bb[c], Bt = this.bbT[c];
        if (!A && !Bt) continue;
        // region = (non-zero area of the source, grown by one cell) ∪ (stale area of the destination)
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        if (A) { x0 = A.x0 - 1; y0 = A.y0 - 1; x1 = A.x1 + 1; y1 = A.y1 + 1; }
        if (Bt) { x0 = Math.min(x0, Bt.x0); y0 = Math.min(y0, Bt.y0); x1 = Math.max(x1, Bt.x1); y1 = Math.max(y1, Bt.y1); }
        if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > W - 1) x1 = W - 1; if (y1 > H - 1) y1 = H - 1;
        const a = this.ph[c], b = this.tmp[c];
        const D = SM.CH_INFO[c].diff, K = SM.CH_INFO[c].decay, Dq = D * 0.25, keep = 1 - D;
        let nx0 = W, ny0 = H, nx1 = -1, ny1 = -1;
        for (let y = y0; y <= y1; y++) {
          const yr = y * W, yU = (y > 0 ? y - 1 : y) * W, yD = (y < H - 1 ? y + 1 : y) * W;
          for (let x = x0; x <= x1; x++) {
            const k = yr + x;
            const v = a[k];
            const n = a[x > 0 ? k - 1 : k] + a[x < W - 1 ? k + 1 : k] + a[yU + x] + a[yD + x];
            if (v === 0 && n === 0) { b[k] = 0; continue; }
            const nv = (v * keep + n * Dq) * K;
            if (nv < 0.002) { b[k] = 0; continue; }
            b[k] = nv;
            if (x < nx0) nx0 = x; if (x > nx1) nx1 = x;
            if (y < ny0) ny0 = y; if (y > ny1) ny1 = y;
          }
        }
        this.ph[c] = b; this.tmp[c] = a;
        this.bbT[c] = A;   // the old source buffer may hold non-zeros only inside A
        this.bb[c] = nx1 >= 0 ? { x0: nx0, y0: ny0, x1: nx1, y1: ny1 } : null;
      }
    }

    foodAt(x, y) { return this.food[this.idx(x, y)]; }
    takeFood(x, y) {
      const k = this.idx(x, y);
      if (this.food[k] >= 1) { this.food[k] -= 1; this.totalFood -= 1; this.foodDirty = true; return true; }
      return false;
    }
    addFood(x, y, amt) {
      const k = this.idx(x, y);
      this.food[k] += amt; this.totalFood += amt; this.foodDirty = true;
    }

    // dead arthropod / seed cache, placed away from nests
    spawnPatch(colonies, amount) {
      const W = this.W, H = this.H;
      for (let tries = 0; tries < 20; tries++) {
        const x = 8 + SM.rand() * (W - 16), y = 8 + SM.rand() * (H - 16);
        let ok = true;
        for (const c of colonies) if (c.alive && Math.hypot(c.x - x, c.y - y) < 14) { ok = false; break; }
        if (!ok) continue;
        const r = 2 + SM.rand() * 2.5;
        let placed = 0;
        const per = amount / (Math.PI * r * r);
        for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
          for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
            const d = Math.hypot(dx, dy);
            if (d > r) continue;
            const k = this.idx(x + dx, y + dy);
            // whole food items only, so every unit placed can be carried
            const add = Math.min(C.FOOD_CELL_MAX - this.food[k], Math.max(1, Math.round(per * (1.6 - d / r))));
            if (add > 0) { this.food[k] += add; placed += add; }
          }
        }
        this.totalFood += placed; this.foodDirty = true;
        return;
      }
    }

    sprinkle(n) {
      for (let i = 0; i < n; i++) {
        const k = this.idx(SM.rand() * this.W, SM.rand() * this.H);
        if (this.food[k] < C.FOOD_CELL_MAX) { this.food[k] += 1; this.totalFood += 1; }
      }
      this.foodDirty = true;
    }

    // aphid colonies on plants: renewable honeydew around the stem (tended by Formica and Lasius)
    placePlants(n, colonies) {
      for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
        const x = 16 + SM.rand() * (this.W - 32), y = 16 + SM.rand() * (this.H - 32);
        if (colonies.some(c => Math.hypot(c.x - x, c.y - y) < 18)) continue;
        if (this.plants.some(p => Math.hypot(p.x - x, p.y - y) < 40)) continue;
        this.plants.push({ x, y, r: 2.2, rate: 0.03 + SM.rand() * 0.03, seed: SM.rand() });
        i++;
      }
    }

    ecology(tick, rate) {
      for (const p of this.plants) {
        if (SM.rand() < p.rate * rate) {
          const th = SM.rand() * Math.PI * 2, d = 1 + SM.rand() * p.r;
          const k = this.idx(p.x + Math.cos(th) * d, p.y + Math.sin(th) * d);
          if (this.food[k] < 3) { this.food[k] += 1; this.totalFood += 1; this.foodDirty = true; }
        }
      }
      // carcasses dry out or are taken by other scavengers, so uncollected food doesn't pile up forever
      if (tick % 64 === 0) {
        const f = this.food, pr = C.FOOD_ROT;
        let removed = 0;
        for (let k = 0; k < f.length; k++) {
          if (f[k] >= 1 && SM.rand() < pr) { f[k] -= 1; removed++; }
        }
        if (removed) { this.totalFood -= removed; this.foodDirty = true; }
      }
    }
  }
  SM.World = World;
})(globalThis.SM);
