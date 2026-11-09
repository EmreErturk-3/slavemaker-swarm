// colony.js — colony state: queen, food store, brood pipeline, raid bookkeeping, reproduction.
(function (SM) {
  'use strict';
  const C = SM.CFG, SP = SM.SP;
  let UID = 1;

  class Colony {
    constructor(idx, sp, x, y, genome, tick) {
      this.idx = idx;
      this.uid = UID++;
      this.sp = sp;                 // species of the queen (P = slavemaker colony)
      this.x = x; this.y = y;
      this.alive = true;
      this.queen = true; this.queenBorn = tick;
      this.food = C.FOUND_FOOD;
      this.brood = [];              // {age, sp, g}
      this.reproFund = 0;
      this.g = genome;
      this.born = tick;
      this.lastAttack = -1e9;
      this.attackDir = 0;
      this.alarm = false; this.alarmLvl = 0; this.propLvl = 0;

      // slavemaker raid state
      this.raidActive = false;
      this.raidTarget = -1; this.raidTargetUid = -1;
      this.raidLeft = 0; this.raidStart = 0; this.raidDepart = 0; this.cooldownUntil = 0;
      this.raidLoot = 0; this.raidLost = 0; this.knownTarget = null;
      this.slavesBorn = 0; this.lastSlaveBorn = -1e9;

      // per-tick census (filled by Sim pass A)
      this.resetCensus();
      // decision rates for in-nest ants (filled by step)
      this.pLeave = 0; this.pDefend = 0; this.pEvac = 0; this.pScout = 0; this.pRaid = 0;
      this.starving = false; this.pStarving = false;

      // lifetime tallies
      this.raids = 0; this.pupaeStolen = 0; this.pupaeLost = 0; this.gynes = 0;
      this.rebelKills = 0; this.usurpedAt = -1; this.peak = 0;
    }

    resetCensus() {
      this.n = 0; this.nIn = 0;        // all workers / inside
      this.nForage = 0; this.nForageOut = 0; // forager-type workers (host-species, incl. slaves)
      this.nP = 0; this.nPIn = 0;      // Polyergus workers
      this.nSlaves = 0; this.nSlavesIn = 0; this.sumRebel = 0;
      this.raidersOut = 0; this.scoutsOut = 0; this.defOut = 0; this.evacOut = 0;
    }

    get isSlaver() { return this.sp === SP.P; }
    pupaCount() {
      let n = 0;
      for (const b of this.brood) if (b.age >= C.DEV) n++;
      return n;
    }
    lootCount() {   // pupae + well-grown larvae: what a raid can carry off
      let n = 0;
      for (const b of this.brood) if (b.age >= C.DEV * 0.55) n++;
      return n;
    }
    // raiders take the most developed brood item: pupae first, otherwise a well-grown larva
    takePupa(larvaeOk) {
      let best = -1, bestAge = -1;
      const minAge = larvaeOk ? C.DEV * 0.55 : C.DEV;
      for (let i = 0; i < this.brood.length; i++) {
        const a = this.brood[i].age;
        if (a >= minAge && a > bestAge) { best = i; bestAge = a; }
      }
      if (best < 0) return null;
      const b = this.brood[best];
      this.brood[best] = this.brood[this.brood.length - 1];
      this.brood.pop();
      return b;
    }
    addBrood(b) { this.brood.push(b); }

    static inRaidWindow(sim) { const t = sim.tod; return t >= C.RAID_WINDOW[0] && t <= C.RAID_WINDOW[1]; }

    // a scout reports a host nest; the raid itself only starts in the late-afternoon window
    reportTarget(target, sim) {
      this.knownTarget = { idx: target.idx, uid: target.uid };
      if (Colony.inRaidWindow(sim)) return this.startRaid(target, sim);
      return false;
    }

    startRaid(target, sim) {
      if (this.raidActive || !target.alive || target.sp !== SP.F) return false;
      this.raidActive = true;
      this.raidTarget = target.idx; this.raidTargetUid = target.uid;
      this.raidLeft = Math.max(4, Math.round(this.g.t.recruit * this.nPIn));
      this.raidStart = sim.tick; this.raidDepart = sim.tick + C.MUSTER;
      this.raidLoot = 0; this.raidLost = 0;
      this.raids++; sim.stats.raids++;
      sim.event(`Raid! Polyergus #${this.uid} musters ${this.raidLeft} raiders against Formica #${target.uid}`, 'raid', this);
      return true;
    }
    raidTargetColony(sim) {
      const t = sim.colonies[this.raidTarget];
      return t && t.alive && t.uid === this.raidTargetUid && t.sp === SP.F ? t : null;
    }

    step(sim) {
      const tick = sim.tick, s = this.sp, isP = s === SP.P, g = this.g.t;
      const workers = this.n;

      // --- food consumption ---
      let up;
      if (isP) up = this.nP * C.upkeep[SP.P] * (1 + 0.3 * g.appease) + this.nSlaves * C.upkeep[SP.F];
      else up = workers * C.upkeep[s];
      up += this.brood.length * C.BROOD_UPKEEP;
      this.food -= up;
      if (this.food < 0) this.food = 0;
      this.starving = this.food <= 0.01;
      // Polyergus cannot feed themselves: without slaves they starve even beside a full store
      this.pStarving = isP && (this.starving || this.nSlaves === 0);
      // the colony 'smells' its own nest entrance: alarm pheromone and slavemaker Dufour secretion
      if ((tick & 3) === 0) {
        this.alarmLvl = sim.world.around(this.x, this.y, SM.CH.ALARM, 3);
        this.propLvl = sim.world.around(this.x, this.y, SM.CH.PROP, 3);
      }
      this.alarm = this.alarmLvl > 0.05 || tick - this.lastAttack < 40;
      if (workers > this.peak) this.peak = workers;

      // --- queen senescence ---
      // ant queens are long-lived: no senescence before QUEEN_MIN ticks, then a constant hazard
      if (this.queen && tick - this.queenBorn > C.QUEEN_MIN && SM.rand() < 1 / C.QUEEN_LIFE) {
        this.queen = false;
        sim.event(`${SM.SP_NAME[s]} queen of #${this.uid} died of old age`, 'info', this);
      }

      // --- egg laying ---
      if (this.queen) {
        let own = isP ? this.nP : workers;
        for (const b of this.brood) if (b.sp === s) own++;
        // a slavemaker queen is fed and her brood reared only by slaves
        const care = isP ? SM.clamp((this.nSlaves / (this.nP + 1) - 1) / 2.5, 0, 1) : 1;   // ~4 slaves per master for full laying
        if (care > 0 && own < C.cap[s] && this.food > C.EGG_COST + 2 &&
            SM.rand() < C.eggRate[s] * care * Math.min(1, this.food / 25)) {
          this.food -= C.EGG_COST;
          this.brood.push({ age: 0, sp: s, g: this.g.id });
        }
      }

      // --- brood development ---
      const nurses = isP ? this.nSlavesIn : this.nIn;
      const meanRebel = this.nSlaves > 0 ? this.sumRebel / this.nSlaves : 0;
      for (let i = this.brood.length - 1; i >= 0; i--) {
        const b = this.brood[i];
        let kill = false;
        if (nurses > 0) b.age++;
        else if (SM.rand() < 0.0015) kill = true;
        if (this.starving && SM.rand() < 0.0008) kill = true;
        if (b.age === C.DEV && C.rebellionOn) {
          if (isP && b.sp === SP.P && SM.rand() < meanRebel * C.REBEL_EFF) {
            kill = true; this.rebelKills++; sim.stats.rebelKills++;
          } else if (s === SP.F && b.sp === SP.F) {
            const rg = SM.genomes[b.g];
            if (rg && rg.sp === SP.F && SM.rand() < rg.t.rebel * C.REBEL_COST) kill = true;
          }
        }
        if (!kill && b.age >= C.DEV + C.PUPA) {
          sim.spawnAnt(this, b.sp, b.g, SM.ST.IN);
          if (isP && b.sp === SP.F) { this.slavesBorn++; sim.stats.slavesBorn++; this.lastSlaveBorn = tick; }
          kill = true;
        }
        if (kill) { this.brood[i] = this.brood[this.brood.length - 1]; this.brood.pop(); }
      }

      // --- reproduction (gynes) ---
      const breeders = isP ? this.nP : workers;
      const reserve = 15 + workers * 0.25;
      if (this.queen && breeders >= (isP ? C.REPRO_MIN * 0.5 : C.REPRO_MIN) && this.food > reserve) {
        const inv = (this.food - reserve) * g.repro * 0.004;
        this.food -= inv; this.reproFund += inv;
        if (this.reproFund >= C.GYNE_COST) {
          this.reproFund -= C.GYNE_COST; this.gynes++;
          sim.launchGyne(this);
        }
      }

      // --- slavemaker raid bookkeeping ---
      if (isP) {
        if (this.raidActive) {
          const tgt = this.raidTargetColony(sim);
          if (!tgt || tick >= this.raidDepart) this.raidLeft = 0;   // late-comers don't join a departed column
          if (this.raidLeft <= 0 && this.raidersOut === 0 && tick - this.raidStart > C.MUSTER + 40) {
            this.raidActive = false;
            this.cooldownUntil = tick + 150;
            sim.event(`Raid by Polyergus #${this.uid} ended: ${this.raidLoot} pupae carried home, ${this.raidLost} raiders lost`, 'raidend', this);
            if (this.raidLoot < 3) this.knownTarget = null;          // little left there: find another target
          }
        } else if (this.knownTarget && Colony.inRaidWindow(sim) && tick >= this.cooldownUntil) {
          const t = sim.colonies[this.knownTarget.idx];
          if (t && t.alive && t.uid === this.knownTarget.uid && t.sp === SP.F) this.startRaid(t, sim);
          else this.knownTarget = null;
        }
        // raid when short of slaves relative to the evolved target, or when the slave workforce can't feed the colony
        const want = this.nSlaves < g.want * Math.max(1, this.nP) || this.food < 4 + this.nP * 0.15;
        if (!want && !this.raidActive) this.knownTarget = null;
        const tod = sim.tod;
        this.pRaid = this.raidActive && this.raidLeft > 0 ? 0.2 : 0;
        this.pScout = !this.raidActive && !this.knownTarget && tick >= this.cooldownUntil && want &&
          tod > 0.25 && tod < C.RAID_WINDOW[1] && this.scoutsOut < 10 ? g.scout * 0.01 : 0;
      }

      // --- task allocation for in-nest workers ---
      const need = SM.clamp(1 - this.food / (10 + this.nForage * 0.6), 0, 1);
      const outFrac = this.nForage > 0 ? this.nForageOut / this.nForage : 0;
      const light = sim.daylight;   // F. fusca forages by day; Lasius also at night
      this.pLeave = this.alarm || outFrac > 0.6 ? 0 :
        (0.0012 + 0.004 * need) * (s === SP.L ? 0.4 + 0.6 * light : 0.08 + 0.92 * light);
      if (s === SP.F && this.alarm) {
        const al = Math.min(1, this.alarmLvl * 2 + 0.2), pr = Math.min(1, this.propLvl * 0.8);
        this.pDefend = this.defOut < this.nIn + 40 ? 0.05 * this.g.t.aggr * al * (1 - 0.8 * pr) : 0;
        // evacuation saves only part of the brood (Foitzik et al. 2001): a trickle, capped by the flee gene
        this.pEvac = this.evacOut < 4 + this.g.t.flee * 40 ? 0.003 * this.g.t.flee * al * (1 + 1.5 * pr) : 0;
      } else { this.pDefend = 0; this.pEvac = 0; }

      // --- death of the colony ---
      // no workers = no nurses, so brood can never develop
      if (workers === 0 && tick - this.born > 5) sim.killColony(this, this.queen ? 'collapsed' : 'queenless, died out');
    }
  }
  SM.Colony = Colony;
})(globalThis.SM);
