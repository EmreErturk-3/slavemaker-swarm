// render3d.js — WebGL2 3-D renderer: grass terrain, voxel ants, nest mounds, food, aphid plants, day/night.
// Sim coordinates (x, y) map to world (X, Z); Y is up. One world unit = one sim cell.
(function (SM) {
  'use strict';
  const C = SM.CFG, SP = SM.SP, ST = SM.ST;

  // ---------- palettes ----------
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  SM.ROLE = { host: '#3987e5', slaver: '#d95926', slave: '#199e70', lasius: '#c98500' };
  SM.PH_COL = ['#5aa7ff', '#ffc233', '#ff5a2a', '#ff6b8a', '#b18cff'];
  SM.COLORS = { host: SM.ROLE.host, slaver: SM.ROLE.slaver, slave: SM.ROLE.slave, lasius: SM.ROLE.lasius };
  const NAT = {
    // natural colours: Formica fusca black-grey, Polyergus red-brown, Lasius niger dark brown
    0: { gaster: hex('#1b1a1e'), thorax: hex('#2a282d'), head: hex('#201f23'), leg: hex('#36333a') },
    1: { gaster: hex('#5c1f12'), thorax: hex('#9a3a1f'), head: hex('#8a301a'), leg: hex('#a8492a') },
    2: { gaster: hex('#2f241c'), thorax: hex('#47362a'), head: hex('#3b2d23'), leg: hex('#55432f') },
  };
  const SCALE = [1.0, 1.1, 0.78];   // relative body length (F. fusca ~6 mm, Polyergus ~7 mm, L. niger ~4 mm)
  const ANT = 1.45;                 // world size multiplier so ants read at map scale

  // ---------- deterministic noise for terrain (render-only, independent of the sim RNG) ----------
  function h2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s) { return vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15; }

  // ---------- shaders ----------
  const COMMON = `
  uniform vec3 uSunDir, uSunCol, uAmb, uFogCol; uniform float uFogDen; uniform vec3 uEye;
  vec3 light(vec3 base, vec3 n, vec3 wp){
    float d = max(dot(n, uSunDir), 0.0);
    float hemi = 0.5 + 0.5*n.y;
    vec3 c = base * (uAmb * (0.55 + 0.45*hemi) + uSunCol * d);
    float f = 1.0 - exp(-pow(length(wp - uEye) * uFogDen, 1.6));
    return mix(c, uFogCol, clamp(f, 0.0, 1.0));
  }`;

  const VS_SKY = `#version 300 es
  in vec2 p; out float vY;
  void main(){ vY = p.y*0.5+0.5; gl_Position = vec4(p, 0.9999, 1.); }`;
  const FS_SKY = `#version 300 es
  precision mediump float; in float vY; out vec4 o;
  uniform vec3 uTop, uHor;
  void main(){ o = vec4(mix(uHor, uTop, pow(vY, 0.8)), 1.); }`;

  const VS_GROUND = `#version 300 es
  in vec3 aPos; in vec3 aNor;
  uniform mat4 uVP; uniform vec2 uGrid;
  out vec3 vW; out vec3 vN; out vec2 vUv;
  void main(){ vW = aPos; vN = aNor; vUv = aPos.xz / uGrid; gl_Position = uVP * vec4(aPos, 1.); }`;
  const FS_GROUND = `#version 300 es
  precision highp float;
  in vec3 vW; in vec3 vN; in vec2 vUv; out vec4 o;
  uniform sampler2D uGround, uP0, uP1, uP2, uP3, uP4;
  uniform float uOn[5]; uniform vec3 uPhCol[5];
  uniform vec4 uNest[48]; uniform vec4 uNestF[48]; uniform int uNestN; uniform vec3 uKindCol[3];
  uniform highp usampler2D uNestGrid;   // per 16x16 cell: up to 4 nest indices (+1) whose rings reach it
  uniform float uTime, uRings; uniform vec2 uGrid;
  ${COMMON}
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec3 base = texture(uGround, vUv).rgb;
    // fine grass texture: sub-cell blades
    vec2 g = floor(vW.xz * 3.0);
    float h = hash(g), h2 = hash(g + 17.3);
    base *= 0.86 + 0.24*h;
    base = mix(base, base*vec3(0.85,1.08,0.8), step(0.82, h2)*0.6);
    vec3 c = light(base, normalize(vN), vW);
    // optional pheromone vision
    if (uOn[0] + uOn[1] + uOn[2] + uOn[3] + uOn[4] > 0.0) {
      float ph[5];
      ph[0] = texture(uP0, vUv).r; ph[1] = texture(uP1, vUv).r; ph[2] = texture(uP2, vUv).r;
      ph[3] = texture(uP3, vUv).r; ph[4] = texture(uP4, vUv).r;
      for (int k = 0; k < 5; k++) c = mix(c, uPhCol[k], uOn[k] * (1.0 - exp(-ph[k]*1.1)) * 0.75);
    }
    // colony rings: identity, selection, alarm, newly eclosed slaves
    uvec4 ids = texelFetch(uNestGrid, ivec2(clamp(vW.xz / 16.0, vec2(0.0), uGrid / 16.0 - 1.0)), 0);
    if (uRings > 0.5) for (int s = 0; s < 4; s++) {
      int id = int(ids[s]) - 1;
      if (id < 0) break;
      vec4 n = uNest[id]; vec4 f = uNestF[id];
      float d = length(vW.xz - n.xy);
      float ring = smoothstep(0.45, 0.0, abs(d - n.z));
      if (ring <= 0.0) { if (f.x > 0.5) { float r2 = smoothstep(0.5, 0.0, abs(d - n.z - 1.3)); c = mix(c, vec3(1.0), r2*0.9); } continue; }
      vec3 rc = uKindCol[int(n.w)];
      float a = 0.6;
      if (f.y > 0.5) { rc = mix(rc, vec3(1.0,0.25,0.2), 0.5+0.5*sin(uTime*9.0)); a = 0.9; }
      c = mix(c, rc, ring * a);
      if (f.x > 0.5) { float r2 = smoothstep(0.5, 0.0, abs(d - n.z - 1.3)); c = mix(c, vec3(1.0), r2*0.9); }
      if (f.z > 0.0) { float r3 = smoothstep(0.6, 0.0, abs(d - (n.z - 4.0 + f.z*10.0))); c = mix(c, uKindCol[1]*0.0 + vec3(0.1,0.85,0.6), r3*(1.0-f.z)); }
    }
    o = vec4(c, 1.);
  }`;

  const VS_BOX = `#version 300 es
  in vec3 aPos; in vec3 aNor;
  in vec3 iPos; in vec3 iSize; in float iYaw; in vec3 iCol;
  uniform mat4 uVP;
  out vec3 vW; out vec3 vN; out vec3 vC;
  void main(){
    float c = cos(iYaw), s = sin(iYaw);
    vec3 l = aPos * iSize;
    vec3 r = vec3(c*l.x - s*l.z, l.y, s*l.x + c*l.z);
    vN = vec3(c*aNor.x - s*aNor.z, aNor.y, s*aNor.x + c*aNor.z);
    vW = iPos + r; vC = iCol;
    gl_Position = uVP * vec4(vW, 1.);
  }`;
  const FS_BOX = `#version 300 es
  precision highp float;
  in vec3 vW; in vec3 vN; in vec3 vC; out vec4 o;
  ${COMMON}
  void main(){ o = vec4(light(vC, normalize(vN), vW), 1.); }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  // ---------- small mat4 helpers (column-major) ----------
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(e, t, up) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  }
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  // unit cube, 36 vertices with face normals
  function cubeGeometry() {
    const P = [], N = [];
    const faces = [
      [[1, 0, 0], [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]]],
      [[-1, 0, 0], [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]]],
      [[0, 1, 0], [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]]],
      [[0, -1, 0], [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]]],
      [[0, 0, 1], [[.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [-.5, -.5, .5]]],
      [[0, 0, -1], [[-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [.5, -.5, -.5]]],
    ];
    for (const [n, v] of faces) for (const k of [0, 1, 2, 0, 2, 3]) { P.push(...v[k]); N.push(...n); }
    return { P: new Float32Array(P), N: new Float32Array(N) };
  }

  // ---------- instance buffer builder ----------
  class Boxes {
    constructor(cap) { this.d = new Float32Array(cap * 10); this.n = 0; this.cap = cap; }
    reset() { this.n = 0; }
    append(o) { const n = Math.min(o.n, this.cap - this.n); this.d.set(o.d.subarray(0, n * 10), this.n * 10); this.n += n; }
    push(x, y, z, sx, sy, sz, yaw, c) {
      if (this.n >= this.cap) return;
      const d = this.d, o = this.n++ * 10;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = sx; d[o + 4] = sy; d[o + 5] = sz; d[o + 6] = yaw;
      d[o + 7] = c[0]; d[o + 8] = c[1]; d[o + 9] = c[2];
    }
  }

  class Renderer3D {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;
      this.layers = [false, false, false, false, false];
      this.rings = true; this.mode = 'natural'; this.markers = true;
      this.selected = null;
      this.cam = { tx: C.W / 2, tz: C.H / 2, yaw: 0.35, pitch: 0.95, dist: 380 };
      this.sky = compile(gl, VS_SKY, FS_SKY);
      this.ground = compile(gl, VS_GROUND, FS_GROUND);
      this.box = compile(gl, VS_BOX, FS_BOX);

      // sky quad
      this.skyVao = gl.createVertexArray(); gl.bindVertexArray(this.skyVao);
      let b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      let l = gl.getAttribLocation(this.sky.p, 'p'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);

      this.buildTerrain();

      // box programs: one VAO per instance buffer (static decoration, dynamic scene)
      const cube = cubeGeometry();
      this.cubeP = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeP); gl.bufferData(gl.ARRAY_BUFFER, cube.P, gl.STATIC_DRAW);
      this.cubeN = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeN); gl.bufferData(gl.ARRAY_BUFFER, cube.N, gl.STATIC_DRAW);
      this.stat = new Boxes(40000); this.dyn = new Boxes(90000);
      this.statVao = this.makeBoxVao(); this.dynVao = this.makeBoxVao();
      gl.bindVertexArray(null);

      // field textures: pheromones (R16F, linear) + ground colour (RGBA8)
      this.phTex = [];
      for (let i = 0; i < SM.NCH; i++) {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, C.W, C.H, 0, gl.RED, gl.FLOAT, null);
        this.phTex.push(t);
      }
      this.groundTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.groundTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      this.phCol = new Float32Array(SM.PH_COL.flatMap(hex));
      this.kindCol = new Float32Array([...hex(SM.ROLE.host), ...hex(SM.ROLE.slaver), ...hex(SM.ROLE.lasius)]);
      this.nestU = new Float32Array(48 * 4); this.nestF = new Float32Array(48 * 4);
      this.gridW = Math.ceil(C.W / 16); this.gridH = Math.ceil(C.H / 16);
      this.nestGrid = new Uint8Array(this.gridW * this.gridH * 4);
      this.nestGridTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.nestGridTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, this.gridW, this.gridH, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, null);
      this.sim = null; this.nestKey = ''; this.foodCache = new Boxes(14000); this.foodFrame = -99; this.frame = 0;
    }

    makeBoxVao() {
      const gl = this.gl, p = this.box.p;
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeP);
      let l = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeN);
      l = gl.getAttribLocation(p, 'aNor'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      const S = 40;
      const attr = (name, size, off) => {
        const a = gl.getAttribLocation(p, name); gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, size, gl.FLOAT, false, S, off); gl.vertexAttribDivisor(a, 1);
      };
      attr('iPos', 3, 0); attr('iSize', 3, 12); attr('iYaw', 1, 24); attr('iCol', 3, 28);
      vao.ib = ib;
      return vao;
    }

    // ---------- terrain ----------
    heightAt(x, z) {
      const s = this.hStep, gx = SM.clamp(x / s, 0, this.hW - 1.001), gz = SM.clamp(z / s, 0, this.hH - 1.001);
      const xi = gx | 0, zi = gz | 0, fx = gx - xi, fz = gz - zi, W = this.hW, h = this.hgt;
      const a = h[zi * W + xi], b = h[zi * W + xi + 1], c = h[(zi + 1) * W + xi], d = h[(zi + 1) * W + xi + 1];
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    }
    buildTerrain() {
      const gl = this.gl, s = 2, W = Math.floor(C.W / s) + 1, H = Math.floor(C.H / s) + 1;
      this.hStep = s; this.hW = W; this.hH = H;
      const hgt = new Float32Array(W * H);
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        hgt[z * W + x] = (fbm(x * s / 70, z * s / 70, 3) - 0.5) * 7 + (vnoise(x * s / 18, z * s / 18, 9) - 0.5) * 1.2;
      }
      this.hgt = hgt;
      const pos = new Float32Array(W * H * 3), nor = new Float32Array(W * H * 3);
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        const k = z * W + x;
        pos[k * 3] = x * s; pos[k * 3 + 1] = hgt[k]; pos[k * 3 + 2] = z * s;
        const hl = hgt[z * W + Math.max(0, x - 1)], hr = hgt[z * W + Math.min(W - 1, x + 1)];
        const hd = hgt[Math.max(0, z - 1) * W + x], hu = hgt[Math.min(H - 1, z + 1) * W + x];
        let nx = hl - hr, ny = 2 * s, nz = hd - hu; const l = Math.hypot(nx, ny, nz);
        nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
      }
      const idx = new Uint32Array((W - 1) * (H - 1) * 6);
      let n = 0;
      for (let z = 0; z < H - 1; z++) for (let x = 0; x < W - 1; x++) {
        const a = z * W + x, b = a + 1, c = a + W, d = c + 1;
        idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
      this.groundN = n;
      this.groundVao = gl.createVertexArray(); gl.bindVertexArray(this.groundVao);
      let b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      let l = gl.getAttribLocation(this.ground.p, 'aPos'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
      b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
      l = gl.getAttribLocation(this.ground.p, 'aNor'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
      b = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      // base ground colour: meadow greens, dry patches, bare soil
      const g = new Uint8Array(C.W * C.H * 4);
      for (let y = 0; y < C.H; y++) for (let x = 0; x < C.W; x++) {
        const lush = fbm(x / 40, y / 40, 21), dry = fbm(x / 23, y / 23, 33), bare = fbm(x / 15, y / 15, 51);
        // meadow: muted greens, straw-coloured dry patches, bare soil
        let r = 0.17 + 0.12 * (1 - lush), gg = 0.30 + 0.07 * lush, bb = 0.11 + 0.02 * lush;
        if (dry > 0.58) { const t = Math.min(1, (dry - 0.58) * 4); r += 0.15 * t; gg += 0.07 * t; bb += 0.04 * t; }
        if (bare > 0.7) { const t = Math.min(1, (bare - 0.7) * 5); r = r * (1 - t) + 0.34 * t; gg = gg * (1 - t) + 0.27 * t; bb = bb * (1 - t) + 0.19 * t; }
        const j = (h2(x, y, 5) - 0.5) * 0.06;
        const k = (y * C.W + x) * 4;
        g[k] = SM.clamp((r + j) * 255, 0, 255); g[k + 1] = SM.clamp((gg + j) * 255, 0, 255); g[k + 2] = SM.clamp((bb + j * 0.5) * 255, 0, 255); g[k + 3] = 255;
      }
      this.groundBase = g; this.groundCur = new Uint8Array(g);
    }

    // paint bare soil around nests and plants
    paintGround(sim) {
      const g = this.groundCur; g.set(this.groundBase);
      const paint = (cx, cy, R, col) => {
        for (let y = Math.max(0, (cy - R) | 0); y <= Math.min(C.H - 1, (cy + R) | 0); y++)
          for (let x = Math.max(0, (cx - R) | 0); x <= Math.min(C.W - 1, (cx + R) | 0); x++) {
            const d = Math.hypot(x - cx, y - cy) / R;
            if (d > 1) continue;
            const t = Math.min(1, (1 - d) * 2.2) * (0.8 + 0.2 * h2(x, y, 77)), k = (y * C.W + x) * 4;
            for (let c = 0; c < 3; c++) g[k + c] = g[k + c] * (1 - t) + col[c] * 255 * t;
          }
      };
      for (const c of sim.colonies) if (c && c.alive) paint(c.x, c.y, 9, c.sp === SP.L ? [0.3, 0.24, 0.17] : [0.42, 0.33, 0.22]);
      for (const p of sim.world.plants) paint(p.x, p.y, 5, [0.22, 0.36, 0.14]);
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.groundTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, C.W, C.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, g);
    }

    // static decoration: grass tufts, pebbles, aphid plants
    buildStatic(sim) {
      const S = this.stat; S.reset();
      const nearNest = (x, z) => sim.colonies.some(c => c && c.alive && Math.hypot(c.x - x, c.y - z) < 9);
      const greens = ['#33602a', '#3f6e2e', '#4a7a33', '#2c5424', '#56823a', '#6b7d36'].map(hex);
      let seed = 1;
      const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 4800; i++) {
        const x = R() * C.W, z = R() * C.H;
        if (nearNest(x, z)) continue;
        if (fbm(x / 40, z / 40, 21) < 0.35 && R() < 0.5) continue;
        const y = this.heightAt(x, z), blades = 2 + (R() * 3) | 0;
        for (let b = 0; b < blades; b++) {
          const h = 0.7 + R() * 1.6, ox = (R() - 0.5) * 0.9, oz = (R() - 0.5) * 0.9;
          S.push(x + ox, y + h / 2, z + oz, 0.14, h, 0.14, R() * 3, greens[(R() * greens.length) | 0]);
        }
      }
      for (let i = 0; i < 1600; i++) {
        const x = R() * C.W, z = R() * C.H; if (nearNest(x, z)) continue;
        const s = 0.2 + R() * 0.45, g = 0.3 + R() * 0.14;
        S.push(x, this.heightAt(x, z) + s * 0.3, z, s * (1 + R()), s * 0.6, s, R() * 3, [g, g * 0.97, g * 0.92]);
      }
      for (const p of sim.world.plants) {
        const y = this.heightAt(p.x, p.y), H = 9 + p.seed * 5;
        S.push(p.x, y + H / 2, p.y, 0.55, H, 0.55, 0, hex('#4c7a2c'));
        for (let k = 0; k < 9; k++) {
          const hy = y + 2 + k * (H - 2) / 9, yaw = k * 2.4 + p.seed * 6, L = 3.4 - k * 0.2;
          S.push(p.x + Math.cos(yaw) * L / 2, hy, p.y + Math.sin(yaw) * L / 2, L, 0.12, 1.3, -yaw, hex(k % 2 ? '#4f8f3a' : '#5ea044'));
          for (let a = 0; a < 3; a++) S.push(p.x + Math.cos(yaw + a) * 0.45, hy - 0.3 + a * 0.25, p.y + Math.sin(yaw + a) * 0.45, 0.28, 0.22, 0.22, yaw, hex('#a9d86e')); // aphids
        }
        S.push(p.x, y + H + 0.4, p.y, 1.6, 0.6, 1.6, p.seed * 3, hex('#f0d75a'));
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.statVao.ib);
      gl.bufferData(gl.ARRAY_BUFFER, S.d.subarray(0, S.n * 10), gl.STATIC_DRAW);
      this.statN = S.n;
    }

    // per-colony mound voxels (cached until the colony set changes)
    buildMounds(sim) {
      const out = [];
      // mound height field so ants walk over the mounds instead of through them
      const mh = this.moundH || (this.moundH = new Float32Array(C.W * C.H)); mh.fill(0);
      for (const c of sim.colonies) {
        if (!c || !c.alive) continue;
        const R0 = c.sp === SP.L ? 3.6 : 4.2, top = c.sp === SP.L ? 1.5 : 1.9;
        for (let y = Math.max(0, Math.floor(c.y - R0)); y <= Math.min(C.H - 1, Math.ceil(c.y + R0)); y++)
          for (let x = Math.max(0, Math.floor(c.x - R0)); x <= Math.min(C.W - 1, Math.ceil(c.x + R0)); x++) {
            const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / R0;
            if (d < 1) mh[y * C.W + x] = Math.max(mh[y * C.W + x], top * Math.pow(1 - d * d, 0.8) + 0.2);
          }
      }
      const B = { push: (...a) => out.push(a) };
      for (const c of sim.colonies) {
        if (!c || !c.alive) continue;
        let seed = c.uid * 9973 + 7;
        const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const R0 = c.sp === SP.L ? 3.6 : 4.2, top = c.sp === SP.L ? 1.5 : 1.9;
        const soil = c.sp === SP.L ? [0.32, 0.25, 0.18] : [0.52, 0.4, 0.27];
        const gy = this.heightAt(c.x, c.y);
        for (let dz = -R0; dz <= R0; dz += 0.7) for (let dx = -R0; dx <= R0; dx += 0.7) {
          const d = Math.hypot(dx, dz) / R0; if (d > 1) continue;
          const h = top * Math.pow(1 - d * d, 0.8) + R() * 0.25 + 0.15;
          const j = (R() - 0.5) * 0.08;
          const x = c.x + dx, z = c.y + dz, y = this.heightAt(x, z);
          B.push(x, y + h / 2 - 0.1, z, 0.74, h, 0.74, 0, [soil[0] + j, soil[1] + j, soil[2] + j]);
        }
        B.push(c.x, gy + top + 0.12, c.y, 1.0, 0.25, 1.0, 0, [0.06, 0.04, 0.03]);                 // main entrance
        for (let e = 0; e < 2; e++) { const a = R() * 6.28, r = R0 * 0.6; B.push(c.x + Math.cos(a) * r, this.heightAt(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r) + top * 0.55, c.y + Math.sin(a) * r, 0.6, 0.2, 0.6, 0, [0.07, 0.05, 0.03]); }
        if (c.sp !== SP.L) {  // F. fusca often nests under a flat stone
          const a = R() * 6.28, sx = c.x + Math.cos(a) * 3.2, sz = c.y + Math.sin(a) * 3.2;
          B.push(sx, this.heightAt(sx, sz) + 0.6, sz, 4.2, 0.9, 3.0, a, [0.56, 0.55, 0.52]);
        }
      }
      return out;
    }

    // ---------- camera ----------
    resize(w, h) {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.canvas.width = Math.floor(w * dpr); this.canvas.height = Math.floor(h * dpr);
      this.cssW = w; this.cssH = h;
    }
    eye() {
      const c = this.cam, ty = this.heightAt(c.tx, c.tz);
      return [c.tx + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), ty + c.dist * Math.sin(c.pitch), c.tz + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    }
    // ground + mound surface height (what an ant walks on)
    surfaceAt(x, z) {
      const k = SM.clamp(z | 0, 0, C.H - 1) * C.W + SM.clamp(x | 0, 0, C.W - 1);
      return this.heightAt(x, z) + (this.moundH ? this.moundH[k] : 0);
    }
    matrices() {
      const c = this.cam;
      let e, t;
      if (this.override) { e = this.override.eye; t = this.override.target; }   // free-fly / ant cameras
      else { e = this.eye(); t = [c.tx, this.heightAt(c.tx, c.tz), c.tz]; }
      const aspect = this.canvas.width / this.canvas.height;
      this.fov = this.override && this.override.fov ? this.override.fov : 0.8;
      const vd = Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]);
      this.viewDist = this.override ? Math.min(vd, 60) : c.dist;
      const P = perspective(this.fov, aspect, this.override ? 0.08 : Math.max(0.3, c.dist * 0.01), this.override ? 1400 : c.dist * 4 + 900);
      const V = lookAt(e, t, [0, 1, 0]);
      this.vp = mul(P, V); this.eyePos = e; this.target = t;
      return this.vp;
    }
    project(x, y, z) {
      const m = this.vp; if (!m) return null;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0.1) return null;
      return [(cx / cw * 0.5 + 0.5) * this.cssW, (1 - (cy / cw * 0.5 + 0.5)) * this.cssH];
    }
    // ray from the camera through a screen point, intersected with the terrain
    pick(sx, sy) {
      const e = this.eyePos, t = this.target; if (!e) return null;
      let fx = t[0] - e[0], fy = t[1] - e[1], fz = t[2] - e[2]; let l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l;
      let rx = fy * 0 - fz * 1, ry = fz * 0 - fx * 0, rz = fx * 1 - fy * 0; l = Math.hypot(rx, ry, rz); rx /= l; ry /= l; rz /= l;
      const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
      const th = Math.tan(this.fov / 2), asp = this.cssW / this.cssH;
      const nx = (sx / this.cssW * 2 - 1) * th * asp, ny = (1 - sy / this.cssH * 2) * th;
      let dx = fx + rx * nx + ux * ny, dy = fy + ry * nx + uy * ny, dz = fz + rz * nx + uz * ny;
      if (dy >= -1e-4) return null;
      let gy = 0, x = 0, z = 0;
      for (let it = 0; it < 4; it++) { const s = (gy - e[1]) / dy; x = e[0] + dx * s; z = e[2] + dz * s; gy = this.heightAt(x, z); }
      return [x, z];
    }

    // ---------- frame ----------
    draw(sim, time) {
      const gl = this.gl;
      this.frame++;
      if (sim !== this.sim) { this.sim = sim; this.nestKey = ''; this.buildStatic(sim); this.foodFrame = -99; }
      const key = sim.colonies.map(c => (c && c.alive ? c.uid : 0)).join(',');
      if (key !== this.nestKey) {
        this.nestKey = key;
        const list = this.buildMounds(sim);
        this.mounds = new Boxes(list.length + 1);
        for (const m of list) this.mounds.push(...m);
        this.paintGround(sim);
      }

      // lighting from time of day
      const tod = sim.tod, day = sim.daylight;
      const ang = (tod - 0.25) * Math.PI * 2;
      const sun = [Math.cos(ang) * 0.75, Math.max(0.12, Math.sin(ang)), 0.45]; const sl = Math.hypot(...sun);
      const warm = 1 - Math.min(1, Math.abs(Math.sin(ang)) * 2.2);
      const sunCol = [(1.0 + 0.25 * warm) * day * 0.9, (0.95 - 0.1 * warm) * day * 0.9, (0.85 - 0.35 * warm) * day * 0.9];
      const amb = [0.24 + 0.2 * day, 0.27 + 0.21 * day, 0.38 + 0.16 * day];
      const top = [0.07 + 0.3 * day, 0.09 + 0.45 * day, 0.18 + 0.62 * day];
      const hor = [0.16 + 0.55 * day + 0.25 * warm * day, 0.18 + 0.58 * day + 0.05 * warm * day, 0.26 + 0.6 * day - 0.1 * warm * day];

      const VP = this.matrices(), eye = this.eyePos;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(hor[0], hor[1], hor[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.sky.p); gl.uniform3fv(this.sky.u.uTop, top); gl.uniform3fv(this.sky.u.uHor, hor);
      gl.bindVertexArray(this.skyVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

      const setCommon = (u) => {
        gl.uniformMatrix4fv(u.uVP, false, VP);
        gl.uniform3f(u.uSunDir, sun[0] / sl, sun[1] / sl, sun[2] / sl);
        gl.uniform3fv(u.uSunCol, sunCol); gl.uniform3fv(u.uAmb, amb); gl.uniform3fv(u.uFogCol, hor);
        gl.uniform1f(u.uFogDen, 1 / (900 + this.viewDist * 2)); gl.uniform3fv(u.uEye, eye);
      };

      // ground
      const G = this.ground; gl.useProgram(G.p); setCommon(G.u);
      gl.uniform2f(G.u.uGrid, C.W, C.H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.groundTex); gl.uniform1i(G.u.uGround, 0);
      for (let k = 0; k < SM.NCH; k++) {
        gl.activeTexture(gl.TEXTURE1 + k); gl.bindTexture(gl.TEXTURE_2D, this.phTex[k]);
        if (this.layers[k]) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, C.W, C.H, gl.RED, gl.FLOAT, sim.world.ph[k]);
        gl.uniform1i(G.u['uP' + k], 1 + k);
      }
      gl.uniform1fv(G.u.uOn, this.layers.map(b => (b ? 1 : 0)));
      gl.uniform3fv(G.u.uPhCol, this.phCol);
      let nn = 0;
      for (const c of sim.colonies) {
        if (!c || !c.alive || nn >= 48) continue;
        const o = nn * 4;
        this.nestU[o] = c.x; this.nestU[o + 1] = c.y; this.nestU[o + 2] = 6.5; this.nestU[o + 3] = c.sp;
        const born = sim.tick - c.lastSlaveBorn;
        this.nestF[o] = c === this.selected ? 1 : 0; this.nestF[o + 1] = c.alarm ? 1 : 0;
        this.nestF[o + 2] = born >= 0 && born < 90 ? born / 90 : 0; this.nestF[o + 3] = 0;
        nn++;
      }
      gl.uniform4fv(G.u.uNest, this.nestU); gl.uniform4fv(G.u.uNestF, this.nestF); gl.uniform1i(G.u.uNestN, nn);
      // coarse lookup grid so each pixel only tests the few nests whose rings can reach it
      const g = this.nestGrid; g.fill(0);
      for (let cy = 0; cy < this.gridH; cy++) for (let cx = 0; cx < this.gridW; cx++) {
        const mx = cx * 16 + 8, my = cy * 16 + 8, o = (cy * this.gridW + cx) * 4;
        let k = 0;
        for (let n = 0; n < nn && k < 4; n++) {
          const dx = this.nestU[n * 4] - mx, dy = this.nestU[n * 4 + 1] - my;
          if (dx * dx + dy * dy < 21 * 21) g[o + k++] = n + 1;
        }
      }
      gl.activeTexture(gl.TEXTURE1 + SM.NCH); gl.bindTexture(gl.TEXTURE_2D, this.nestGridTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridW, this.gridH, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, g);
      gl.uniform1i(G.u.uNestGrid, 1 + SM.NCH);
      gl.uniform3fv(G.u.uKindCol, this.kindCol); gl.uniform1f(G.u.uTime, time); gl.uniform1f(G.u.uRings, this.rings ? 1 : 0);
      gl.bindVertexArray(this.groundVao); if (!this.skipGround) gl.drawElements(gl.TRIANGLES, this.groundN, gl.UNSIGNED_INT, 0);

      // boxes
      const Bx = this.box; gl.useProgram(Bx.p); setCommon(Bx.u);
      gl.bindVertexArray(this.statVao); if (!this.skipStatic) gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.statN);
      this.buildDynamic(sim, time);
      gl.bindVertexArray(this.dynVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynVao.ib);
      gl.bufferData(gl.ARRAY_BUFFER, this.dyn.d.subarray(0, this.dyn.n * 10), gl.DYNAMIC_DRAW);
      if (!this.skipDyn) gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.dyn.n);
      gl.bindVertexArray(null);
    }

    buildDynamic(sim, time) {
      const D = this.dyn; D.reset();
      D.append(this.mounds);
      // food items (rebuilt every few frames when changed)
      if (sim.world.foodDirty && this.frame - this.foodFrame > 8) {
        this.foodFrame = this.frame; sim.world.foodDirty = false;
        const F = this.foodCache; F.reset();
        const f = sim.world.food, W = C.W, plants = sim.world.plants;
        const seedC = hex('#c9a25a'), bugC = hex('#3b2a1f'), bug2 = hex('#6b4a2a'), dew = hex('#e2b13c');
        for (let k = 0; k < f.length; k++) {
          if (f[k] < 1) continue;
          const x = k % W + 0.5, z = (k / W | 0) + 0.5;
          const hh = h2(x | 0, z | 0, 91);
          let col = hh < 0.45 ? bugC : hh < 0.7 ? bug2 : seedC;
          for (const p of plants) if (Math.abs(p.x - x) < 5 && Math.abs(p.y - z) < 5) { col = dew; break; }
          const s = 0.45 + Math.min(6, f[k]) * 0.12;
          F.push(x, this.heightAt(x, z) + s * 0.35, z, s, s * 0.7, s * 0.8, hh * 6, col);
        }
      }
      D.append(this.foodCache);

      // ants
      const { x, y, a, st, sp, col, carry, cargo, alive, colonies } = sim;
      const far = this.viewDist > 260;
      const roles = this.mode === 'roles';
      const roleCol = { 0: hex(SM.ROLE.host), 1: hex(SM.ROLE.slaver), 2: hex(SM.ROLE.slave), 3: hex(SM.ROLE.lasius) };
      const tag = hex('#ff8a1f'), cocoon = hex('#ece0c2'), larva = hex('#fbf7ee'), seed = hex('#c9a25a'), wing = hex('#dfe6ea');
      const T = time * 9;
      for (let i = 0; i < sim.hi; i++) {
        if (!alive[i] || st[i] === ST.IN) continue;
        const s = sp[i], gyne = st[i] === ST.GYNE;
        const c = colonies[col[i]];
        const slave = s === SP.F && c && c.sp === SP.P;
        let pal = NAT[s];
        if (roles) {
          const rc = roleCol[s === SP.P ? 1 : s === SP.L ? 3 : slave ? 2 : 0];
          pal = { gaster: rc.map(v => v * 0.7), thorax: rc, head: rc.map(v => v * 0.85), leg: rc.map(v => v * 0.6) };
        }
        const sc = SCALE[s] * ANT * (gyne ? 1.5 : 1);
        const yaw = a[i], ca = Math.cos(a[i]), sa = Math.sin(a[i]);
        const px = x[i], pz = y[i];
        let py = this.heightAt(px, pz) + (this.moundH[(pz | 0) * C.W + (px | 0)] || 0);
        if (gyne) py += 4 + Math.sin(time * 6 + i) * 0.4;
        // local (fx forward, sz side) -> world
        const P = (fx, fy, sz, w, h, d, cc, yw) => D.push(px + ca * fx * sc - sa * sz * sc, py + fy * sc, pz + sa * fx * sc + ca * sz * sc, w * sc, h * sc, d * sc, yw === undefined ? yaw : yw, cc);
        // gaster (with tapered tip), petiole node, mesosoma (two blocks), head
        P(-0.40, 0.30, 0, 0.46, 0.32, 0.36, pal.gaster);
        P(-0.66, 0.27, 0, 0.14, 0.2, 0.22, pal.gaster);
        P(-0.12, 0.25, 0, 0.08, 0.16, 0.09, pal.thorax);
        P(0.03, 0.26, 0, 0.22, 0.16, 0.16, pal.thorax);
        P(0.20, 0.29, 0, 0.14, 0.2, 0.19, pal.thorax);
        P(0.40, 0.30, 0, 0.24, 0.22, 0.26, pal.head);
        if (!far) {
          const ph = T + i * 1.7;
          // tripod gait: L1,R2,L3 swing together against R1,L2,R3
          const att = [0.19, 0.06, -0.04], splay = [0.55, 0.05, -0.6];
          for (let k = 0; k < 3; k++) for (const side of [1, -1]) {
            const swing = Math.sin(ph + ((k + (side > 0 ? 0 : 1)) % 2) * Math.PI) * 0.28;
            const th = (splay[k] + swing) * side;
            P(att[k] - Math.sin(th) * 0.27 * side, 0.15, Math.cos(th) * 0.27 * side, 0.05, 0.05, 0.52, pal.leg, yaw + th);
          }
          P(0.62, 0.40, 0.12, 0.3, 0.04, 0.04, pal.leg, yaw - 0.55);   // antennae
          P(0.62, 0.40, -0.12, 0.3, 0.04, 0.04, pal.leg, yaw + 0.55);
          if (s === SP.P) { // sickle-shaped mandibles
            P(0.58, 0.25, 0.07, 0.17, 0.05, 0.05, pal.leg, yaw + 0.7);
            P(0.58, 0.25, -0.07, 0.17, 0.05, 0.05, pal.leg, yaw - 0.7);
          }
        }
        if (slave && this.markers && !roles) P(0.06, 0.45, 0, 0.2, 0.14, 0.2, tag);       // allegiance tag
        if (gyne) { P(-0.2, 0.5, 0.35, 0.9, 0.03, 0.45, wing); P(-0.2, 0.5, -0.35, 0.9, 0.03, 0.45, wing); }
        if (carry[i] === 2) { const b = cargo[i]; P(0.72, 0.34, 0, 0.42, 0.24, 0.24, b && b.age < C.DEV ? larva : cocoon); }
        else if (carry[i] === 1) P(0.66, 0.32, 0, 0.26, 0.2, 0.22, seed);
      }
    }
  }
  SM.Renderer3D = Renderer3D;
})(globalThis.SM);
