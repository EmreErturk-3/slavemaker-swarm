// sim.js — agent arrays, behaviour state machines, combat, dispersal/usurpation, history.
(function (SM) {
  'use strict';
  const C = SM.CFG, SP = SM.SP, ST = SM.ST, CH = SM.CH;
  const TAU = Math.PI * 2;

  function wrapAngle(d) {
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }

  class Sim {
    constructor(opts) {
      opts = Object.assign({ seed: 1, hosts: 14, lasius: 3, slavers: 1 }, opts || {});
      this.opts = opts;
      SM.seed(opts.seed);
      SM.genomes.length = 0;
      this.world = new SM.World();
      const N = C.MAX_ANTS;
      this.x = new Float32Array(N); this.y = new Float32Array(N); this.a = new Float32Array(N);
      this.hp = new Float32Array(N); this.dep = new Float32Array(N);
      this.tx = new Float32Array(N); this.ty = new Float32Array(N);
      this.col = new Int16Array(N); this.sp = new Uint8Array(N); this.st = new Uint8Array(N);
      this.prev = new Uint8Array(N); this.carry = new Uint8Array(N); this.alive = new Uint8Array(N);
      this.gid = new Int32Array(N); this.tgt = new Int32Array(N); this.tuid = new Int32Array(N);
      this.foe = new Int32Array(N); this.timer = new Int32Array(N); this.ft = new Int32Array(N);
      this.aid = new Int32Array(N); this.nextAid = 1;          // unique id per ant (slots are reused)
      this.deathBy = new Int8Array(N).fill(-1);               // species of the killer, -1 = natural/none
      this.cargo = new Array(N).fill(null);
      this.free = []; this.hi = 0; this.count = 0;

      this.colonies = new Array(C.MAX_COLONIES).fill(null);
      this.hbW = Math.ceil(C.W / C.HASH); this.hbH = Math.ceil(C.H / C.HASH);
      this.head = new Int32Array(this.hbW * this.hbH); this.next = new Int32Array(N);

      this.tick = 0;
      this.events = [];
      this.history = []; this.sampleEvery = 100;
      this.stats = { raids: 0, pupaeStolen: 0, rebelKills: 0, usurpations: 0, usurpFail: 0,
        founded: 0, extinct: 0, kills: 0, immigrants: 0, slavesBorn: 0,
        kmat: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] }; // killer species x victim species
      this.lastPGenome = null; this.noSlaverSince = -1; this.noHostSince = -1;
      this.init();
    }

    // ---------------- setup ----------------
    init() {
      const o = this.opts, W = C.W, H = C.H;
      const spots = [];
      const place = (sp, preferCenter) => {
        for (let t = 0; t < 400; t++) {
          const x = preferCenter ? W * (0.35 + SM.rand() * 0.3) : 14 + SM.rand() * (W - 28);
          const y = preferCenter ? H * (0.35 + SM.rand() * 0.3) : 14 + SM.rand() * (H - 28);
          if (spots.every(s => Math.hypot(s[0] - x, s[1] - y) >= C.NEST_SPACING * 1.15)) { spots.push([x, y]); return [x, y]; }
        }
        return null;
      };
      const hostPool = SM.defaultGenome(SP.F, 0.05);
      this.hostPoolGid = hostPool.id; // genome of the slaves the founding slavemaker colony starts with
      for (let k = 0; k < o.slavers; k++) {
        const p = place(SP.P, true); if (!p) continue;
        const c = this.addColony(SP.P, p[0], p[1], SM.defaultGenome(SP.P, 0.05));
        c.food = 260;
        for (let i = 0; i < 70; i++) this.spawnAnt(c, SP.P, c.g.id, ST.IN);
        for (let i = 0; i < 330; i++) this.spawnAnt(c, SP.F, hostPool.id, ST.IN);
        for (let i = 0; i < 20; i++) c.brood.push({ age: (SM.rand() * (C.DEV + C.PUPA)) | 0, sp: SP.P, g: c.g.id });
        this.lastPGenome = c.g;
      }
      for (let k = 0; k < o.hosts; k++) {
        const p = place(SP.F); if (!p) continue;
        const c = this.addColony(SP.F, p[0], p[1], SM.defaultGenome(SP.F, 0.06));
        c.food = 60;
        const n = 110 + (SM.rand() * 80) | 0;
        for (let i = 0; i < n; i++) this.spawnAnt(c, SP.F, c.g.id, ST.IN);
        for (let i = 0; i < 25; i++) c.brood.push({ age: (SM.rand() * (C.DEV + C.PUPA)) | 0, sp: SP.F, g: c.g.id });
      }
      for (let k = 0; k < o.lasius; k++) {
        const p = place(SP.L); if (!p) continue;
        const c = this.addColony(SP.L, p[0], p[1], SM.defaultGenome(SP.L, 0.06));
        c.food = 40;
        for (let i = 0; i < 140; i++) this.spawnAnt(c, SP.L, c.g.id, ST.IN);
        for (let i = 0; i < 25; i++) c.brood.push({ age: (SM.rand() * (C.DEV + C.PUPA)) | 0, sp: SP.L, g: c.g.id });
      }
      this.world.placePlants(C.PLANTS, this.liveColonies());
      for (let i = 0; i < 26; i++) this.world.spawnPatch(this.liveColonies(), 160 + SM.rand() * 160);
      this.world.sprinkle(500);
      this.event(`World seeded: ${o.hosts} Formica hosts, ${o.lasius} Lasius, ${o.slavers} Polyergus`, 'info');
      this.census();
      this.sample();
    }

    addColony(sp, x, y, genome) {
      const idx = this.colonies.indexOf(null);
      if (idx < 0) return null;
      const c = new SM.Colony(idx, sp, x, y, genome, this.tick);
      this.colonies[idx] = c;
      return c;
    }
    liveColonies() { return this.colonies.filter(c => c && c.alive); }
    countColonies(sp) { let n = 0; for (const c of this.colonies) if (c && c.alive && c.sp === sp) n++; return n; }

    killColony(c, reason) {
      c.alive = false;
      this.colonies[c.idx] = null;
      this.stats.extinct++;
      this.event(`${SM.SP_NAME[c.sp]} colony #${c.uid} died (${reason})`, 'death', c);
    }

    event(msg, kind, c) {
      this.events.push({ t: this.tick, msg, kind: kind || 'info', uid: c ? c.uid : -1 });
      if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    }

    // ---------------- ants ----------------
    spawnAnt(c, sp, gid, state) {
      let i;
      if (this.free.length) i = this.free.pop();
      else if (this.hi < C.MAX_ANTS) i = this.hi++;
      else return -1;
      this.alive[i] = 1; this.aid[i] = this.nextAid++; this.deathBy[i] = -1;
      const r = SM.rand() * 1.5, th = SM.rand() * TAU;
      this.x[i] = c.x + Math.cos(th) * r; this.y[i] = c.y + Math.sin(th) * r;
      this.a[i] = SM.rand() * TAU;
      this.col[i] = c.idx; this.sp[i] = sp; this.st[i] = state; this.prev[i] = ST.IN;
      this.carry[i] = 0; this.cargo[i] = null; this.gid[i] = gid;
      this.hp[i] = C.hp[sp]; this.timer[i] = 0; this.tgt[i] = -1; this.tuid[i] = -1; this.foe[i] = -1;
      this.dep[i] = 0;
      this.count++;
      return i;
    }

    kill(i, killer) {
      if (!this.alive[i]) return;
      this.alive[i] = 0; this.count--;
      this.deathBy[i] = killer >= 0 ? this.sp[killer] : -1;
      if (this.sp[i] === SP.P && killer >= 0) {
        const c = this.colonies[this.col[i]];
        if (c && c.raidActive) c.raidLost++;
      }
      if (this.carry[i] === 1) this.world.addFood(this.x[i], this.y[i], 1);
      else if (this.carry[i] === 2) {
        const b = this.cargo[i]; this.cargo[i] = null;
        if (killer >= 0 && this.sp[killer] === SP.P && this.carry[killer] === 0) {
          // raiders snatch pupae from fleeing hosts
          this.carry[killer] = 2; this.cargo[killer] = b; this.st[killer] = ST.RETURN;
        } else {
          const c = this.colonies[this.col[i]];
          if (c) c.pupaeLost++;
        }
      }
      this.carry[i] = 0;
      if (killer >= 0) {
        this.stats.kills++; this.stats.kmat[this.sp[killer]][this.sp[i]]++;
        if (this.sp[i] === SP.F) this.world.deposit(this.x[i], this.y[i], CH.ALARM, 2);
      }
      this.free.push(i);
    }

    genomeOf(i) { return SM.genomes[this.gid[i]].t; }

    // ---------------- gynes ----------------
    launchGyne(c) {
      const g = SM.mutateGenome(c.g, c.sp);
      let tx, ty, tgt = -1, tuid = -1;
      if (c.sp === SP.P) {
        const hosts = this.colonies.filter(h => h && h.alive && h.sp === SP.F &&
          Math.hypot(h.x - c.x, h.y - c.y) < C.P_DISPERSAL);
        if (!hosts.length) { this.event(`Slavemaker gyne from #${c.uid} found no host nest`, 'fail', c); return; }
        const h = hosts[(SM.rand() * hosts.length) | 0];
        tx = h.x; ty = h.y; tgt = h.idx; tuid = h.uid;
      } else {
        const th = SM.rand() * TAU, d = 12 + SM.rand() * C.DISPERSAL;
        tx = SM.clamp(c.x + Math.cos(th) * d, 10, C.W - 10);
        ty = SM.clamp(c.y + Math.sin(th) * d, 10, C.H - 10);
      }
      const i = this.spawnAnt(c, c.sp, g.id, ST.GYNE);
      if (i < 0) return;
      this.col[i] = -1; this.tx[i] = tx; this.ty[i] = ty; this.tgt[i] = tgt; this.tuid[i] = tuid;
      this.hp[i] = 3;
    }

    immigrantGyne(sp) {
      const W = C.W, H = C.H;
      const side = (SM.rand() * 4) | 0;
      const x = side === 0 ? 1 : side === 1 ? W - 1 : SM.rand() * W;
      const y = side === 2 ? 1 : side === 3 ? H - 1 : SM.rand() * H;
      const fake = { x, y, idx: -1 };
      let g, tx, ty, tgt = -1, tuid = -1;
      if (sp === SP.P) {
        const hosts = this.colonies.filter(h => h && h.alive && h.sp === SP.F);
        if (!hosts.length) return;
        const h = hosts[(SM.rand() * hosts.length) | 0];
        g = this.lastPGenome ? SM.mutateGenome(this.lastPGenome, SP.P) : SM.defaultGenome(SP.P, 0.05);
        tx = h.x; ty = h.y; tgt = h.idx; tuid = h.uid;
      } else {
        g = SM.defaultGenome(sp, 0.08);
        tx = 20 + SM.rand() * (W - 40); ty = 20 + SM.rand() * (H - 40);
      }
      const i = this.spawnAnt(fake, sp, g.id, ST.GYNE);
      if (i < 0) return;
      this.col[i] = -1; this.tx[i] = tx; this.ty[i] = ty; this.tgt[i] = tgt; this.tuid[i] = tuid; this.hp[i] = 3;
      this.stats.immigrants++;
      this.event(`Immigrant ${SM.SP_NAME[sp]} queen flies in`, 'info');
    }

    gyneArrive(i) {
      const sp = this.sp[i], g = SM.genomes[this.gid[i]];
      if (sp === SP.P) {
        const h = this.colonies[this.tgt[i]];
        if (!h || !h.alive || h.uid !== this.tuid[i] || h.sp !== SP.F) return;
        if (this.countColonies(SP.P) >= 8) return;
        // Dufour's-gland appeasement vs. host aggression & worker force
        const pSucc = SM.clamp(0.15 + 0.7 * g.t.appease - 0.45 * h.g.t.aggr * Math.min(1, h.n / 120), 0.03, 0.95);
        if (SM.rand() < pSucc) {
          const old = h.uid;
          h.sp = SP.P; h.g = g; h.queen = true; h.queenBorn = this.tick; h.reproFund = 0;
          h.raidActive = false; h.cooldownUntil = this.tick + 300; h.usurpedAt = this.tick;
          this.stats.usurpations++; this.lastPGenome = g;
          this.event(`Usurpation! Polyergus queen killed host queen #${old}; ${h.n} workers are now slaves`, 'usurp', h);
        } else {
          this.stats.usurpFail++;
          this.event(`Polyergus queen killed attempting to usurp host #${h.uid}`, 'fail', h);
        }
        return;
      }
      const tx = this.x[i], ty = this.y[i];
      const cap = sp === SP.F ? 26 : 6;
      if (this.countColonies(sp) >= cap) return;
      for (const c of this.colonies) if (c && c.alive && Math.hypot(c.x - tx, c.y - ty) < C.NEST_SPACING) return;
      const c = this.addColony(sp, tx, ty, g);
      if (!c) return;
      for (let k = 0; k < C.NANITIC; k++) this.spawnAnt(c, sp, g.id, ST.IN);
      this.stats.founded++;
      this.event(`New ${SM.SP_NAME[sp]} colony #${c.uid} founded (gen ${g.gen})`, 'found', c);
    }

    // ---------------- main step ----------------
    // time of day in [0,1): 0 = midnight, 0.5 = noon
    get tod() { return (this.tick % C.DAY) / C.DAY; }
    get daylight() { const t = this.tod; return SM.clamp((Math.sin((t - 0.25) * Math.PI * 2) + 0.3) / 0.55, 0, 1); }   // dawn ~05:00, dusk ~19:00

    step() {
      this.tick++;
      this.census();
      for (const c of this.colonies) if (c && c.alive) c.step(this);
      this.behave();
      if (this.tick % C.FIELD_EVERY === 0) this.world.updateField();
      this.ecology();
      if (this.tick % this.sampleEvery === 0) this.sample();
    }

    census() {
      const cols = this.colonies, head = this.head, next = this.next, HS = C.HASH, hbW = this.hbW;
      for (const c of cols) if (c) c.resetCensus();
      head.fill(-1);
      for (let i = 0; i < this.hi; i++) {
        if (!this.alive[i]) continue;
        const st = this.st[i];
        if (st === ST.GYNE) continue;
        const c = cols[this.col[i]];
        if (c) {
          const sp = this.sp[i], eff = st === ST.FIGHT ? this.prev[i] : st;
          c.n++;
          if (st === ST.IN) c.nIn++;
          if (sp === SP.P) {
            c.nP++;
            if (st === ST.IN) c.nPIn++;
            else if (eff === ST.SCOUT || eff === ST.SCOUT_BACK) c.scoutsOut++;
            else c.raidersOut++;
          } else {
            c.nForage++;
            if (st !== ST.IN) c.nForageOut++;
            if (eff === ST.DEFEND) c.defOut++;
            else if (st === ST.EVAC) c.evacOut++;
            if (c.sp === SP.P) {
              c.nSlaves++;
              if (st === ST.IN) c.nSlavesIn++;
              c.sumRebel += SM.genomes[this.gid[i]].t.rebel || 0;
            }
          }
        }
        if (st !== ST.IN) {
          const b = ((this.y[i] / HS) | 0) * hbW + ((this.x[i] / HS) | 0);
          next[i] = head[b]; head[b] = i;
        }
      }
    }

    move(i, spd) {
      let a = this.a[i];
      let x = this.x[i] + Math.cos(a) * spd, y = this.y[i] + Math.sin(a) * spd;
      if (x < 0.5) { x = 0.5; a = Math.PI - a; } else if (x > C.W - 0.5) { x = C.W - 0.5; a = Math.PI - a; }
      if (y < 0.5) { y = 0.5; a = -a; } else if (y > C.H - 0.5) { y = C.H - 0.5; a = -a; }
      this.x[i] = x; this.y[i] = y; this.a[i] = a;
    }
    steerTo(i, tx, ty, rate) {
      const d = wrapAngle(Math.atan2(ty - this.y[i], tx - this.x[i]) - this.a[i]);
      this.a[i] += d * rate;
    }
    // 3-sensor gradient steering on pheromone channel ch (+ optional food attraction)
    sense(i, ch, w, foodW, dist) {
      const wo = this.world, ph = wo.ph[ch], a = this.a[i], x = this.x[i], y = this.y[i];
      let best = 0, bv = 0, v;
      for (let s = -1; s <= 1; s++) {
        const ang = a + s * 0.6;
        const k = wo.idx(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist);
        v = ph[k] * w;
        if (foodW) v += wo.food[k] * foodW;
        if (v > bv + 1e-4) { bv = v; best = s; }
      }
      if (bv > 0.01) this.a[i] += best * 0.35;
      return bv;
    }

    behave() {
      const cols = this.colonies, wo = this.world, tick = this.tick;
      const spd = C.speed, life = C.life;
      for (let i = 0; i < this.hi; i++) {
        if (!this.alive[i]) continue;
        let st = this.st[i];
        const sp = this.sp[i];

        if (st === ST.GYNE) {
          const dx = this.tx[i] - this.x[i], dy = this.ty[i] - this.y[i];
          if (dx * dx + dy * dy < 2.5) { this.gyneArrive(i); this.kill(i, -1); continue; }
          this.steerTo(i, this.tx[i], this.ty[i], 0.25);
          this.a[i] += SM.randn() * 0.15;
          this.move(i, 0.9);
          continue;
        }

        const c = cols[this.col[i]];
        if (!c) { this.kill(i, -1); continue; }
        // natural mortality & starvation
        if (SM.rand() < 1 / life[sp] ||
            (sp === SP.P ? c.pStarving && SM.rand() < 0.0015 : c.starving && SM.rand() < 0.0006)) {
          this.kill(i, -1); continue;
        }

        switch (st) {
          case ST.IN: {
            if (sp === SP.P) {
              if (c.pRaid > 0 && c.raidLeft > 0 && SM.rand() < c.pRaid) {
                const t = c.raidTargetColony(this);
                if (t) {
                  this.st[i] = ST.RAID; this.tgt[i] = t.idx; this.tuid[i] = t.uid; this.timer[i] = 0;
                  this.a[i] = Math.atan2(t.y - c.y, t.x - c.x) + SM.randn() * 0.3;
                  c.raidLeft--;
                }
              } else if (c.pScout > 0 && SM.rand() < c.pScout) {
                this.st[i] = ST.SCOUT; this.tgt[i] = -1; this.timer[i] = 0; this.a[i] = SM.rand() * TAU;
              }
            } else {
              if (c.pDefend > 0 && sp === SP.F && SM.rand() < c.pDefend) {
                this.st[i] = ST.DEFEND; this.timer[i] = 0; this.a[i] = SM.rand() * TAU;
              } else if (c.pEvac > 0 && sp === SP.F && SM.rand() < c.pEvac) {
                const b = c.takePupa();
                if (b) {
                  this.st[i] = ST.EVAC; this.carry[i] = 2; this.cargo[i] = b; this.timer[i] = 0;
                  const th = c.attackDir + Math.PI + SM.randn() * 0.9, d = 16 + SM.rand() * 14;
                  this.tx[i] = SM.clamp(c.x + Math.cos(th) * d, 2, C.W - 2);
                  this.ty[i] = SM.clamp(c.y + Math.sin(th) * d, 2, C.H - 2);
                  this.a[i] = th;
                }
              } else if (c.pLeave > 0 && SM.rand() < c.pLeave) {
                this.st[i] = ST.FORAGE; this.timer[i] = 0; this.a[i] = SM.rand() * TAU;
              }
            }
            continue; // inside the nest: no movement, no encounters
          }

          case ST.FORAGE: {
            this.timer[i]++;
            if (wo.food[wo.idx(this.x[i], this.y[i])] >= 1 && wo.takeFood(this.x[i], this.y[i])) {
              this.carry[i] = 1; this.st[i] = ST.RETURN; this.dep[i] = 1; this.a[i] += Math.PI;
              break;
            }
            const g = this.genomeOf(i);
            // alarm recruitment: free host foragers near home answer the alarm signal
            if (sp === SP.F && c.sp === SP.F && c.alarm && (tick & 3) === 0 &&
                wo.get(this.x[i], this.y[i], CH.ALARM) > 0.2 && SM.rand() < g.aggr * 0.3) {
              const ex = this.x[i] - c.x, ey = this.y[i] - c.y;
              if (ex * ex + ey * ey < 900) { this.st[i] = ST.DEFEND; this.timer[i] = 0; break; }
            }
            this.sense(i, sp === SP.L ? CH.LTRAIL : CH.FTRAIL, g.trail, 3, 3.5);
            this.a[i] += SM.randn() * g.explore * 0.6;
            const dx = this.x[i] - c.x, dy = this.y[i] - c.y;
            if (this.timer[i] > 1700 || dx * dx + dy * dy > 150 * 150) this.st[i] = ST.RETURN;
            this.move(i, spd[sp]);
            break;
          }

          case ST.RETURN: {
            const dx = c.x - this.x[i], dy = c.y - this.y[i];
            if (dx * dx + dy * dy < C.NEST_R * C.NEST_R) { this.arrive(i, c); break; }
            this.steerTo(i, c.x, c.y, 0.18);
            this.a[i] += SM.randn() * 0.12;
            if (this.carry[i] === 1) {
              wo.deposit(this.x[i], this.y[i], sp === SP.L ? CH.LTRAIL : CH.FTRAIL, 0.7 * this.dep[i]);
              this.dep[i] *= 0.994;
            } else if (this.carry[i] === 2 && sp === SP.P) {
              wo.deposit(this.x[i], this.y[i], CH.RAID, 0.35);
            }
            this.move(i, spd[sp]);
            break;
          }

          case ST.SCOUT: {
            const g = c.g.t, t = ++this.timer[i];
            const dx = this.x[i] - c.x, dy = this.y[i] - c.y;
            this.a[i] += SM.randn() * 0.25 + wrapAngle(Math.atan2(dy, dx) - this.a[i]) * 0.02;
            if (dx * dx + dy * dy > g.range * g.range || t > g.range * 7) { this.st[i] = ST.SCOUT_BACK; this.tgt[i] = -1; }
            else if ((i + tick) % 5 === 0) {
              for (const h of cols) {
                if (!h || !h.alive || h.sp !== SP.F || h === c) continue;
                const ex = h.x - this.x[i], ey = h.y - this.y[i];
                // scouts assess the nest: larger colonies (more pupae) are preferred targets
                if (ex * ex + ey * ey < 256 && SM.rand() < Math.min(1, h.n / 70) * Math.min(1, h.lootCount() / 4)) {
                  this.st[i] = ST.SCOUT_BACK; this.tgt[i] = h.idx; this.tuid[i] = h.uid; this.a[i] += Math.PI;
                  break;
                }
              }
            }
            this.move(i, spd[sp]);
            break;
          }

          case ST.SCOUT_BACK: {
            const dx = c.x - this.x[i], dy = c.y - this.y[i];
            if (dx * dx + dy * dy < C.NEST_R * C.NEST_R) {
              const t = this.tgt[i] >= 0 ? cols[this.tgt[i]] : null;
              if (t && t.alive && t.uid === this.tuid[i] && t.sp === SP.F && !c.raidActive && c.reportTarget(t, this)) {
                this.st[i] = ST.RAID; this.timer[i] = 0; // the scout leads the column
                this.a[i] = Math.atan2(t.y - c.y, t.x - c.x);
              } else { this.st[i] = ST.IN; }
              break;
            }
            if (this.tgt[i] >= 0) wo.deposit(this.x[i], this.y[i], CH.RAID, 1.2);
            this.steerTo(i, c.x, c.y, 0.18);
            this.a[i] += SM.randn() * 0.1;
            this.move(i, spd[sp]);
            break;
          }

          case ST.RAID: {
            const t = cols[this.tgt[i]];
            if (!t || !t.alive || t.uid !== this.tuid[i] || t.sp !== SP.F) { this.st[i] = ST.RETURN; break; }
            if (c.raidActive && tick < c.raidDepart) {
              // pre-raid milling: raiders swirl around their own nest until the column sets off
              const ox = this.x[i] - c.x, oy = this.y[i] - c.y, r = Math.hypot(ox, oy) || 1;
              const tang = Math.atan2(oy, ox) + (i & 1 ? 1.4 : -1.4);
              this.a[i] += wrapAngle((r > 8 ? Math.atan2(-oy, -ox) : tang) - this.a[i]) * 0.15 + SM.randn() * 0.3;
              this.move(i, spd[sp] * 0.7);
              this.timer[i] = 0;
              break;
            }
            this.timer[i]++;
            const dx = t.x - this.x[i], dy = t.y - this.y[i], d2 = dx * dx + dy * dy;
            if (d2 < 144) {
              t.lastAttack = tick; t.attackDir = Math.atan2(-dy, -dx);
              // Dufour's-gland secretion released at the raided nest (dose = appeasement gene)
              if ((tick & 1) === 0) wo.deposit(this.x[i], this.y[i], CH.PROP, 0.6 * c.g.t.appease);
            }
            if (this.timer[i] > 2200) { this.st[i] = ST.RETURN; break; }
            if (d2 > 9) {
              // follow the scout's raid trail, using only sensors that point roughly toward the target
              // (the column moves outward along a non-polar trail; Topoff 1984)
              const bear = Math.atan2(dy, dx), rp = wo.ph[CH.RAID], a0 = this.a[i];
              let best = 0, bv = 0;
              for (let s = -1; s <= 1; s++) {
                const ang = a0 + s * 0.6;
                if (Math.cos(ang - bear) < 0.25) continue;
                const v = rp[wo.idx(this.x[i] + Math.cos(ang) * 3, this.y[i] + Math.sin(ang) * 3)];
                if (v > bv + 1e-4) { bv = v; best = s; }
              }
              if (bv > 0.05) { this.a[i] += best * 0.3; this.steerTo(i, t.x, t.y, 0.03); }
              else this.steerTo(i, t.x, t.y, 0.12);    // lost the trail: head on by memory/vision
              this.a[i] += SM.randn() * 0.15;
              wo.deposit(this.x[i], this.y[i], CH.RAID, 0.12);
              this.move(i, spd[sp]);
            } else {
              // inside the host nest: workers inside sound the alarm; grab the most developed pupa
              if (t.nIn > 0) wo.deposit(t.x, t.y, CH.ALARM, 0.5);
              const b = t.takePupa(true);
              if (b) {
                this.carry[i] = 2; this.cargo[i] = b; this.st[i] = ST.RETURN; this.a[i] += Math.PI;
                break;
              }
              if (t.queen && t.n < 6 && SM.rand() < 0.0005) {
                t.queen = false;
                this.event(`Raiders from #${c.uid} killed the queen of host #${t.uid}`, 'death', t);
              }
              this.a[i] += SM.randn() * 0.9;
              this.move(i, spd[sp] * 0.6);
              if (this.timer[i] > 1500) this.st[i] = ST.RETURN;
            }
            break;
          }

          case ST.DEFEND: {
            this.timer[i]++;
            const dx = this.x[i] - c.x, dy = this.y[i] - c.y;
            if (dx * dx + dy * dy > 144) this.steerTo(i, c.x, c.y, 0.25);
            else this.sense(i, CH.ALARM, 1, 0, 2.5);
            // Dufour's secretion: defenders soaked in it lose the will to fight and retreat
            const pr = wo.get(this.x[i], this.y[i], CH.PROP);
            if (pr > 0.3 && SM.rand() < pr * 0.004) { this.st[i] = ST.RETURN; break; }
            this.a[i] += SM.randn() * 0.5;
            if (!c.alarm && this.timer[i] > 100) this.st[i] = ST.RETURN;
            this.move(i, spd[sp]);
            break;
          }

          case ST.EVAC: {
            this.timer[i]++;
            const dx = this.tx[i] - this.x[i], dy = this.ty[i] - this.y[i];
            if (dx * dx + dy * dy > 2) {
              this.steerTo(i, this.tx[i], this.ty[i], 0.25);
              this.a[i] += SM.randn() * 0.2;
              this.move(i, spd[sp]);
            } else this.a[i] += SM.randn() * 0.5;
            if ((!c.alarm && this.timer[i] > 250) || this.timer[i] > 4000) this.st[i] = ST.RETURN;
            break;
          }

          case ST.FIGHT: {
            const j = this.foe[i];
            if (j < 0 || !this.alive[j] || ++this.ft[i] > 500) { this.st[i] = this.prev[i]; break; }
            const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i], d2 = dx * dx + dy * dy;
            if (d2 > 25) { this.st[i] = this.prev[i]; break; }
            // ordinary territorial skirmishes usually end without a death; raids and nest defence do not
            const pv = this.prev[i];
            if (pv !== ST.RAID && pv !== ST.DEFEND && this.prev[j] !== ST.RAID && SM.rand() < 0.1) {
              this.st[i] = pv; this.a[i] += Math.PI; break;
            }
            this.a[i] = Math.atan2(dy, dx);
            if (d2 > 1.2) { this.move(i, spd[sp] * 0.9); break; }
            this.hp[j] -= C.dmg[sp] * (0.5 + SM.rand());
            if (sp === SP.F && (tick & 7) === 0) wo.deposit(this.x[i], this.y[i], CH.ALARM, 0.6);
            if (this.hp[j] <= 0) {
              this.kill(j, i);
              if (this.st[i] === ST.FIGHT) this.st[i] = this.prev[i];
            }
            break;
          }
        }

        // encounters (every other tick, staggered)
        st = this.st[i];
        if (((i + tick) & 1) === 0 && this.alive[i] && st !== ST.FIGHT && st !== ST.IN && st !== ST.EVAC) this.encounter(i);
      }
    }

    arrive(i, c) {
      const sp = this.sp[i];
      if (this.carry[i] === 1) {
        c.food += 1; this.carry[i] = 0;
        if (sp !== SP.P && !c.alarm && SM.rand() < 0.75) { // head back out along the trail
          this.st[i] = ST.FORAGE; this.timer[i] = 0; this.a[i] += Math.PI; this.dep[i] = 0;
          return;
        }
      } else if (this.carry[i] === 2) {
        c.addBrood(this.cargo[i]); this.cargo[i] = null; this.carry[i] = 0;
        if (sp === SP.P) { c.pupaeStolen++; c.raidLoot++; this.stats.pupaeStolen++; }
      }
      this.st[i] = ST.IN; this.hp[i] = C.hp[sp]; // recovers inside
    }

    encounter(i) {
      const HS = C.HASH, hbW = this.hbW, hbH = this.hbH, x = this.x[i], y = this.y[i];
      const bx = (x / HS) | 0, by = (y / HS) | 0, ci = this.col[i];
      for (let oy = -1; oy <= 1; oy++) {
        const yy = by + oy; if (yy < 0 || yy >= hbH) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = bx + ox; if (xx < 0 || xx >= hbW) continue;
          for (let j = this.head[yy * hbW + xx]; j >= 0; j = this.next[j]) {
            if (j === i || !this.alive[j] || this.col[j] === ci || this.col[j] < 0) continue;
            const sj = this.st[j]; if (sj === ST.IN || sj === ST.GYNE) continue;
            const dx = this.x[j] - x, dy = this.y[j] - y;
            if (dx * dx + dy * dy > 2) continue;
            if (SM.rand() < this.engageP(i, j)) {
              this.prev[i] = this.st[i]; this.st[i] = ST.FIGHT; this.foe[i] = j; this.ft[i] = 0;
              if (sj !== ST.FIGHT && SM.rand() < this.fightBackP(j)) {
                this.prev[j] = sj; this.st[j] = ST.FIGHT; this.foe[j] = i; this.ft[j] = 0;
              }
              return;
            }
          }
        }
      }
    }

    engageP(i, j) {
      const si = this.sp[i], sj = this.sp[j], st = this.st[i];
      if (si === SP.P) {
        if (st !== ST.RAID || sj !== SP.F) return 0;
        if (this.carry[j] === 2) return 0.9;                    // pupa carriers are the prize
        const t = this.colonies[this.tgt[i]];
        if (t && this.col[j] === t.idx) return 0.5;            // defenders of the target nest
        return 0.05;
      }
      const g = this.genomeOf(i);
      let p;
      if (si === SP.F) {
        if (st === ST.EVAC) return 0;
        if (sj === SP.P) {
          const pr = this.world.get(this.x[i], this.y[i], CH.PROP);
          p = g.aggr * (1 - Math.min(0.9, pr * 0.6)) * (st === ST.DEFEND ? 0.9 : 0.25);
        } else if (sj === SP.F) p = g.aggr * (st === ST.DEFEND ? 0.02 : 0.0015);
        else p = g.aggr * 0.008;
      } else { // Lasius
        p = g.aggr * (sj === SP.P ? 0.005 : sj === SP.L ? 0.002 : 0.008);
      }
      if (this.carry[i]) p *= 0.3;
      return p;
    }

    fightBackP(j) {
      const sj = this.sp[j];
      if (this.st[j] === ST.GYNE) return 0;
      if (sj === SP.P) return 1;
      if (this.st[j] === ST.EVAC) return 0;
      const g = this.genomeOf(j);
      return 0.35 + 0.6 * (g.aggr || 0);
    }

    // food renewal, immigration safety valves
    ecology() {
      const w = this.world, r = C.foodRate;
      w.ecology(this.tick, r);
      if (SM.rand() < 0.007 * r && w.totalFood < 9000 * r) w.spawnPatch(this.liveColonies(), 140 + SM.rand() * 160);
      if (SM.rand() < 0.2 * r) w.sprinkle(1);
      if (this.tick % 100 !== 0) return;
      const nP = this.countColonies(SP.P), nF = this.countColonies(SP.F);
      let gyneP = false;
      for (let i = 0; i < this.hi; i++) if (this.alive[i] && this.st[i] === ST.GYNE && this.sp[i] === SP.P) { gyneP = true; break; }
      if (nP === 0 && !gyneP) {
        if (this.noSlaverSince < 0) { this.noSlaverSince = this.tick; this.event('Slavemakers extinct', 'death'); }
        if (C.autoReseed && this.tick - this.noSlaverSince > 4000 && nF > 0) { this.immigrantGyne(SP.P); this.noSlaverSince = -1; }
      } else this.noSlaverSince = -1;
      if (nF === 0) {
        if (this.noHostSince < 0) this.noHostSince = this.tick;
        if (C.autoReseed && this.tick - this.noHostSince > 3000) { this.immigrantGyne(SP.F); this.noHostSince = -1; }
      } else this.noHostSince = -1;
    }

    // ---------------- history / stats ----------------
    traitStats(sp) {
      const out = {};
      for (const d of SM.TRAITS[sp]) out[d.k] = { mean: 0, min: Infinity, max: -Infinity, n: 0 };
      for (const c of this.colonies) {
        if (!c || !c.alive || c.sp !== sp) continue;
        for (const d of SM.TRAITS[sp]) {
          const v = c.g.t[d.k], o = out[d.k];
          o.mean += v; o.n++; if (v < o.min) o.min = v; if (v > o.max) o.max = v;
        }
      }
      for (const k in out) { const o = out[k]; if (o.n) o.mean /= o.n; else { o.mean = NaN; o.min = NaN; o.max = NaN; } }
      return out;
    }

    sample() {
      let free = 0, slaves = 0, poly = 0, las = 0;
      for (const c of this.colonies) {
        if (!c || !c.alive) continue;
        if (c.sp === SP.F) free += c.n;
        else if (c.sp === SP.L) las += c.n;
        else { slaves += c.nSlaves; poly += c.nP; }
      }
      this.history.push({
        t: this.tick, free, slaves, poly, las,
        cF: this.countColonies(SP.F), cP: this.countColonies(SP.P), cL: this.countColonies(SP.L),
        F: this.traitStats(SP.F), P: this.traitStats(SP.P), L: this.traitStats(SP.L),
        food: this.world.totalFood,
      });
      if (this.history.length > 1000) {
        this.history = this.history.filter((_, k) => k % 2 === 0);
        this.sampleEvery *= 2;
      }
    }

    colonyAt(x, y, r) {
      let best = null, bd = (r || 8) ** 2;
      for (const c of this.colonies) {
        if (!c || !c.alive) continue;
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }
  }
  SM.Sim = Sim;
})(globalThis.SM);
