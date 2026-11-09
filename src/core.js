// core.js — namespace, RNG, constants, genome definitions.
// Plain script (no modules) so index.html works straight from file://.
(function (SM) {
  'use strict';

  // ---------- seeded RNG (mulberry32) ----------
  let _s = 1;
  SM.seed = function (s) { _s = (s >>> 0) || 1; };
  SM.rand = function () {
    _s = (_s + 0x6D2B79F5) | 0;
    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  SM.randn = function () {
    let u = 0, v = 0;
    while (u === 0) u = SM.rand();
    v = SM.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  SM.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- species & states ----------
  SM.SP = { F: 0, P: 1, L: 2 };            // Formica (host), Polyergus (slavemaker), Lasius (non-host competitor)
  SM.SP_NAME = ['Formica', 'Polyergus', 'Lasius'];

  SM.ST = {
    IN: 0,        // inside nest (not simulated spatially)
    FORAGE: 1,    // searching for food
    RETURN: 2,    // homing by path integration (maybe carrying)
    SCOUT: 3,     // Polyergus scout searching for host nests
    SCOUT_BACK: 4,// scout returning, laying raid trail
    RAID: 5,      // raider heading to / working inside target nest
    DEFEND: 6,    // host defender around own nest
    EVAC: 7,      // host worker evacuating a pupa away from the nest
    FIGHT: 8,     // locked in combat
    GYNE: 9,      // mated queen dispersing (founding or usurpation)
  };

  // ---------- world & tuning constants ----------
  SM.CFG = {
    W: 512, H: 384,            // world = pheromone grid, in cells (1 cell ~ 2.5 cm)
    MAX_ANTS: 30000,
    MAX_COLONIES: 48,
    HASH: 3,                   // spatial hash bucket size (cells)
    FIELD_EVERY: 2,            // pheromone diffusion every N ticks

    // per-species parameters  [F, P, L]
    speed:   [0.42, 0.52, 0.38],
    hp:      [1.0, 2.2, 0.8],
    dmg:     [0.032, 0.13, 0.028],
    life:    [60000, 70000, 50000],   // mean worker lifespan, ticks (~12-15 sim days)
    upkeep:  [0.00022, 0.00018, 0.00020],
    cap:     [320, 150, 340],         // queen stops laying above workers+brood (scaled-down F. fusca 500-2000)
    eggRate: [0.05, 0.02, 0.045],

    DEV: 1800,                // egg -> pupa (ticks)
    PUPA: 1200,               // pupa -> adult
    EGG_COST: 1.4,
    BROOD_UPKEEP: 0.00015,
    GYNE_COST: 45,
    QUEEN_MIN: 70000,         // queens don't senesce before this age (ticks)
    QUEEN_LIFE: 70000,        // mean remaining lifespan after QUEEN_MIN -> colony turnover
    DAY: 4800,                // ticks per day/night cycle
    RAID_WINDOW: [0.46, 0.82],// raids start only in the late afternoon (Topoff et al. 1984; Talbot 1967)
    MUSTER: 260,              // pre-raid milling around the nest before the column leaves
    REPRO_MIN: 50,            // workers needed before a colony invests in gynes
    FOUND_FOOD: 18,
    NANITIC: 8,               // first workers of an independently founded colony
    NEST_R: 2.5,
    NEST_SPACING: 30,
    DISPERSAL: 90,            // gyne flight radius for independent founders (kin structure)
    P_DISPERSAL: 180,         // slavemaker gyne search radius for a host nest
    FOOD_ROT: 0.012,          // per-unit chance to rot, checked every 64 ticks
    PLANTS: 14,               // aphid-infested plants: persistent honeydew sources

    FOOD_CELL_MAX: 6,
    foodRate: 1.0,            // UI multiplier
    mutation: 0.06,           // sd as fraction of trait range
    rebellionOn: true,
    autoReseed: true,

    REBEL_EFF: 0.7,           // max fraction of slavemaker pupae killed by fully rebellious slaves (Achenbach & Foitzik 2009: ~2/3)
    REBEL_COST: 0.08,         // accidental own-pupa kill rate in free colonies at rebel = 1
  };

  // pheromone channels are defined in world.js (SM.CH)

  // ---------- genomes ----------
  // Colony-level genomes. Traits are heritable via gynes; slaves carry their natal genome.
  SM.TRAITS = {
    0: [ // Formica fusca-group host
      { k: 'aggr',   lo: 0,    hi: 1,    v: 0.45, name: 'Aggression',        tip: 'Chance to attack intruders / emit defenders' },
      { k: 'flee',   lo: 0,    hi: 1,    v: 0.35, name: 'Brood evacuation',  tip: 'Chance to carry pupae away during a raid' },
      { k: 'rebel',  lo: 0,    hi: 1,    v: 0.05, name: 'Slave rebellion',   tip: 'Enslaved workers kill slavemaker pupae (costly: some own pupae misidentified)' },
      { k: 'explore',lo: 0.05, hi: 0.6,  v: 0.25, name: 'Search noise',      tip: 'Random turning while foraging' },
      { k: 'trail',  lo: 0,    hi: 1,    v: 0.6,  name: 'Trail fidelity',    tip: 'How strongly foragers follow food trails' },
      { k: 'repro',  lo: 0.02, hi: 0.6,  v: 0.15, name: 'Gyne investment',   tip: 'Share of surplus food spent on new queens' },
    ],
    1: [ // Polyergus obligate slavemaker
      { k: 'scout',  lo: 0.002,hi: 0.08, v: 0.02, name: 'Scouting effort',   tip: 'Per-worker rate of leaving to scout for host nests' },
      { k: 'range',  lo: 40,   hi: 260,  v: 120,  name: 'Raid range',        tip: 'How far scouts search (cells)' },
      { k: 'recruit',lo: 0.1,  hi: 1,    v: 0.55, name: 'Recruitment',       tip: 'Fraction of idle workers that join a raid' },
      { k: 'appease',lo: 0,    hi: 1,    v: 0.3,  name: 'Dufour appeasement',tip: 'Chemical weapon: lowers host aggression; helps queen usurpation; metabolic cost' },
      { k: 'want',   lo: 1,    hi: 10,   v: 4.5,  name: 'Slave target',      tip: 'Slaves per slavemaker before raiding stops' },
      { k: 'repro',  lo: 0.02, hi: 0.6,  v: 0.15, name: 'Gyne investment',   tip: 'Share of surplus food spent on new queens' },
    ],
    2: [ // Lasius generalist competitor (never raided)
      { k: 'aggr',   lo: 0,    hi: 1,    v: 0.4,  name: 'Aggression',        tip: 'Chance to attack other ants' },
      { k: 'explore',lo: 0.05, hi: 0.6,  v: 0.25, name: 'Search noise',      tip: 'Random turning while foraging' },
      { k: 'trail',  lo: 0,    hi: 1,    v: 0.75, name: 'Trail fidelity',    tip: 'How strongly foragers follow food trails' },
      { k: 'repro',  lo: 0.02, hi: 0.6,  v: 0.15, name: 'Gyne investment',   tip: 'Share of surplus food spent on new queens' },
    ],
  };

  SM.genomes = [];          // registry; ants and brood reference genomes by id
  SM.newGenome = function (sp, traits, parent, gen) {
    const g = { id: SM.genomes.length, sp, t: traits, parent: parent == null ? -1 : parent, gen: gen || 0 };
    SM.genomes.push(g);
    return g;
  };
  SM.defaultGenome = function (sp, jitter) {
    const t = {};
    for (const d of SM.TRAITS[sp]) {
      t[d.k] = SM.clamp(d.v + (jitter ? SM.randn() * jitter * (d.hi - d.lo) : 0), d.lo, d.hi);
    }
    return SM.newGenome(sp, t, -1, 0);
  };
  SM.mutateGenome = function (g, sp) {
    // sp may differ only when cloning across species (never in practice)
    const t = {};
    const m = SM.CFG.mutation;
    for (const d of SM.TRAITS[sp]) {
      const base = g && g.sp === sp ? g.t[d.k] : d.v;
      t[d.k] = SM.clamp(base + SM.randn() * m * (d.hi - d.lo), d.lo, d.hi);
    }
    return SM.newGenome(sp, t, g ? g.id : -1, g ? g.gen + 1 : 0);
  };
})(globalThis.SM = globalThis.SM || {});
