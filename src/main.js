// main.js — wires simulation, 3-D renderer, camera, labels, alerts, charts and controls.
(function (SM) {
  'use strict';
  const C = SM.CFG, SP = SM.SP, ST = SM.ST;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let sim, R, charts;
  let running = true, speed = 4, turbo = false, frame = 0;
  let tpsTicks = 0, tpsT = performance.now(), tps = 0;
  let follow = null;          // 'raid' | null
  let camGoal = null;         // smooth fly-to target

  try { R = new SM.Renderer3D($('gl')); }
  catch (e) { $('err').hidden = false; $('err').textContent = 'This simulation needs WebGL2: ' + e.message; return; }
  charts = new SM.Charts($('popChart'), $('popLegend'), $('traits'));

  const spName = (sp) => (sp === SP.P ? 'Polyergus' : sp === SP.F ? 'Formica' : 'Lasius');
  const spColor = (sp) => (sp === SP.P ? SM.ROLE.slaver : sp === SP.F ? SM.ROLE.host : SM.ROLE.lasius);

  function newSim() {
    sim = new SM.Sim({ seed: +$('seed').value || 1, hosts: +$('hosts').value, lasius: +$('lasius').value, slavers: 1 });
    R.selected = null; follow = null; camGoal = null; lastEvent = 0;
    $('labels').innerHTML = ''; labelEls.clear();
    renderInspector(); charts.update(sim, true); renderLog(true);
  }

  // ---------- layout ----------
  function fit() { R.resize(window.innerWidth, window.innerHeight); if (sim) charts.update(sim, true); }
  window.addEventListener('resize', fit);

  // ---------- controls ----------
  $('play').onclick = () => { running = !running; $('play').textContent = running ? 'Pause' : 'Play'; };
  $('step').onclick = () => { if (running) $('play').click(); sim.step(); };
  $('speed').onchange = (e) => { turbo = e.target.value === 'turbo'; speed = turbo ? 1 : +e.target.value; };
  $('reset').onclick = newSim;
  $('queen').onclick = () => sim.immigrantGyne(SP.P);
  $('panelToggle').onclick = () => $('side').classList.toggle('hidden');
  const bindRange = (id, fmt, apply) => {
    const el = $(id), out = $(id + 'V');
    const f = () => { if (out) out.textContent = fmt(+el.value); if (apply) apply(+el.value); };
    el.addEventListener('input', f); f();
  };
  bindRange('hosts', (v) => v); bindRange('lasius', (v) => v);
  bindRange('food', (v) => v.toFixed(1) + '×', (v) => { C.foodRate = v; });
  bindRange('mut', (v) => v.toFixed(2), (v) => { C.mutation = v; });
  $('rebel').onchange = (e) => { C.rebellionOn = e.target.checked; };
  $('reseed').onchange = (e) => { C.autoReseed = e.target.checked; };
  $('tRoles').onchange = (e) => { R.mode = e.target.checked ? 'roles' : 'natural'; renderLegend(); };
  $('tTags').onchange = (e) => { R.markers = e.target.checked; };
  $('tRings').onchange = (e) => { R.rings = e.target.checked; };
  $('tLabels').onchange = (e) => { $('labels').style.display = e.target.checked ? '' : 'none'; };

  const PH_NAMES = ['Formica trail', 'Lasius trail', 'Raid trail', 'Alarm', 'Dufour'];
  $('phToggles').innerHTML = '<span style="color:var(--muted)">Pheromones:</span>' + PH_NAMES.map((n, k) =>
    `<label><input type="checkbox" data-k="${k}"><i class="sw" style="background:${SM.PH_COL[k]}"></i>${n}</label>`).join('');
  $('phToggles').addEventListener('change', (e) => { R.layers[+e.target.dataset.k] = e.target.checked; });

  function renderLegend() {
    const nat = [['#2a282d', 'Free <em>Formica</em> (host)'], ['#9a3a1f', '<em>Polyergus</em> (slavemaker)'],
      ['#2a282d', '<em>Formica</em> slave <span style="color:#ff8a1f">■</span> tag'], ['#47362a', '<em>Lasius</em>']];
    const role = [[SM.ROLE.host, 'Free <em>Formica</em>'], [SM.ROLE.slaver, '<em>Polyergus</em>'], [SM.ROLE.slave, 'Enslaved <em>Formica</em>'], [SM.ROLE.lasius, '<em>Lasius</em>']];
    const items = (R.mode === 'roles' ? role : nat).concat([['#ece0c2', 'Stolen / rescued pupa'], ['#c9a25a', 'Food'], ['#e2b13c', 'Honeydew (aphid plant)']]);
    $('legend').innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  }
  renderLegend();

  // ---------- camera: orbit / free-fly / ride-an-ant ----------
  const keys = new Set();
  let camMode = 'orbit';                       // 'orbit' | 'fly' | 'ant'
  const fly = { x: 0, y: 40, z: 0, yaw: 0, pitch: -0.5, speed: 1 };
  const ride = { i: -1, aid: 0, view: 'chase', eye: null, head: 0, yawOff: 0, pitchOff: 0.5, dist: 7 };
  const ST_TEXT = {
    [ST.IN]: 'inside the nest', [ST.FORAGE]: 'foraging', [ST.RETURN]: 'heading home', [ST.SCOUT]: 'scouting for Formica nests',
    [ST.SCOUT_BACK]: 'returning to recruit a raid (laying raid trail)', [ST.RAID]: 'raiding', [ST.DEFEND]: 'defending the nest',
    [ST.EVAC]: 'evacuating brood from a raid', [ST.FIGHT]: 'fighting', [ST.GYNE]: 'nuptial flight / searching for a nest site',
  };
  const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);

  function setMode(m) {
    if (m === 'fly' && camMode !== 'fly') {
      const e = R.eyePos || R.eye(), t = R.target || [R.cam.tx, 0, R.cam.tz];
      fly.x = e[0]; fly.y = e[1]; fly.z = e[2];
      const dx = t[0] - e[0], dy = t[1] - e[1], dz = t[2] - e[2];
      fly.yaw = Math.atan2(-dx, -dz); fly.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    if (m === 'orbit' && camMode !== 'orbit') {   // continue orbiting around what we were looking at
      const t = R.target;
      if (t) { R.cam.tx = SM.clamp(t[0], 0, C.W); R.cam.tz = SM.clamp(t[2], 0, C.H); R.cam.dist = Math.max(25, Math.min(120, R.viewDist || 60)); }
      R.override = null;
    }
    camMode = m;
    $('camOrbit').classList.toggle('on', m === 'orbit');
    $('camFly').classList.toggle('on', m === 'fly');
    $('rideBtn').classList.toggle('on', m === 'ant');
    $('antCard').hidden = m !== 'ant';
    $('help').textContent = m === 'fly'
      ? 'Free fly: W A S D move · Q / E down / up · drag: look · Shift: boost · wheel: speed · Esc: back to orbit'
      : m === 'ant' ? 'Riding an ant: drag to look around it · wheel: distance · V: chase / ant-eye view · N: next ant · Esc: stop riding'
      : 'Orbit: drag pan · right-drag / Shift-drag rotate · wheel zoom · W A S D · Q E rotate · R F tilt · click a nest or an ant · F2 free fly';
    if (m !== 'orbit') { follow = null; camGoal = null; $('camRaid').classList.remove('on'); }
  }

  window.addEventListener('keydown', (e) => {
    if (typing()) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); return; }
    if (k === 'escape') { setMode('orbit'); return; }
    if (k === 'f2') { e.preventDefault(); setMode(camMode === 'fly' ? 'orbit' : 'fly'); return; }
    if (camMode === 'ant' && k === 'v') { ride.view = ride.view === 'chase' ? 'eye' : 'chase'; return; }
    if (camMode === 'ant' && k === 'n') { rideRole($('rideRole').value, true); return; }
    keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  function clampCam() {
    const c = R.cam;
    c.tx = SM.clamp(c.tx, 0, C.W); c.tz = SM.clamp(c.tz, 0, C.H);
    c.pitch = SM.clamp(c.pitch, 0.12, 1.45); c.dist = SM.clamp(c.dist, 6, 560);
  }
  function flyTo(x, z, dist, pitch) {
    if (camMode !== 'orbit') setMode('orbit');
    camGoal = { tx: x, tz: z, dist: dist || R.cam.dist, pitch: pitch === undefined ? R.cam.pitch : pitch };
  }
  let lastT = performance.now();
  function camUpdate(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    const K = (k) => keys.has(k);
    if (camMode === 'orbit') {
      const c = R.cam, mv = c.dist * 0.9 * dt;
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      let used = false;
      if (K('w') || K('arrowup')) { c.tx += fx * mv; c.tz += fz * mv; used = true; }
      if (K('s') || K('arrowdown')) { c.tx -= fx * mv; c.tz -= fz * mv; used = true; }
      if (K('a') || K('arrowleft')) { c.tx -= rx * mv; c.tz -= rz * mv; used = true; }
      if (K('d') || K('arrowright')) { c.tx += rx * mv; c.tz += rz * mv; used = true; }
      if (K('q')) { c.yaw += 1.6 * dt; used = true; } if (K('e')) { c.yaw -= 1.6 * dt; used = true; }
      if (K('r')) { c.pitch += 0.9 * dt; used = true; } if (K('f')) { c.pitch -= 0.9 * dt; used = true; }
      if (K('z')) { c.dist *= 1 - 1.5 * dt; used = true; } if (K('x')) { c.dist *= 1 + 1.5 * dt; used = true; }
      if (used) { follow = null; camGoal = null; $('camRaid').classList.remove('on'); clampCam(); }
      if (follow === 'raid') {
        const t = raidFocus();
        if (t) camGoal = { tx: t[0], tz: t[1], dist: Math.min(c.dist, 90), pitch: c.pitch };
        else { follow = null; $('camRaid').classList.remove('on'); }
      }
      if (camGoal) {
        const k = 1 - Math.pow(0.006, dt);
        c.tx += (camGoal.tx - c.tx) * k; c.tz += (camGoal.tz - c.tz) * k;
        c.dist += (camGoal.dist - c.dist) * k; c.pitch += (camGoal.pitch - c.pitch) * k;
        if (!follow && Math.abs(camGoal.tx - c.tx) + Math.abs(camGoal.tz - c.tz) + Math.abs(camGoal.dist - c.dist) < 0.5) camGoal = null;
      }
      R.override = null;
    } else if (camMode === 'fly') {
      const sp = fly.speed * (K('shift') ? 4 : 1) * 40 * dt;
      const cp = Math.cos(fly.pitch);
      const f = [-Math.sin(fly.yaw) * cp, Math.sin(fly.pitch), -Math.cos(fly.yaw) * cp], r = [Math.cos(fly.yaw), 0, -Math.sin(fly.yaw)];
      const add = (v, s) => { fly.x += v[0] * s; fly.y += v[1] * s; fly.z += v[2] * s; };
      if (K('w') || K('arrowup')) add(f, sp); if (K('s') || K('arrowdown')) add(f, -sp);
      if (K('d') || K('arrowright')) add(r, sp); if (K('a') || K('arrowleft')) add(r, -sp);
      if (K('e')) fly.y += sp; if (K('q')) fly.y -= sp;
      fly.x = SM.clamp(fly.x, -150, C.W + 150); fly.z = SM.clamp(fly.z, -150, C.H + 150);
      fly.y = SM.clamp(fly.y, R.surfaceAt(SM.clamp(fly.x, 0, C.W - 1), SM.clamp(fly.z, 0, C.H - 1)) + 0.5, 600);
      R.override = { eye: [fly.x, fly.y, fly.z], target: [fly.x + f[0], fly.y + f[1], fly.z + f[2]], fov: 1.0 };
    } else updateRide(dt);
  }

  // centroid of the active raid column (raiders out, or carrying loot home)
  function raidFocus() {
    let col = null;
    for (const c of sim.colonies) if (c && c.alive && c.sp === SP.P && c.raidActive) { if (!col || c === R.selected) col = c; }
    if (!col) return null;
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < sim.hi; i++) {
      if (!sim.alive[i] || sim.col[i] !== col.idx || sim.sp[i] !== SP.P) continue;
      const s = sim.st[i] === ST.FIGHT ? sim.prev[i] : sim.st[i];
      if (s === ST.RAID || (s === ST.RETURN && sim.carry[i] === 2)) { sx += sim.x[i]; sz += sim.y[i]; n++; }
    }
    return n ? [sx / n, sz / n] : [col.x, col.y];
  }

  // ---------- ride an ant ----------
  function antRole(i) {
    const s = sim.sp[i], c = sim.colonies[sim.col[i]], st = sim.st[i] === ST.FIGHT ? sim.prev[i] : sim.st[i];
    if (sim.st[i] === ST.GYNE) return 'queen';
    if (s === SP.P) return st === ST.SCOUT || st === ST.SCOUT_BACK ? 'scout' : (st === ST.RAID || sim.carry[i] === 2) ? 'raider' : 'slavemaker';
    if (s === SP.L) return 'lasius';
    return c && c.sp === SP.P ? 'slave' : 'host';
  }
  function startRide(i) {
    ride.i = i; ride.aid = sim.aid[i]; ride.eye = null; ride.head = sim.a[i]; ride.yawOff = 0;
    setMode('ant'); renderAntCard(true);
  }
  function rideRole(role, next) {
    const want = role === 'any' ? null : role, cand = [];
    const t = R.target || [R.cam.tx, 0, R.cam.tz];
    for (let i = 0; i < sim.hi; i++) {
      if (!sim.alive[i] || sim.st[i] === ST.IN) continue;
      if (next && i === ride.i) continue;
      if (want && antRole(i) !== want) continue;
      cand.push([i, (sim.x[i] - t[0]) ** 2 + (sim.y[i] - t[2]) ** 2]);
    }
    if (!cand.length) {
      const why = { raider: 'No raid column out right now. Raids start in the late afternoon', scout: 'No scouts out right now', queen: 'No queen is flying right now' }[role];
      return toast(why || 'No such ant outside the nests right now', 'bad');
    }
    cand.sort((a, b) => a[1] - b[1]);
    const pick = cand[Math.floor(Math.random() * Math.min(8, cand.length))][0];
    startRide(pick);
  }
  $('rideBtn').onclick = () => rideRole($('rideRole').value, camMode === 'ant');
  $('antStop').onclick = () => setMode('orbit');
  $('antView').onclick = () => { ride.view = ride.view === 'chase' ? 'eye' : 'chase'; };
  $('antNext').onclick = () => rideRole($('rideRole').value, true);

  function updateRide(dt) {
    const i = ride.i;
    if (i < 0 || sim.aid[i] !== ride.aid || !sim.alive[i]) {
      if (i >= 0 && sim.aid[i] === ride.aid) {
        const by = sim.deathBy[i];
        toast(by >= 0 ? `Your ant was killed by a ${spName(by)} worker` : 'Your ant died (old age or starvation)', 'bad');
      } else toast('Lost track of that ant', 'bad');
      ride.i = -1; setMode('orbit'); return;
    }
    const inside = sim.st[i] === ST.IN;
    const c = sim.colonies[sim.col[i]];
    let px = sim.x[i], pz = sim.y[i];
    if (inside && c) { px = c.x; pz = c.y; }
    let py = R.surfaceAt(px, pz);
    if (sim.st[i] === ST.GYNE) py += 4;
    let d = sim.a[i] - ride.head; d = Math.atan2(Math.sin(d), Math.cos(d));
    ride.head += d * (1 - Math.pow(0.02, dt));
    const yaw = ride.head + ride.yawOff, dx = Math.cos(yaw), dz = Math.sin(yaw);
    let eye, tgt, fov;
    if (ride.view === 'eye' && !inside) {
      // just above and behind the head, so nestmates on the trail don't block the lens
      eye = [px - dx * 0.4, py + 1.9, pz - dz * 0.4];
      tgt = [px + dx * 14, py + 1.2 - ride.pitchOff * 3, pz + dz * 14];
      fov = 1.25;
    } else {
      const back = inside ? 14 : ride.dist, up = (inside ? 9 : ride.dist * 0.55) * (0.4 + ride.pitchOff);
      const want = [px - dx * back, py + up, pz - dz * back];
      want[1] = Math.max(want[1], R.surfaceAt(SM.clamp(want[0], 0, C.W - 1), SM.clamp(want[2], 0, C.H - 1)) + 0.6);
      if (!ride.eye) ride.eye = want;
      const k = 1 - Math.pow(0.0005, dt);
      ride.eye = ride.eye.map((v, j) => v + (want[j] - v) * k);
      eye = ride.eye; tgt = [px + dx * 2, py + 0.6, pz + dz * 2]; fov = 0.95;
    }
    R.override = { eye, target: tgt, fov };
    if (frame % 6 === 0) renderAntCard();
  }

  function renderAntCard(force) {
    const i = ride.i; if (i < 0 || !sim.alive[i]) return;
    const s = sim.sp[i], c = sim.colonies[sim.col[i]], role = antRole(i);
    const title = { raider: 'Polyergus raider', scout: 'Polyergus scout', slavemaker: 'Polyergus worker', slave: 'Enslaved Formica worker',
      host: 'Formica worker (free)', lasius: 'Lasius worker', queen: `${spName(s)} queen (gyne)` }[role];
    const col = role === 'slave' ? SM.ROLE.slave : spColor(s);
    const st = sim.st[i], task = st === ST.FIGHT ? `fighting (while ${ST_TEXT[sim.prev[i]]})` : ST_TEXT[st];
    const rows = [];
    if (c) rows.push(['Colony', `${spName(c.sp)} #${c.uid}`]);
    if (role === 'slave') {
      const natal = sim.colonies.find(k => k && k.alive && k.g.id === sim.gid[i]);
      const born = sim.gid[i] === sim.hostPoolGid ? 'the founding slave population'
        : natal ? (natal.sp === SP.F ? `Formica #${natal.uid}, stolen as brood` : `#${natal.uid} (since usurped)`) : 'a host colony that has since died out';
      rows.push(['Born in', born]);
      const g = SM.genomes[sim.gid[i]].t;
      rows.push(['Natal genes', `aggression ${g.aggr.toFixed(2)} · rebellion ${g.rebel.toFixed(2)}`]);
    }
    rows.push(['Doing', task]);
    if (sim.carry[i] === 2) { const b = sim.cargo[i]; rows.push(['Carrying', `${b && b.age < C.DEV ? 'a larva' : 'a pupa'} (${b && b.sp === SP.P ? 'Polyergus' : 'Formica'})`]); }
    else if (sim.carry[i] === 1) rows.push(['Carrying', 'food']);
    if (st === ST.RAID || st === ST.SCOUT_BACK) { const t = sim.colonies[sim.tgt[i]]; if (t) rows.push(['Target', `Formica #${t.uid}`]); }
    const hp = Math.max(0, sim.hp[i] / C.hp[s]);
    $('antCard').innerHTML = `<div class="ac-title"><i style="background:${col}"></i>${title} <small>#${sim.aid[i]}</small></div>
      <div class="kv">${rows.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div>
      <div class="hpbar"><div style="width:${(hp * 100).toFixed(0)}%"></div></div>
      <div class="row"><button id="antView2">${ride.view === 'chase' ? 'Ant-eye view (V)' : 'Chase view (V)'}</button><button id="antNext2">Next (N)</button><button id="antStop2">Stop (Esc)</button></div>`;
    $('antView2').onclick = () => { ride.view = ride.view === 'chase' ? 'eye' : 'chase'; renderAntCard(); };
    $('antNext2').onclick = () => rideRole($('rideRole').value, true);
    $('antStop2').onclick = () => setMode('orbit');
  }

  $('camOrbit').onclick = () => setMode('orbit');
  $('camFly').onclick = () => setMode(camMode === 'fly' ? 'orbit' : 'fly');
  $('camOverview').onclick = () => { follow = null; $('camRaid').classList.remove('on'); flyTo(C.W / 2, C.H / 2, 380, 0.95); };
  $('camSlaver').onclick = () => {
    const ps = sim.colonies.filter(c => c && c.alive && c.sp === SP.P);
    if (!ps.length) return toast('No slavemaker colony alive right now', 'bad');
    const cur = ps.indexOf(R.selected), c = ps[(cur + 1) % ps.length];
    R.selected = c; renderInspector(); follow = null; flyTo(c.x, c.y, 55, 0.75);
  };
  $('camRaid').onclick = () => {
    if (follow === 'raid') { follow = null; $('camRaid').classList.remove('on'); return; }
    if (!raidFocus()) return toast('No raid in progress. Slavemakers raid in the late afternoon', 'bad');
    if (camMode !== 'orbit') setMode('orbit');
    follow = 'raid'; $('camRaid').classList.add('on');
  };

  // ---------- pointer input ----------
  const cv = $('gl');
  const ptrs = new Map();
  let drag = null, pinch0 = 0;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    drag = { x: e.clientX, y: e.clientY, rot: e.button === 2 || e.shiftKey, moved: 0 };
    if (ptrs.size === 2) { const p = [...ptrs.values()]; pinch0 = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); }
    cv.classList.add('dragging');
  });
  cv.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (!drag) { hover(e); return; }
    const c = R.cam, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (camMode === 'fly') {
      fly.yaw -= dx * 0.004; fly.pitch = SM.clamp(fly.pitch - dy * 0.004, -1.5, 1.5); return;
    }
    if (camMode === 'ant') {
      ride.yawOff -= dx * 0.006; ride.pitchOff = SM.clamp(ride.pitchOff + dy * 0.004, 0, 1.6); return;
    }
    if (drag.moved > 4) { follow = null; camGoal = null; $('camRaid').classList.remove('on'); }
    if (ptrs.size === 2) {
      const p = [...ptrs.values()], d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      if (pinch0) c.dist *= pinch0 / d; pinch0 = d;
    } else if (drag.rot) { c.yaw -= dx * 0.006; c.pitch += dy * 0.004; }
    else {
      const s = c.dist * 0.0021;
      c.tx -= (Math.cos(c.yaw) * dx + Math.sin(c.yaw) * dy / Math.max(0.35, Math.sin(c.pitch))) * s;
      c.tz -= (-Math.sin(c.yaw) * dx + Math.cos(c.yaw) * dy / Math.max(0.35, Math.sin(c.pitch))) * s;
    }
    clampCam();
  });
  const end = (e) => {
    ptrs.delete(e.pointerId);
    if (drag && drag.moved < 5 && e.type === 'pointerup' && e.button === 0) click(e);
    if (!ptrs.size) { drag = null; cv.classList.remove('dragging'); }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.0012);
    if (camMode === 'fly') { fly.speed = SM.clamp(fly.speed / f, 0.05, 8); return; }
    if (camMode === 'ant') { ride.dist = SM.clamp(ride.dist * f, 2.5, 40); return; }
    R.cam.dist *= f; clampCam();
    if (camGoal) camGoal.dist = R.cam.dist;
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    if (camMode !== 'orbit') return;
    const p = R.pick(e.clientX, e.clientY); if (!p) return;
    follow = null; flyTo(p[0], p[1], Math.max(25, R.cam.dist * 0.45));
  });

  // nearest visible ant to a screen point (for click-to-ride)
  function antAt(sx, sy, maxPx) {
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < sim.hi; i++) {
      if (!sim.alive[i] || sim.st[i] === ST.IN) continue;
      const p = R.project(sim.x[i], R.surfaceAt(sim.x[i], sim.y[i]) + 0.4 + (sim.st[i] === ST.GYNE ? 4 : 0), sim.y[i]);
      if (!p) continue;
      const d = (p[0] - sx) ** 2 + (p[1] - sy) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function click(e) {
    const near = (R.viewDist || R.cam.dist) < 160;
    const a = near ? antAt(e.clientX, e.clientY, 14) : -1;
    if (a >= 0 && !(camMode === 'ant' && a === ride.i)) { startRide(a); return; }
    const p = R.pick(e.clientX, e.clientY); if (!p) return;
    R.selected = sim.colonyAt(p[0], p[1], 10);
    renderInspector();
  }
  function hover(e) {
    const tip = $('tip'), p = R.pick(e.clientX, e.clientY);
    const c = p && sim.colonyAt(p[0], p[1], 8);
    if (!c) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    tip.innerHTML = `<b>${spName(c.sp)} #${c.uid}</b><br>` + (c.sp === SP.P
      ? `${c.nP} slavemakers · <span style="color:#6fe0b4">${c.nSlaves} slaves</span>` : `${c.n} workers`) +
      ` · ${c.brood.length} brood${c.alarm ? '<br><span style="color:#ff8a7a">under attack</span>' : ''}`;
  }

  // ---------- nest labels ----------
  const labelEls = new Map();
  function renderLabels() {
    if ($('tLabels').checked === false) return;
    const layer = $('labels'), seen = new Set(), zoomed = R.cam.dist < 200;
    for (const c of sim.colonies) {
      if (!c || !c.alive) continue;
      const important = c.sp === SP.P || c === R.selected || c.alarm;
      if (!zoomed && !important) continue;
      const p = R.project(c.x, R.heightAt(c.x, c.y) + 6, c.y);
      if (!p || p[0] < -50 || p[1] < -20 || p[0] > R.cssW + 50 || p[1] > R.cssH + 20) continue;
      seen.add(c.uid);
      let el = labelEls.get(c.uid);
      if (!el) { el = document.createElement('div'); layer.appendChild(el); labelEls.set(c.uid, el); }
      el.className = 'nl' + (c.sp === SP.P ? ' p' : '') + (c.sp === SP.P && c.raidActive ? ' raid' : '');
      el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px';
      const html = `<i style="background:${spColor(c.sp)}"></i>${spName(c.sp)} #${c.uid} · ` + (c.sp === SP.P
        ? `${c.nP} <span class="s">+ ${c.nSlaves} slaves</span>${c.raidActive ? ' · RAIDING' : ''}`
        : `${c.n}${c.alarm ? ' · ⚠ raided' : ''}${c.queen ? '' : ' · queenless'}`);
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
    for (const [uid, el] of labelEls) if (!seen.has(uid)) { el.remove(); labelEls.delete(uid); }
  }

  // ---------- alerts ----------
  let lastEvent = 0;
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    const box = $('toasts'); box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, 5200);
  }
  function pumpToasts() {
    const ev = sim.events;
    // events array is trimmed; locate new ones by tick+index signature
    const fresh = ev.filter(e => e._seen !== true);
    for (const e of fresh) {
      e._seen = true;
      if (e.kind === 'raid') toast(e.msg, '');
      else if (e.kind === 'raidend') toast(e.msg, 'end');
      else if (e.kind === 'usurp') toast(e.msg, 'usurp');
      else if (e.kind === 'death' && /Polyergus|Slavemakers/.test(e.msg)) toast(e.msg, 'bad');
    }
  }

  // ---------- panels ----------
  function renderStats() {
    let free = 0, slaves = 0, poly = 0, las = 0, maxGen = 0, raiding = 0;
    for (const c of sim.colonies) {
      if (!c || !c.alive) continue;
      if (c.sp === SP.F) free += c.n; else if (c.sp === SP.L) las += c.n; else { slaves += c.nSlaves; poly += c.nP; if (c.raidActive) raiding++; }
      if (c.g.gen > maxGen) maxGen = c.g.gen;
    }
    const s = sim.stats;
    const cell = (k, v, cls) => `<div class="stat"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`;
    $('slaveStats').innerHTML = [
      cell('Slaves alive', slaves, 'slave'), cell('Slavemakers', poly, 'slaver'), cell('Slaves per master', poly ? (slaves / poly).toFixed(1) : '–'),
      cell('Raids', s.raids + (raiding ? ` <small style="color:#ff9a6a">(${raiding} live)</small>` : '')), cell('Brood stolen', s.pupaeStolen), cell('Slaves eclosed', s.slavesBorn, 'slave'),
      cell('Colonies usurped', s.usurpations), cell('Usurp. failed', s.usurpFail), cell('Rebellion kills', s.rebelKills),
    ].join('');
    $('stats').innerHTML = [
      cell('Formica colonies', sim.countColonies(SP.F)), cell('Polyergus col.', sim.countColonies(SP.P)), cell('Lasius colonies', sim.countColonies(SP.L)),
      cell('Free Formica', free), cell('Lasius', las), cell('Max generation', maxGen),
    ].join('');
    $('meta').textContent = `${sim.tick.toLocaleString()} ticks · ${sim.count.toLocaleString()} ants · ${Math.round(tps)} ticks/s`;
  }
  function renderClock() {
    const tod = sim.tod, day = Math.floor(sim.tick / C.DAY) + 1, mins = Math.floor(tod * 24 * 60);
    $('clockDay').textContent = `Day ${day}`;
    $('clockTime').textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    $('clockIcon').textContent = sim.daylight > 0.05 ? '☀' : '☾';
    const inWin = tod >= C.RAID_WINDOW[0] && tod <= C.RAID_WINDOW[1];
    $('raidHint').textContent = inWin ? '· raiding hours' : '';
  }

  function renderInspector() {
    const c = R.selected, el = $('inspect');
    if (!c) { el.innerHTML = '<p class="muted">Click a nest in the meadow.</p>'; return; }
    if (!c.alive) { el.innerHTML = `<p class="muted">Colony #${c.uid} has died.</p>`; return; }
    let pupae = 0; for (const b of c.brood) if (b.age >= C.DEV) pupae++;
    const isP = c.sp === SP.P, kv = [];
    if (isP) {
      let stolenBrood = 0; for (const b of c.brood) if (b.sp === SP.F) stolenBrood++;
      kv.push(['Polyergus workers (home)', `${c.nP} (${c.nPIn})`], ['Formica slaves (home)', `${c.nSlaves} (${c.nSlavesIn})`],
        ['Slaves per slavemaker', (c.nSlaves / Math.max(1, c.nP)).toFixed(2)],
        ['Stolen brood maturing', stolenBrood], ['Slaves eclosed here', c.slavesBorn],
        ['Raids launched', c.raids], ['Brood stolen (total)', c.pupaeStolen],
        ['Raid in progress', c.raidActive ? (sim.tick < c.raidDepart ? 'mustering' : `yes, ${c.raidersOut} out, ${c.raidLoot} brought home`) : 'no'],
        ['Mean slave rebellion', c.nSlaves ? (c.sumRebel / c.nSlaves).toFixed(3) : '–'], ['Pupae killed by slaves', c.rebelKills]);
    } else {
      kv.push(['Workers (home)', `${c.n} (${c.nIn})`], ['Brood lost to raids', c.pupaeLost]);
    }
    kv.push(['Brood (pupae)', `${c.brood.length} (${pupae})`], ['Food store', c.food.toFixed(1)], ['Gynes produced', c.gynes],
      ['Queen', c.queen ? 'alive' : 'dead'], ['Alarm at nest', c.alarmLvl.toFixed(2)], ['Dufour secretion at nest', c.propLvl.toFixed(2)]);
    const genes = SM.TRAITS[c.sp].map(d => {
      const v = c.g.t[d.k], f = (v - d.lo) / (d.hi - d.lo);
      return `<div class="gene" title="${esc(d.tip)}"><span>${d.name}</span><div class="bar"><div style="width:${(f * 100).toFixed(1)}%;background:${spColor(c.sp)}"></div></div><b>${d.hi > 10 ? v.toFixed(0) : v.toFixed(d.hi < 0.2 ? 3 : 2)}</b></div>`;
    }).join('');
    el.innerHTML = `<div class="title"><i style="background:${spColor(c.sp)}"></i>${spName(c.sp)} colony #${c.uid}</div>
      <div class="sub">genome gen ${c.g.gen}${c.usurpedAt >= 0 ? ` · usurped at t=${c.usurpedAt}` : ''} · founded t=${c.born}</div>
      <div class="kv">${kv.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>${genes}`;
  }

  let lastLogKey = '';
  function renderLog(force) {
    const ev = sim.events, key = ev.length ? ev[ev.length - 1].t + ':' + ev.length : '0';
    if (!force && key === lastLogKey) return;
    lastLogKey = key;
    $('log').innerHTML = ev.slice(-60).reverse().map(e => {
      const d = Math.floor(e.t / C.DAY) + 1, m = Math.floor((e.t % C.DAY) / C.DAY * 1440);
      return `<li class="${e.kind}"><time>D${d} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}</time><span>${esc(e.msg)}</span></li>`;
    }).join('');
  }

  // ---------- main loop ----------
  function loop(now) {
    if (running) {
      if (turbo) { const t0 = performance.now(); do { sim.step(); tpsTicks++; } while (performance.now() - t0 < 30); }
      else for (let k = 0; k < speed; k++) { sim.step(); tpsTicks++; }
    }
    camUpdate(now);
    R.draw(sim, now / 1000);
    renderLabels();
    if (now - tpsT > 1000) { tps = tpsTicks * 1000 / (now - tpsT); tpsTicks = 0; tpsT = now; }
    if (++frame % 6 === 0) { renderClock(); pumpToasts(); }
    if (frame % 15 === 0) { renderStats(); charts.update(sim); renderLog(); if (R.selected) renderInspector(); }
    requestAnimationFrame(loop);
  }

  // URL options: ?seed=7&hosts=12&warm=5000&cam=slaver|raid&select=P&ph=2
  const q = new URLSearchParams(location.search);
  for (const k of ['seed', 'hosts', 'lasius']) if (q.has(k)) { $(k).value = q.get(k); $(k).dispatchEvent(new Event('input')); }
  fit();
  newSim();
  if (q.has('warm')) { const n = +q.get('warm'); for (let i = 0; i < n; i++) sim.step(); }
  if (q.has('select')) { const sp = { P: SP.P, F: SP.F, L: SP.L }[q.get('select')]; R.selected = sim.colonies.find(c => c && c.alive && c.sp === sp) || null; }
  if (q.has('ph')) for (const k of q.get('ph').split(',')) R.layers[+k] = true;
  if (q.get('cam') === 'slaver' && R.selected) { R.cam.tx = R.selected.x; R.cam.tz = R.selected.y; R.cam.dist = +(q.get('dist') || 60); R.cam.pitch = 0.75; }
  if (q.get('cam') === 'raid') { const t = raidFocus(); if (t) { R.cam.tx = t[0]; R.cam.tz = t[1]; R.cam.dist = +(q.get('dist') || 70); R.cam.pitch = 0.7; } }
  if (q.get('cam') === 'xy') { R.cam.tx = +q.get('x'); R.cam.tz = +q.get('z'); R.cam.dist = +(q.get('dist') || 40); R.cam.pitch = +(q.get('pitch') || 0.7); }
  charts.update(sim, true); renderLog(true); renderInspector(); renderStats(); renderClock();
  for (const e of sim.events) e._seen = true;
  if (q.has('ride')) { rideRole(q.get('ride')); if (q.get('view') === 'eye') ride.view = 'eye'; }
  if (q.get('mode') === 'fly') setMode('fly');
  camUpdate(performance.now() - 16);
  R.draw(sim, 0); renderLabels();
  if (q.has('norings')) R.rings = false;
  if (q.has('nostatic')) R.skipStatic = true;
  if (q.has('nodyn')) R.skipDyn = true;
  if (q.has('noground')) R.skipGround = true;
  if (q.has('bench')) { // dev hook: time sim ticks and rendered frames, post to tools/server.py
    const px = new Uint8Array(4), gl = R.gl;
    let t0 = performance.now(); for (let k = 0; k < 600; k++) sim.step(); const simMs = (performance.now() - t0) / 600;
    t0 = performance.now();
    for (let k = 0; k < 40; k++) { R.draw(sim, k / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    const drawMs = (performance.now() - t0) / 40;
    t0 = performance.now(); for (let k = 0; k < 40; k++) R.buildDynamic(sim, k / 60); const cpuMs = (performance.now() - t0) / 40;
    const x = new XMLHttpRequest(); x.open('POST', '/result', false);
    x.send(JSON.stringify({ ms: 0, ticks: sim.tick, err: null, png: R.canvas.toDataURL('image/png'),
      lines: [`ants=${sim.count} outside=${R.dyn.n} boxes; sim ${simMs.toFixed(2)} ms/tick; draw ${drawMs.toFixed(2)} ms/frame (CPU scene build ${cpuMs.toFixed(2)} ms); renderer ${gl.getParameter(gl.RENDERER)}`] }));
  }
  if (q.has('snap')) { // dev hook: post the rendered frame to tools/server.py (headless screenshots skip WebGL)
    const x = new XMLHttpRequest(); x.open('POST', '/result', false);
    x.send(JSON.stringify({ png: R.canvas.toDataURL('image/png'), ms: 0, ticks: sim.tick, err: null, lines: [] }));
  }
  requestAnimationFrame(loop);
  SM.debug = { get sim() { return sim; }, R, charts };
})(globalThis.SM);
