// Crab Arena — procedural pixel-art Colosseum renderer.
// Logical resolution 640x360; everything is drawn pixel by pixel, no image assets.
'use strict';

const W = 640, H = 360, CX = 320;
const bend = x => 40 * ((x - CX) / CX) ** 2;   // curvature of the far wall
const PODIUM = 186;                              // floor starts here at centre
const floorTop = x => PODIUM + bend(x);

// ---------- small utils ----------
function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dith = (x, y, f) => f * 16 > BAYER[((y & 3) << 2) | (x & 3)] + 0.5;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const _cc = {};
function rgb(hex) {
  if (_cc[hex]) return _cc[hex];
  const n = parseInt(hex.slice(1), 16);
  return (_cc[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}
function mix(hexA, hexB, t) {
  const a = rgb(hexA), b = rgb(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
const lighten = (h, t) => mix(h, '#ffffff', t);
const darken = (h, t) => mix(h, '#000000', t);

class Buf {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d');
    this.img = this.g.createImageData(w, h); this.d = this.img.data;
  }
  set(x, y, hex, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !hex) return;
    const c = rgb(hex), i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  rect(x, y, w, h, hex) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, hex); }
  done() { this.g.putImageData(this.img, 0, 0); return this.c; }
}

// ---------- 3x5 pixel font ----------
const GLYPH = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '!': '010010010000010', '-': '000000111000000', '+': '000010111010000', '.': '000000000000010',
  '?': '110001010000010', ' ': '000000000000000', ':': '000010000010000', '$': '011110010011110',
};
function textWidth(s, sc = 1) { return (s.length * 4 - 1) * sc; }
function drawText(ctx, s, x, y, col, sc = 1, shadow) {
  s = String(s).toUpperCase();
  if (shadow) drawText(ctx, s, x + sc, y + sc, shadow, sc);
  ctx.fillStyle = col;
  for (let k = 0; k < s.length; k++) {
    const g = GLYPH[s[k]] || GLYPH['?'];
    for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(x + (k * 4 + (i % 3)) * sc, y + ((i / 3) | 0) * sc, sc, sc);
  }
}

// ---------- palettes ----------
const STONE = ['#f3e3bc', '#e2cc98', '#c9ae76', '#a58a57', '#7a6440', '#524229', '#2a2016'];
const MARBLE = ['#fbf8f0', '#ebe5d6', '#d4ccb8', '#c9c1ae', '#aaa18c', '#7d7462', '#57503f'];
const SAND = ['#f3dfaa', '#e9cf92', '#dcbd7c', '#c9a664', '#b38f52', '#9a7843'];
const GOLD = ['#fff3a8', '#f0c850', '#c89a2a', '#8a6414'];
const METAL = {
  gold: ['#fff3a8', '#f0c850', '#c89a2a', '#8a6414'],
  bronze: ['#f5d49a', '#d4a04a', '#a8742a', '#6e4a18'],
  silver: ['#ffffff', '#d6dde4', '#a3adb8', '#6b7480'],
  iron: ['#c8ccd0', '#8e949a', '#62686e', '#3e4248'],
};
const STEEL = METAL.silver;
const CRAB = { out: '#4a1e10', dk: '#a9502f', md: '#d97757', lt: '#eb9a7c', hl: '#f6c0a8', eye: '#1b1b1b' };
const CHAR = { out: '#0e0a08', dk: '#1e1916', md: '#2c2521', lt: '#3b322c', hl: '#4a403a', eye: '#ff5a2a' };
const GHOST = { out: '#d8f0ff', dk: '#b8dcf0', md: '#e8f6ff', lt: '#ffffff', hl: '#ffffff', eye: '#6aa0c8' };

const SKIN = ['#f1c9a5', '#e0ac7e', '#c68a5a', '#a36b42', '#7a4b2a'];
const CLOTH = ['#b33a3a', '#3a6db3', '#d9c7a0', '#6e8f3a', '#8a4fa3', '#d98a2b', '#e8e0d0', '#4a8a8a', '#a36b42', '#7a2a2a', '#c9b24a', '#5a5a8a'];
const HAIR = ['#2a1a10', '#4a2a14', '#7a4a20', '#1a1a1a', '#b8a070', '#d8d0c0', '#8a3a1a'];

// The Emperor, seated (17x23). Lower rows are hidden behind the box's parapet.
const EMPEROR_MAP = [
  '.....lLGLGLl.....',
  '....lHHHHHHHl....',
  '....LhSSSSShL....',
  '....KSHSSSHSK....',
  '....KSESSSESK....',
  '...KsSSSsSSSsK...',
  '....KsSSsSSsK....',
  '....KSSsmsSSK....',
  '.....KsSSSsK.....',
  '......KsssK......',
  '...qPPPTTTPPPp...',
  '..qPPPPTGTPPPPp..',
  '.qPPPPPTtTPPPPPp.',
  '.qPPqPPPTtPPPPPp.',
  '.qPPPqPPTtPPpPPp.',
  '.qPGPPqPPTPPpPPp.',
  '.qPPGPPqPTPPPpPp.',
  '.qPPPGPPqTPPPpPp.',
  '.qPPPPGPPTPPPPpp.',
  '.qPPPPPGPTPPPPPp.',
  '.qPPPPPPGTPPPPPp.',
  '.qPPPPPPPGPPPPPp.',
  '.qPPPPPPPPGPPPPp.',
];
const EMP_PAL = {
  K: '#2e1408', S: '#e8b48a', s: '#c48a60', h: '#f8d4b0', E: '#1a0e08', m: '#8a3a2a',
  H: '#4a2a14', L: '#6cc04a', l: '#2f6e22', G: '#f0c850',
  P: '#6a2a96', q: '#43175f', p: '#9458c4', T: '#f4f1e8', t: '#cfc6b0',
};

// Gladiator visual definitions (keyed by gladiator id; names/styles live in engine.py)
const FIGHTERS = {
  g0: { plume: '#9b59d0', metal: 'gold',   weapon: 'sword',   shield: 'scutum', title: 'The Scholar' },
  g1: { plume: '#e03c3c', metal: 'bronze', weapon: 'trident', shield: null,     title: 'The Contrarian' },
  g2: { plume: '#3c7ce0', metal: 'silver', weapon: 'spear',   shield: 'parma',  title: 'The Pragmatist' },
  g3: { plume: '#2eaa5c', metal: 'iron',   weapon: 'axe',     shield: 'parma',  title: 'The Skeptic' },
  g4: { plume: '#f2f2f2', metal: 'bronze', weapon: 'mace',    shield: 'scutum', title: 'The Minimalist' },
  g5: { plume: '#22b8b0', metal: 'silver', weapon: 'sword',   shield: 'parma',  title: 'The Storyteller' },
  g6: { plume: '#e0c030', metal: 'iron',   weapon: 'spear',   shield: 'scutum', title: 'The Strategist' },
  g7: { plume: '#ff7fb0', metal: 'bronze', weapon: 'dagger',  shield: null,     title: 'The Wildcard', small: true },
};

// ======================================================================
//  CRAB SPRITE
// ======================================================================
function drawWeapon(plot, kind, hx, hy, a, gold) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const P = (i, off, col) => plot(Math.round(hx + ca * i - sa * off), Math.round(hy + sa * i + ca * off), col);
  const M = gold ? METAL.gold : STEEL;
  const WOOD = ['#a8743e', '#7a5028', '#4e3218'];
  if (kind === 'sword') {
    for (let i = -1; i <= 1; i++) P(i, 0, WOOD[1]);
    for (let o = -2; o <= 2; o++) P(2, o, GOLD[o === 0 ? 0 : 2]);
    for (let i = 3; i <= 15; i++) { P(i, 0, M[1]); P(i, -1, M[0]); P(i, 1, M[2]); }
    P(16, 0, M[0]); P(-2, 0, GOLD[1]);
  } else if (kind === 'trident') {
    for (let i = -6; i <= 19; i++) { P(i, 0, WOOD[0]); P(i, 1, WOOD[2]); }
    for (let o = -3; o <= 3; o++) P(20, o, M[2]);
    for (let i = 21; i <= 25; i++) { P(i, -3, M[1]); P(i, 0, M[0]); P(i, 3, M[1]); }
    P(26, 0, M[0]); P(24, -2, M[2]); P(24, 2, M[2]);
  } else if (kind === 'spear') {
    for (let i = -6; i <= 18; i++) { P(i, 0, WOOD[0]); P(i, 1, WOOD[2]); }
    for (let i = 19; i <= 25; i++) { const w = i < 22 ? 1 : i < 24 ? 1 : 0; P(i, 0, M[0]); if (w) { P(i, -1, M[1]); P(i, 1, M[2]); } }
    P(19, -2, M[2]); P(19, 2, M[2]); P(18, 0, GOLD[1]);
  } else if (kind === 'axe') {
    for (let i = -2; i <= 14; i++) { P(i, 0, WOOD[0]); P(i, 1, WOOD[2]); }
    for (let i = 9; i <= 14; i++) for (let o = -6; o <= -1; o++) {
      if (o <= -5 && (i === 9 || i === 14)) continue;
      P(i, o, o === -6 ? M[0] : o === -1 ? M[3] : M[1]);
    }
    P(15, 0, M[2]);
  } else if (kind === 'mace') {
    for (let i = -1; i <= 11; i++) { P(i, 0, WOOD[1]); P(i, 1, WOOD[2]); }
    for (let i = 12; i <= 17; i++) for (let o = -3; o <= 3; o++) {
      const d = (i - 14.5) ** 2 + o * o; if (d <= 9.5) P(i, o, d < 3 ? M[0] : M[2]);
    }
    P(18, 0, M[1]); P(14, -4, M[1]); P(14, 4, M[1]); P(11, 0, GOLD[1]);
  } else if (kind === 'dagger') {
    for (let i = -1; i <= 1; i++) P(i, 0, WOOD[1]);
    for (let o = -1; o <= 1; o++) P(2, o, GOLD[1]);
    for (let i = 3; i <= 9; i++) { P(i, 0, M[0]); P(i, 1, M[2]); }
  }
}

// Draws one crab gladiator facing right with feet at (ox, oy) on a 2D context.
function drawCrab(g, ox, oy, c) {
  const f = FIGHTERS[c.id] || FIGHTERS.g2;
  const small = !!f.small;
  const pal = c.ghost ? GHOST : c.charred ? CHAR : CRAB;
  const bw = small ? 15 : 20, bh = small ? 10 : 13, legH = small ? 3 : 4;
  const L = -Math.floor(bw / 2), R = L + bw - 1, B = -legH - 1, T = B - bh + 1;
  const metal = METAL[f.metal];
  const plume = [lighten(f.plume, 0.45), f.plume, darken(f.plume, 0.3), darken(f.plume, 0.55)];
  const t = c.t || 0;
  const moving = c.moving;
  const phase = moving ? Math.floor((c.walkT || 0) * 10) % 2 : 0;
  const bob = moving ? (phase ? -1 : 0) : (Math.floor(t * 1.6 + (c.seed || 0)) % 2 ? -1 : 0);
  const p = (x, y, col) => { g.fillStyle = col; g.fillRect(ox + x, oy + y, 1, 1); };
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(ox + x, oy + y, w, h); };

  // legs
  const legX = small ? [L + 1, L + 4, R - 5, R - 2] : [L + 2, L + 6, R - 7, R - 3];
  legX.forEach((lx, i) => {
    let lift = 0;
    if (moving) lift = (i % 2 === phase) ? 1 : 0;
    if (c.dead && c.deadT < 2.5) lift = Math.floor(c.deadT * 12 + i) % 2;
    const top = B + 1, bot = -1 - lift;
    r(lx - 1, top, 4, bot - top + 2, pal.out);
    r(lx, top, 2, bot - top + 1, pal.dk);
    p(lx + 1, top, pal.md);
  });

  const Tb = T + bob, Bb = B + bob;
  // shield behind? (scutum is carried on the far side, drawn after body)
  // body with outline
  r(L - 1, Tb - 1, bw + 2, bh + 2, pal.out);
  r(L, Tb, bw, bh, pal.md);
  r(L, Tb, bw, 1, pal.lt); r(R - 3, Tb, 3, 1, pal.hl);
  r(R, Tb + 1, 1, bh - 3, pal.lt);
  r(L, Tb + 1, 1, bh - 1, pal.dk);
  r(L, Bb - 1, bw, 2, pal.dk);
  // belt (balteus) with buckle
  if (!c.ghost && !c.charred) {
    r(L, Bb - 3, bw, 1, '#6b3f1f'); r(L, Bb - 2, bw, 1, '#4e2c14');
    r(-1, Bb - 3, 3, 2, GOLD[1]); p(0, Bb - 3, GOLD[0]);
  }

  // back arm nub
  r(L - 4, Tb + 5, 4, 4, pal.out); r(L - 3, Tb + 6, 3, 2, pal.dk);

  // eyes
  const ex1 = L + 5, ex2 = R - 5;
  if (c.dead || c.ghost) {
    for (const ex of [ex1, ex2]) { p(ex - 1, Tb + 3, pal.eye); p(ex + 1, Tb + 3, pal.eye); p(ex, Tb + 4, pal.eye); p(ex - 1, Tb + 5, pal.eye); p(ex + 1, Tb + 5, pal.eye); }
  } else if (c.hurt > 0) {
    r(ex1 - 1, Tb + 4, 3, 1, pal.eye); r(ex2 - 1, Tb + 4, 3, 1, pal.eye);
  } else if (c.angry) {
    r(ex1, Tb + 4, 2, 3, pal.eye); r(ex2, Tb + 4, 2, 3, pal.eye);
    p(ex1 - 1, Tb + 2, pal.out); p(ex1, Tb + 3, pal.out); p(ex1 + 1, Tb + 3, pal.out);
    p(ex2 + 2, Tb + 2, pal.out); p(ex2 + 1, Tb + 3, pal.out); p(ex2, Tb + 3, pal.out);
  } else {
    const blink = (t + (c.seed || 0)) % 3.7 < 0.13;
    if (blink) { r(ex1, Tb + 5, 2, 1, pal.eye); r(ex2, Tb + 5, 2, 1, pal.eye); }
    else { r(ex1, Tb + 3, 2, small ? 3 : 4, pal.eye); r(ex2, Tb + 3, 2, small ? 3 : 4, pal.eye); p(ex1 + 1, Tb + 3, '#555'); p(ex2 + 1, Tb + 3, '#555'); }
  }

  // helmet + plume
  if (!c.noHelmet && !c.ghost) {
    const m = c.charred ? ['#3a3a3a', '#2a2a2a', '#1e1e1e', '#111'] : metal;
    r(L - 1, Tb + 1, bw + 2, 1, m[2]); r(R + 1, Tb + 1, 3, 1, m[2]); p(R + 3, Tb + 2, m[3]);
    r(L - 1, Tb, bw + 2, 1, m[1]);
    r(L, Tb - 1, bw, 1, m[1]); r(R - 5, Tb - 1, 3, 1, m[0]);
    r(L + 1, Tb - 2, bw - 2, 1, m[1]); r(R - 5, Tb - 2, 2, 1, m[0]);
    r(L + 3, Tb - 3, bw - 6, 1, m[2]);
    p(L - 1, Tb - 1, m[3]); p(L, Tb - 2, m[3]); p(R + 1, Tb - 1, m[3]);
    // cheek guard
    r(R - 1, Tb + 2, 2, 3, m[2]); p(R, Tb + 2, m[1]);
    // rivets
    p(L + 2, Tb, m[3]); p(R - 2, Tb, m[3]);
    if (!c.charred) {
      const sway = moving ? phase : 0;
      const pl = plume;
      r(L + 3, Tb - 4, bw - 6, 1, pl[2]);
      r(L + 2, Tb - 5, bw - 4, 1, pl[1]);
      r(L + 2 + sway, Tb - 6, bw - 3, 1, pl[1]);
      r(L + 3 + sway, Tb - 7, bw - 4, 1, pl[0]);
      r(L + 5 + sway, Tb - 8, bw - 8, 1, pl[0]);
      for (let i = 0; i < bw - 4; i += 3) p(L + 3 + i + sway, Tb - 6, pl[0]);
      for (let i = 1; i < bw - 6; i += 3) p(L + 3 + i, Tb - 4, pl[3]);
      // tail flowing back
      r(L + 1, Tb - 5, 2, 2, pl[2]); r(L - 1, Tb - 4, 2, 2, pl[2]); r(L - 2 - sway, Tb - 3, 2, 2, pl[3]);
      if (c.laurel) {
        for (let i = L; i <= R; i += 2) { p(i, Tb - 1, '#5aa83a'); p(i + 1, Tb - 2, '#3f7f2a'); }
        p(L - 1, Tb, '#5aa83a'); p(R + 1, Tb, '#5aa83a');
      }
    }
  }

  // shield on the near side
  if (f.shield && !c.noWeapon && !c.ghost) {
    if (f.shield === 'scutum') {
      const sx = L - 6, sy = Tb + 2, sh = bh + 1;
      r(sx - 1, sy - 1, 7, sh + 2, '#3a0e0e');
      r(sx, sy, 5, sh, '#a3222a'); r(sx, sy, 1, sh, '#7d161d'); r(sx + 4, sy, 1, sh, '#c83a3a');
      r(sx, sy, 5, 1, GOLD[1]); r(sx, sy + sh - 1, 5, 1, GOLD[2]);
      r(sx + 1, sy + (sh >> 1) - 1, 3, 3, GOLD[1]); p(sx + 2, sy + (sh >> 1) - 1, GOLD[0]);
      p(sx + 2, sy + 2, GOLD[1]); p(sx + 2, sy + sh - 3, GOLD[1]);
    } else {
      const cx = L - 3, cy = Tb + 7;
      for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
        const d = x * x + y * y;
        if (d <= 26) p(cx + x, cy + y, d > 18 ? '#3a220e' : d > 12 ? metal[2] : d < 3 ? metal[0] : (x + y < 0 ? '#b0562a' : '#8a3e1c'));
      }
    }
  }

  // front arm + weapon
  const sx0 = R + 1, sy0 = Tb + 7;
  const a = c.angle ?? -1.1;
  const hx = Math.round(sx0 + Math.cos(a) * 3), hy = Math.round(sy0 + Math.sin(a) * 3);
  const plot = (x, y, col) => p(x, y, col);
  if (!c.noWeapon && !c.ghost && a < -1.6) drawWeapon(plot, f.weapon, hx, hy, a, f.metal === 'gold');
  for (let i = 0; i <= 3; i++) {
    const ax = Math.round(sx0 + Math.cos(a) * i), ay = Math.round(sy0 + Math.sin(a) * i);
    r(ax - 1, ay - 1, 3, 3, pal.out);
  }
  for (let i = 0; i <= 3; i++) {
    const ax = Math.round(sx0 + Math.cos(a) * i), ay = Math.round(sy0 + Math.sin(a) * i);
    p(ax, ay, pal.md); p(ax, ay + 1, pal.dk);
  }
  if (!c.ghost && !c.charred) { p(sx0, sy0, metal[1]); p(sx0 + 1, sy0, metal[2]); }
  if (!c.noWeapon && !c.ghost && a >= -1.6) drawWeapon(plot, f.weapon, hx, hy, a, f.metal === 'gold');
  r(hx, hy, 2, 2, pal.dk);
}

// ======================================================================
//  ARENA
// ======================================================================
class Arena {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.time = 0;
    this.speed = 1;
    this.timeScale = 1;
    this.slowT = 0;
    this.crabs = [];
    this.particles = [];
    this.debris = [];
    this.bolts = [];
    this.flash = 0;
    this.shake = 0;
    this.excite = 0.05;
    this.baseExcite = 0.05;
    this.marker = null;
    this.emperor = { stand: 0, thumb: 0, thumbT: 0 };
    this.waiters = [];
    this.skirmish = false;
    this.skirmishT = 1;
    this.birds = [];
    this.spr = document.createElement('canvas'); this.spr.width = 96; this.spr.height = 72;
    this.sg = this.spr.getContext('2d');
    this.buildStatic();
    this.clouds = [];
    for (let i = 0; i < 6; i++) this.clouds.push({ x: rand(-60, 640), y: rand(2, 34), v: rand(2, 5), s: (Math.random() * this.cloudSprites.length) | 0 });
    this.last = performance.now();
    this.onFrame = null;
    requestAnimationFrame(this.loop.bind(this));
  }

  // ------------------------------------------------------------ static art
  buildStatic() {
    this.sky = this.buildSky();
    this.cloudSprites = [0, 1, 2, 3].map(i => this.buildCloud(i));
    this.struct = this.buildStructure();
    this.buildCrowd();
    this.fg = this.buildForeground();
  }

  buildSky() {
    const b = new Buf(W, 110);
    const stops = ['#2b5a8e', '#4a82bb', '#86bde3', '#cfe4ee', '#f3ddb0'];
    for (let y = 0; y < 110; y++) for (let x = 0; x < W; x++) {
      const s = Math.min(3.999, (y / 100) * 4), i = Math.floor(s), f = s - i;
      b.set(x, y, dith(x, y, f) ? stops[i + 1] : stops[i]);
    }
    // sun, top right
    const sx = 566, sy = 16;
    for (let y = -24; y <= 24; y++) for (let x = -24; x <= 24; x++) {
      const d = Math.sqrt(x * x + y * y), X = sx + x, Y = sy + y;
      if (Y < 0) continue;
      if (d <= 8) b.set(X, Y, d < 6 ? '#fffdf0' : '#fff4c8');
      else if (d <= 10) b.set(X, Y, dith(X, Y, 0.7) ? '#fff4c8' : '#ffe9a0');
      else if (d <= 24 && dith(X, Y, (24 - d) / 30)) b.set(X, Y, '#fbe6b4');
    }
    return b.done();
  }

  buildCloud(seed) {
    const w = 60 + seed * 12, h = 22;
    const b = new Buf(w, h);
    const blobs = [];
    for (let i = 0; i < 5 + seed; i++) blobs.push([rand(10, w - 10), rand(10, 15), rand(5, 9)]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let inside = false, top = 99;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot(x - bx, (y - by) * 1.3);
        if (d < br) { inside = true; top = Math.min(top, (y - (by - br / 1.3))); }
      }
      if (!inside || y > 17) continue;
      const col = y > 14 ? '#b9cfe0' : y > 11 ? (dith(x, y, 0.5) ? '#dbe8f2' : '#b9cfe0') : top < 2 ? '#ffffff' : '#eef5fa';
      b.set(x, y, col);
    }
    return b.done();
  }

  stonePix(x, y, idx) {
    const n = hash2(x, y, 7);
    if (n < 0.07) idx++; else if (n > 0.95) idx--;
    return STONE[clamp(idx, 0, 6)];
  }

  // colour of the curved amphitheatre at column x, "local" row ly (ly = y - bend(x))
  structPix(x, y, ly) {
    const S = (i) => this.stonePix(x, y, i);
    if (ly < 20) return null;
    // ---- attic
    if (ly <= 22) return ly === 20 ? STONE[0] : ly === 21 ? S(1) : STONE[3];
    if (ly <= 33) {
      if (ly === 33) return STONE[4];
      const px = x % 32;
      if (px >= 14 && px <= 17 && ly >= 25 && ly <= 29) return ly === 25 ? STONE[5] : STONE[6];
      if (px >= 13 && px <= 18 && ly === 30) return STONE[1];
      if (px === 0) return STONE[4];
      if (px <= 2) return S(px === 1 ? 2 : 1);
      if (px === 3) return S(0);
      const row = Math.floor((ly - 23) / 4);
      if ((ly - 23) % 4 === 3) return S(3);
      if ((x + (row % 2) * 6) % 12 === 0) return S(3);
      return S(2);
    }
    // ---- upper gallery with colonnade
    if (ly <= 37) return [STONE[0], STONE[1], S(2), STONE[3]][ly - 34];
    if (ly <= 57) {
      const cx = x % 16;
      if (ly === 57) return STONE[4];
      const capital = ly <= 39 || ly >= 55;
      if (cx <= 3 || (capital && (cx === 15 || cx === 4))) {
        if (capital) return ly === 38 || ly === 56 ? STONE[1] : STONE[2];
        return [STONE[4], STONE[3], STONE[1], STONE[0]][cx] || STONE[2];
      }
      const archY = 40 + 5.5 - Math.sqrt(Math.max(0, 30.25 - (cx - 9.5) ** 2));
      if (ly < archY) return S(2);
      if (ly < archY + 1) return STONE[4];
      // dark interior
      return ly < 44 ? '#2e2216' : (hash2(x, y, 3) < 0.1 ? '#3e2e1c' : '#35271a');
    }
    if (ly <= 61) return [STONE[0], STONE[1], S(2), STONE[4]][ly - 58];
    // ---- seating tiers
    const aisle = x % 80 < 7;
    const seat = (top, rowH, mar) => {
      const k = (ly - top) % rowH;
      const Pp = mar ? MARBLE : STONE;
      if (aisle) {
        const x80 = x % 80;
        if (x80 === 0 || x80 === 6) return Pp[4];
        const k2 = (ly - top) % 3;
        return k2 === 0 ? Pp[0] : k2 === 1 ? Pp[2] : Pp[3];
      }
      if (k === 0) return Pp[0];
      if (k === 1) return mar ? Pp[1] : S(1);
      if (k === rowH - 1) return Pp[4];
      return mar ? (hash2(x, y) < 0.05 ? Pp[3] : Pp[2]) : S(k === 2 ? 2 : 3);
    };
    if (ly <= 96) return seat(62, 5, false);
    if (ly <= 104) {                           // praecinctio wall with vomitoria
      const x80 = (x + 40) % 80;
      if (x80 >= 35 && x80 <= 46 && ly >= 98) {
        const doorY = 98 + 5.5 - Math.sqrt(Math.max(0, 36 - (x80 - 40.5) ** 2)) - 2;
        if (ly >= doorY) return ly - doorY < 1 ? STONE[5] : '#1b130b';
      }
      if (ly === 97) return STONE[0];
      if (ly === 98) return '#9a3326';
      if (ly === 104) return STONE[4];
      if ((ly - 99) % 3 === 2 || (x + ((ly - 99) / 3 | 0) * 5) % 10 === 0) return S(3);
      return S(2);
    }
    if (ly <= 134) return seat(105, 5, false);
    if (ly <= 140) {                           // marble balustrade
      if (ly === 135) return MARBLE[0];
      if (ly === 136) return MARBLE[1];
      if (ly === 137) return GOLD[1];
      if (ly === 140) return MARBLE[4];
      return x % 4 === 0 ? MARBLE[3] : x % 4 === 1 ? MARBLE[0] : MARBLE[1];
    }
    if (ly <= 158) return seat(141, 6, true);
    // ---- podium wall
    if (ly <= 185) {
      if (ly === 159) return MARBLE[0];
      if (ly === 160) return GOLD[1];
      if (ly === 161) return GOLD[3];
      if (ly >= 182) return [MARBLE[3], MARBLE[4], MARBLE[5], MARBLE[6]][ly - 182];
      const px = x % 40, panel = Math.floor(x / 40) % 3;
      if (px <= 1 || px >= 38 || ly <= 163 || ly >= 180) return px === 0 || ly === 180 ? MARBLE[3] : MARBLE[1];
      if (px === 2 || ly === 164) return MARBLE[5];
      const cols = [['#3f6b4a', '#2f5238', '#6a9a72'], ['#8a2e2a', '#6e211f', '#b04a40'], ['#d9b25a', '#b8913f', '#f0d488']][panel];
      const v = (x * 7 + ly * 13 + ((vnoise(x / 5, ly / 5, panel) * 30) | 0)) % 19;
      return v === 0 ? cols[2] : (hash2(x, y, 11) < 0.25 ? cols[1] : cols[0]);
    }
    return undefined; // floor
  }

  floorPix(x, y) {
    let idx = vnoise(x / 26, y / 14, 5) < 0.5 ? 1 : 2;
    const vn = vnoise(x / 9, y / 6, 9);
    if (vn > 0.72 && dith(x, y, (vn - 0.72) * 4)) idx++;
    const n = hash2(x, y, 13);
    if (n < 0.05) idx++; else if (n > 0.97) idx--;
    // raked ellipses
    const ex = (x - CX) / 300, ey = (y - 268) / 92, d = Math.sqrt(ex * ex + ey * ey);
    if (d < 1 && (d * 26) % 1 < 0.08 && hash2(x, y, 17) < 0.7) idx++;
    // sun beams from the upper right
    const band = (((x + y * 0.9) % 170) + 170) % 170;
    if (band < 50 && dith(x, y, 0.55)) idx--;
    // shadow of the podium
    const dy = y - floorTop(x);
    if (dy < 2) idx = 5;
    else if (dy < 16 && dith(x, y, (16 - dy) / 14)) idx += 2;
    // bottom shade near parapet
    if (y > 330 && dith(x, y, (y - 330) / 14)) idx++;
    return SAND[clamp(idx, 0, 5)];
  }

  buildStructure() {
    const b = new Buf(W, H);
    for (let x = 0; x < W; x++) {
      const bd = bend(x);
      for (let y = 0; y < H; y++) {
        const ly = y - bd;
        const c = this.structPix(x, y, ly);
        if (c === null) continue;
        b.set(x, y, c === undefined ? this.floorPix(x, y) : c);
      }
    }
    // masts (velarium poles) on the attic
    this.masts = [];
    for (let x = 16; x < W; x += 64) {
      const top = Math.round(20 + bend(x));
      for (let y = top - 16; y < top; y++) { b.set(x, y, '#5a3a1e'); b.set(x + 1, y, '#8a5a2e'); }
      b.set(x, top - 17, GOLD[1]); b.set(x + 1, top - 17, GOLD[0]);
      this.masts.push({ x, top: top - 15 });
    }
    this.drawBanners(b);
    this.drawGates(b);
    this.drawEmperorBox(b);
    this.drawProps(b);
    return b.done();
  }

  drawBanners(b) {
    this.bannerX = [120, 200, 440, 520];
    for (const xc of this.bannerX) {
      const yt = Math.round(159 + bend(xc)) + 1;
      for (let x = xc - 10; x <= xc + 9; x++) { b.set(x, yt, GOLD[0]); b.set(x, yt + 1, GOLD[2]); }
      b.set(xc - 11, yt, GOLD[1]); b.set(xc + 10, yt, GOLD[1]);
      for (let y = yt + 2; y <= yt + 23; y++) for (let x = xc - 8; x <= xc + 7; x++) {
        const k = y - (yt + 19), dx = Math.abs(x - xc + 0.5);
        if (k > 0 && dx < (5 - k) * 2) continue;
        const edge = x === xc - 8 || x === xc + 7 || (k > 0 && dx < (6 - k) * 2);
        const fold = (x - xc + 8) % 5 === 4;
        b.set(x, y, edge ? GOLD[1] : fold ? '#7d161d' : (x - xc + 8) % 5 === 0 ? '#c0333c' : '#a3222a');
      }
      // SPQR
      const s = 'SPQR';
      for (let k = 0; k < 4; k++) {
        const gph = GLYPH[s[k]];
        for (let i = 0; i < 15; i++) if (gph[i] === '1') b.set(xc - 7 + k * 4 + (i % 3), yt + 5 + ((i / 3) | 0), GOLD[0]);
      }
      // laurel wreath
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        if (Math.abs(a - Math.PI / 2) < 0.4) continue;
        b.set(Math.round(xc - 0.5 + Math.cos(a) * 3.5), Math.round(yt + 15 + Math.sin(a) * 3), a % 0.7 < 0.35 ? '#5aa83a' : '#3f7f2a');
      }
    }
  }

  drawGates(b) {
    this.gates = [];
    for (const xc of [44, 596]) {
      const yb = Math.round(floorTop(xc)) - 1;
      const cy = yb - 18, R = 12;
      this.gates.push({ x: xc, y: yb + 6 });
      for (let y = cy - 18; y <= yb; y++) for (let x = xc - 17; x <= xc + 16; x++) {
        const dx = x - xc + 0.5, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const inOpen = (y >= cy && Math.abs(dx) < R) || (y < cy && d < R);
        const inFrame = (y >= cy && Math.abs(dx) < R + 4) || (y < cy && d < R + 4);
        if (inOpen) {
          const depth = Math.min(1, (Math.abs(dx) / R) * 0.8 + (y < cy + 4 ? 0.3 : 0));
          let col = dith(x, y, depth) ? '#2a1d12' : '#140d07';
          if (y > yb - 3) col = dith(x, y, 0.5) ? '#5a4428' : '#3a2a18';
          // raised portcullis
          const top = cy - R;
          if (y - (cy - Math.sqrt(Math.max(0, R * R - dx * dx))) < 6 && (x - xc) % 3 === 0) col = '#6b6b75';
          if (y - (cy - Math.sqrt(Math.max(0, R * R - dx * dx))) === 6 && (x - xc) % 3 === 0) col = '#9a9aa6';
          if (y === top + 7 && Math.abs(dx) < R - 1) col = '#4a4a52';
          b.set(x, y, col);
        } else if (inFrame) {
          if (y < cy) {
            const ang = Math.atan2(dy, dx);
            const seg = Math.floor((ang + Math.PI) / (Math.PI / 7));
            const joint = Math.abs(((ang + Math.PI) / (Math.PI / 7)) % 1) < 0.12;
            const keystone = Math.abs(dx) < 2.5 && dy < -R;
            b.set(x, y, keystone ? STONE[0] : joint ? STONE[4] : d > R + 3 ? STONE[3] : seg % 2 ? STONE[1] : STONE[2]);
          } else {
            const col = (y - cy) % 5 === 4 ? STONE[4] : Math.abs(dx) > R + 2 ? STONE[3] : STONE[1];
            b.set(x, y, col);
          }
        }
      }
      // torches beside the gate
      for (const tx of [xc - 20, xc + 19]) {
        const ty = Math.round(floorTop(tx)) - 18;
        b.set(tx, ty, '#3e4248'); b.set(tx, ty + 1, '#3e4248'); b.set(tx - 1, ty, '#62686e'); b.set(tx + 1, ty, '#62686e');
        b.set(tx, ty - 1, '#5a3a1e'); b.set(tx, ty - 2, '#5a3a1e');
      }
    }
  }

  drawEmperorBox(b) {
    const P = (x, y, c) => b.set(x, y, c);
    // pediment / canopy
    for (let y = 106; y <= 121; y++) {
      const half = (y - 106) * 2.3 + 3;
      for (let x = Math.round(CX - half); x <= Math.round(CX + half); x++) {
        const edge = Math.abs(x - CX) > half - 2 || y === 121;
        P(x, y, edge ? (y % 2 ? GOLD[1] : GOLD[2]) : (y > 114 && Math.abs(x - CX) < 5) ? GOLD[1] : ((x + y) % 7 === 0 ? '#7a3aa8' : '#5b2a86'));
      }
    }
    // eagle on the apex
    const eagle = ['..#.#..', '.#####.', '#######', '#.###.#', '..#.#..'];
    eagle.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && P(CX - 3 + i, 99 + j, j < 2 ? GOLD[0] : GOLD[1])));
    for (let x = 286; x <= 354; x++) { P(x, 122, GOLD[0]); P(x, 123, GOLD[2]); }
    // interior drapes
    for (let y = 124; y <= 150; y++) for (let x = 297; x <= 343; x++) {
      const k = (x - 297) % 5;
      P(x, y, k === 0 ? '#4f0e12' : k === 2 ? '#8a1c22' : '#6e1419');
    }
    for (let x = 297; x <= 343; x++) { const s = Math.round(Math.abs(Math.sin((x - 297) / 5 * Math.PI)) * 3); for (let y = 124; y <= 125 + s; y++) P(x, y, y === 125 + s ? GOLD[1] : '#5b2a86'); }
    // throne: arched gold frame around a purple back with gold studs
    for (let y = 124; y <= 150; y++) for (let x = 305; x <= 335; x++) {
      const top = 127 - Math.round(3 * (1 - ((x - CX) / 15) ** 2));
      if (y < top) continue;
      const edgeX = Math.min(x - 305, 335 - x), edgeY = y - top;
      let col;
      if (edgeX === 0 || edgeY === 0) col = GOLD[3];
      else if (edgeX === 1 || edgeY === 1) col = GOLD[1];
      else if (edgeX === 2 || edgeY === 2) col = GOLD[2];
      else col = ((x - 305) % 6 === 3 && (y - 124) % 6 === 3) ? GOLD[1] : ((x + y) % 2 ? '#3e1a5c' : '#45205f');
      P(x, y, col);
    }
    for (const fx of [305, 334]) { P(fx, 122, GOLD[0]); P(fx + 1, 122, GOLD[1]); P(fx, 123, GOLD[1]); P(fx + 1, 123, GOLD[2]); }
    P(CX, 121, GOLD[0]); P(CX - 1, 122, GOLD[1]); P(CX + 1, 122, GOLD[1]); P(CX, 122, GOLD[0]);
    // columns
    for (const c0 of [290, 345]) {
      for (let y = 124; y <= 156; y++) for (let i = 0; i < 6; i++) {
        const col = y <= 125 || y >= 155 ? (y === 124 || y === 156 ? GOLD[1] : MARBLE[1]) : [MARBLE[4], MARBLE[3], MARBLE[1], MARBLE[0], MARBLE[1], MARBLE[3]][i];
        P(c0 + i, y, col);
      }
    }
    // front parapet of the box (redrawn over the emperor every frame)
    for (let y = 150; y <= 186; y++) for (let x = 286; x <= 354; x++) {
      let col;
      if (y === 150) col = MARBLE[0];
      else if (y === 151) col = MARBLE[1];
      else if (y === 152) col = GOLD[1];
      else if (y >= 183) col = [MARBLE[3], MARBLE[4], MARBLE[5], MARBLE[6]][y - 183];
      else if (x <= 288 || x >= 352) col = x === 286 || x === 354 ? MARBLE[4] : MARBLE[2];
      else {
        col = (x + y) % 9 === 0 ? MARBLE[2] : MARBLE[1];
        if (y >= 154 && y <= 176 && x >= 293 && x <= 347) {
          const fold = (x - 293) % 6;
          col = y === 176 ? (x % 2 ? GOLD[1] : GOLD[2]) : fold === 0 ? '#3e1a5c' : fold === 3 ? '#7a3aa8' : '#5b2a86';
          const scallop = Math.round(Math.abs(Math.sin((x - 293) / 6 * Math.PI)) * 3);
          if (y > 176 - 4 + scallop && y < 176) col = MARBLE[1];
        }
      }
      P(x, y, col);
    }
    // wreath + eagle emblem on the drape
    for (let a = 0; a < Math.PI * 2; a += 0.25) P(Math.round(CX + Math.cos(a) * 6), Math.round(164 + Math.sin(a) * 6), a % 0.5 < 0.25 ? '#5aa83a' : '#3f7f2a');
    eagle.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && P(CX - 3 + i, 162 + j, GOLD[1])));
  }

  drawProps(b) {
    const P = (x, y, c) => b.set(x, y, c);
    // sword stuck in the sand
    const stuck = (x, y, lean) => {
      for (let i = 0; i < 13; i++) { const xx = Math.round(x + i * lean); P(xx, y - i, i < 9 ? STEEL[1] : '#5a3a1e'); if (i < 9) P(xx + 1, y - i, STEEL[2]); }
      for (let o = -2; o <= 2; o++) P(Math.round(x + 9 * lean) + o, y - 9, GOLD[1]);
      for (let o = -3; o <= 3; o++) P(x + o, y + 1, SAND[4]);
    };
    stuck(140, 304, 0.15); stuck(506, 236, -0.2);
    // dropped round shield
    for (let y = -3; y <= 3; y++) for (let x = -7; x <= 7; x++) {
      const d = (x / 7) ** 2 + (y / 3) ** 2;
      if (d <= 1) P(548 + x, 306 + y, d > 0.65 ? GOLD[2] : d < 0.12 ? GOLD[0] : (y < 0 ? '#b0562a' : '#8a3e1c'));
    }
    for (let x = -6; x <= 6; x++) P(548 + x, 310, SAND[4]);
    // an old husk of a fallen crab
    const hx = 470, hy = 250;
    for (let x = -6; x <= 5; x++) for (let y = -3; y <= 0; y++) P(hx + x, hy + y, y === -3 ? '#8a7a6a' : '#6a5a4a');
    for (const lx of [-5, -2, 1, 4]) { P(hx + lx, hy - 4, '#5a4a3a'); P(hx + lx, hy - 5, '#5a4a3a'); }
    for (let x = -7; x <= 6; x++) P(hx + x, hy + 1, SAND[4]);
    // pebbles & skull-ish bits
    for (let i = 0; i < 90; i++) {
      const x = (hash2(i, 1, 99) * 560 + 40) | 0, y = (hash2(i, 2, 99) * 130 + 200) | 0;
      if (y < floorTop(x) + 8) continue;
      P(x, y, SAND[4]); if (i % 3 === 0) P(x + 1, y, SAND[3]); if (i % 4 === 0) P(x, y - 1, SAND[0]);
    }
  }

  // ------------------------------------------------------------ crowd
  buildCrowd() {
    const specs = [];
    const add = (x, top, kind) => {
      const y = Math.round(top + bend(x));
      const i = specs.length;
      specs.push({
        x, y, kind,
        skin: SKIN[(hash2(i, 1) * SKIN.length) | 0],
        cloth: kind === 'senator' ? (hash2(i, 2) < 0.8 ? '#f4f1e8' : '#e8e0d0') : CLOTH[(hash2(i, 2) * CLOTH.length) | 0],
        stripe: kind === 'senator' && hash2(i, 3) < 0.5,
        hair: HAIR[(hash2(i, 4) * HAIR.length) | 0],
        bald: hash2(i, 5) < 0.12,
        ho: hash2(i, 6) < 0.5 ? 0 : 1,
        flag: hash2(i, 7) < 0.1 ? pick(['#d0283c', '#f0c850', '#3a6db3', '#ffffff', '#5b2a86']) : null,
      });
    };
    const blocked = (x, ly) => {
      if (x % 80 < 9 && ly > 60) return true;
      if (ly > 104 && x > 283 && x < 357) return true;
      if (ly > 140 && (Math.abs(x - 44) < 20 || Math.abs(x - 596) < 20)) return true;
      return false;
    };
    for (let x = 2; x < W; x += 16) for (const dx of [4, 7, 10]) add(x + dx - 2, 56, 'pleb');
    const tiers = [[62, 5, 7, 'pleb'], [105, 5, 6, 'pleb'], [141, 6, 3, 'senator']];
    for (const [top, rowH, n, kind] of tiers) for (let r = 0; r < n; r++) {
      const ly = top + rowH * r + 1;
      for (let x = 1 + (r % 2) * 2; x < W - 2; x += 4) {
        if (blocked(x, ly)) continue;
        if (hash2(x, ly, 21) < 0.1) continue;
        add(x, ly, kind);
      }
    }
    this.specs = specs;
    // pre-render 3 excitement modes x 4 frames
    this.crowdFrames = [0, 1, 2].map(mode => [0, 1, 2, 3].map(k => {
      const b = new Buf(W, 215);
      specs.forEach((s, i) => {
        const h1 = hash2(i, k, 31 + mode), h2 = hash2(i, k, 57 + mode);
        const bob = mode === 0 ? h1 < 0.07 : mode === 1 ? h1 < 0.3 : h1 < 0.55;
        const arms = mode === 0 ? h2 < 0.03 : mode === 1 ? h2 < 0.35 : h2 < 0.82;
        this.drawSpec(b, s, bob ? 1 : 0, arms);
      });
      return b.done();
    }));
  }

  drawSpec(b, s, bob, arms) {
    const x = s.x, y = s.y - bob;
    const tall = s.kind === 'pleb' && s.y - bend(s.x) < 60;
    const bodyH = tall ? 6 : 4;
    const shade = darken(s.cloth, 0.25);
    b.rect(x, y, 3, 1, darken(s.cloth, 0.4));
    for (let j = 1; j <= bodyH; j++) { b.set(x, y - j, shade); b.set(x + 1, y - j, s.cloth); b.set(x + 2, y - j, s.cloth); }
    if (s.stripe) for (let j = 1; j <= bodyH; j++) b.set(x + 1, y - j, '#6a2a96');
    const hy = y - bodyH - 2, hx = x + s.ho;
    b.set(hx, hy, s.skin); b.set(hx + 1, hy, s.skin); b.set(hx, hy + 1, s.skin); b.set(hx + 1, hy + 1, darken(s.skin, 0.12));
    if (!s.bald) { b.set(hx, hy - 1, s.hair); b.set(hx + 1, hy - 1, s.hair); }
    if (s.kind === 'senator' && !s.bald && s.stripe) { b.set(hx, hy - 1, '#5aa83a'); }
    if (arms) {
      b.set(x - 1, y - bodyH, s.skin); b.set(x - 1, y - bodyH - 1, s.skin);
      b.set(x + 3, y - bodyH, s.skin); b.set(x + 3, y - bodyH - 1, s.skin);
      if (s.flag) {
        for (let j = 2; j <= 5; j++) b.set(x + 3, y - bodyH - j, '#5a3a1e');
        b.rect(x + 4, y - bodyH - 5, 3, 2, s.flag);
      }
    }
  }

  buildForeground() {
    const b = new Buf(W, H);
    for (let x = 0; x < W; x++) for (let y = 340; y < H; y++) {
      let col;
      if (y === 340) col = STONE[0];
      else if (y === 341) col = STONE[1];
      else if (y === 342) col = STONE[3];
      else {
        const row = Math.floor((y - 343) / 6);
        col = (y - 343) % 6 === 5 || (x + row * 11) % 22 === 0 ? STONE[4] : this.stonePix(x, y, 3);
      }
      b.set(x, y, col);
    }
    // vignette
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - CX) / CX, dy = (y - 180) / 180;
      const v = dx * dx * 0.6 + dy * dy * 0.5;
      if (v > 0.55 && dith(x, y, (v - 0.55) * 0.9) && y < 340) b.set(x, y, '#1a120b', 70);
    }
    // front-row heads, only at the sides so the arena centre stays clear
    this.fgHeads = [];
    for (let x = 4; x < W; x += 9) {
      if (x > 170 && x < 470) continue;
      this.fgHeads.push({ x: x + ((hash2(x, 3) * 4) | 0), h: (hash2(x, 4) * 4) | 0, c: hash2(x, 5) < 0.5 ? '#24170e' : '#2e1f14', s: hash2(x, 6) * 6 });
    }
    return b.done();
  }

  // ------------------------------------------------------------ crabs
  clear() {
    for (const c of this.crabs) c.label?.remove();
    this.crabs = []; this.particles = []; this.debris = []; this.bolts = []; this.marker = null;
    this.emperor = { stand: 0, thumb: 0, thumbT: 0 };
    this.baseExcite = 0.05;
  }

  addCrab(id, name, x, y) {
    const c = {
      id, name, x, y, z: 0, vz: 0, tx: x, ty: y, speed: 50, facing: 1, angle: -1.1,
      hp: 100, alive: true, dead: false, hurt: 0, walkT: 0, moving: false, busy: false,
      deadT: 0, seed: Math.random() * 10, home: { x, y }, kbx: 0, kby: 0, votes: 0,
      angry: false, noClamp: true, _arrive: null, t: 0, wanderT: rand(1, 3),
    };
    this.crabs.push(c);
    return c;
  }

  clampPos(x, y) {
    x = clamp(x, 34, W - 34);
    return [x, clamp(y, floorTop(x) + 22, 326)];
  }

  walkTo(c, x, y, speed = 50, free = false) {
    if (!free) [x, y] = this.clampPos(x, y);
    c.noClamp = free;
    c.tx = x; c.ty = y; c.speed = speed;
    if (c._arrive) c._arrive();
    return new Promise(res => { c._arrive = res; });
  }

  // ------------------------------------------------------------ timing helpers
  wait(sec) { return new Promise(res => this.waiters.push({ t: this.time + sec, res })); }
  tween(sec, fn) {
    const start = this.time;
    return new Promise(res => {
      const step = () => {
        const p = clamp((this.time - start) / sec, 0, 1);
        fn(p);
        if (p >= 1) res(); else this.waiters.push({ t: this.time, res: step, frame: true });
      };
      step();
    });
  }
  async settle() { while (this.crabs.some(c => c.busy && c.alive && !c.victory)) await this.wait(0.05); }

  // ------------------------------------------------------------ fx
  sparks(x, y, n, big) {
    for (let i = 0; i < n; i++) this.particles.push({ type: 'spark', x, y, vx: rand(-90, 90) * (big ? 1.5 : 1), vy: rand(-110, 20), g: 260, life: rand(0.2, 0.5), max: 0.5 });
  }
  dust(x, y, n = 4) {
    for (let i = 0; i < n; i++) this.particles.push({ type: 'dust', x: x + rand(-4, 4), y: y + rand(-1, 1), vx: rand(-14, 14), vy: rand(-10, -2), g: 0, life: rand(0.4, 0.8), max: 0.8 });
  }
  chips(x, y, n) {
    for (let i = 0; i < n; i++) this.particles.push({ type: 'chip', x, y, vx: rand(-80, 80), vy: rand(-120, -30), g: 300, life: rand(3, 6), max: 6, gy: y + rand(8, 18), col: pick([CRAB.md, CRAB.dk, CRAB.lt]) });
  }
  floatText(x, y, text, col = '#ffffff', sc = 1, life = 1.1) {
    this.particles.push({ type: 'text', x, y, vx: 0, vy: -26, g: 0, life, max: life, text, col, sc });
  }
  petals(n) {
    for (let i = 0; i < n; i++) {
      const x = rand(10, W - 10);
      this.particles.push({ type: 'petal', x, y: rand(60, 170) + bend(x), vx: rand(-20, 20), vy: rand(-40, -10), g: 40, life: rand(8, 14), max: 14, gy: rand(floorTop(x) + 10, 330), col: pick(['#d0283c', '#f06080', '#ffffff', '#f0c850', '#e8406a']), sway: rand(0, 6) });
    }
  }
  bolt(x, y) {
    const pts = [[x + rand(-30, 30), -5]];
    let cx = pts[0][0], cy = -5;
    while (cy < y - 8) { cy += rand(10, 22); cx += rand(-14, 14); pts.push([cx, Math.min(cy, y - 8)]); }
    pts.push([x, y - 8]);
    this.bolts.push({ pts, life: 0.35 });
    this.flash = 1;
    this.shake = 5;
  }
  excitement(v) { this.excite = clamp(this.excite + v, 0, 1); }

  // ------------------------------------------------------------ combat choreography
  async attack(a, v, opts = {}) {
    const { dmg = 10, lethal = false, spar = false } = opts;
    a.busy = true;
    if (spar) v.busy = true;
    const side = a.x < v.x ? -1 : 1;
    const reach = FIGHTERS[a.id]?.weapon === 'trident' || FIGHTERS[a.id]?.weapon === 'spear' ? 30 : 24;
    await this.walkTo(a, v.x + side * reach, v.y + rand(-2, 2), spar ? 75 : 120);
    a.facing = side < 0 ? 1 : -1;
    if (v.alive) v.facing = -a.facing;
    a.angry = true;
    await this.tween(0.16, p => { a.angle = -1.1 + (-2.5 + 1.1) * p; });
    await this.tween(0.07, p => { a.angle = -2.5 + 3.4 * p; });
    const hx = v.x + side * 6, hy = v.y - 12 - v.z;
    Sound.clang(spar ? 0.5 : 1);
    this.sparks(hx, hy, spar ? 7 : 14);
    if (spar) {
      v.kbx = -side * 40; a.kbx = side * 30;
      if (v.alive) { v.angle = -2.0; setTimeout(() => (v.angle = -1.1), 180); }
      this.excitement(0.06);
    } else {
      v.hurt = 0.22;
      v.hp = Math.max(lethal ? 0 : 1, v.hp - dmg);
      v.kbx = side * -70;
      this.shake = Math.max(this.shake, lethal ? 5 : 2.5);
      this.floatText(v.x - 6, v.y - 44, '-' + Math.round(dmg), '#ff5a3a', 1);
      this.chips(hx, hy, lethal ? 4 : 3);
      Sound.hit();
      this.excitement(0.25);
    }
    if (lethal) await this.kill(v, a);
    await this.wait(0.12);
    await this.tween(0.2, p => { a.angle = 0.9 + (-1.1 - 0.9) * p; });
    a.angry = false;
    a.busy = false;
    if (spar) v.busy = false;
  }

  async kill(v, killer) {
    this.slowT = 0.7;
    this.flash = 0.7;
    v.alive = false; v.dead = true; v.deadT = 0; v.hp = 0; v.busy = true;
    v.vz = 90; v.kbx = killer ? (killer.x < v.x ? 90 : -90) : 0;
    this.sparks(v.x, v.y - 12, 28, true);
    this.chips(v.x, v.y - 12, 16);
    // helmet & weapon fly off
    const f = FIGHTERS[v.id];
    this.particles.push({ type: 'helmet', x: v.x, y: v.y - 22, vx: rand(-60, 60), vy: -140, g: 320, life: 999, max: 999, gy: v.y + rand(-6, 6), id: v.id });
    this.particles.push({ type: 'weapon', x: v.x, y: v.y - 14, vx: rand(-80, 80), vy: -110, g: 320, life: 999, max: 999, gy: v.y + rand(-4, 8), kind: f?.weapon, gold: f?.metal === 'gold', rot: rand(0, 6) });
    v.noHelmet = true; v.noWeapon = true;
    this.floatText(v.x - 11, v.y - 50, 'KO!', '#ffe066', 2, 1.6);
    this.excitement(1);
    Sound.kill();
    this.particles.push({ type: 'ghost', x: v.x, y: v.y - 10, vx: 0, vy: -14, g: 0, life: 3, max: 3, id: v.id, delay: 0.8 });
    this.shake = 6;
  }

  async strike(v, reason) {  // Jupiter's lightning (disqualification)
    Sound.thunder();
    this.bolt(v.x, v.y - v.z);
    v.charred = true;
    this.excitement(0.8);
    await this.kill(v, null);
  }

  // ------------------------------------------------------------ main loop
  loop(now) {
    let dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = 0.3; } else this.timeScale = 1;
    dt *= this.speed * this.timeScale;
    this.update(dt);
    this.render();
    if (this.onFrame) this.onFrame();
    requestAnimationFrame(this.loop.bind(this));
  }

  update(dt) {
    this.time += dt;
    // waiters
    const ready = this.waiters.filter(w => this.time >= w.t);
    this.waiters = this.waiters.filter(w => this.time < w.t);
    ready.forEach(w => w.res());

    this.excite += (this.baseExcite - this.excite) * Math.min(1, dt * 0.35);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 14);
    if (this.emperor.thumbT > 0) { this.emperor.thumbT -= dt; if (this.emperor.thumbT <= 0) { this.emperor.thumb = 0; this.emperor.stand = 0; } }
    for (const cl of this.clouds) { cl.x += cl.v * dt; if (cl.x > W + 10) { cl.x = -90; cl.y = rand(2, 34); } }
    if (Math.random() < dt * 0.08) this.birds.push({ x: -10, y: rand(6, 40), v: rand(22, 40), t: 0 });
    for (const bd of this.birds) { bd.x += bd.v * dt; bd.t += dt; }
    this.birds = this.birds.filter(bd => bd.x < W + 10);

    for (const c of this.crabs) this.updateCrab(c, dt);

    // idle sparring while the models think
    if (this.skirmish) {
      this.skirmishT -= dt;
      if (this.skirmishT <= 0) {
        this.skirmishT = rand(1.0, 2.2);
        const free = this.crabs.filter(c => c.alive && !c.busy);
        if (free.length >= 2) {
          const a = pick(free), b = pick(free.filter(c => c !== a));
          this.spar(a, b);
        }
      }
    }

    for (const p of this.particles) this.updateParticle(p, dt);
    this.particles = this.particles.filter(p => p.life > 0);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter(b => b.life > 0);
    Sound.crowd(this.excite);
  }

  async spar(a, b) {
    a.busy = b.busy = true;
    await this.attack(a, b, { spar: true });
    if (Math.random() < 0.5 && b.alive) await this.attack(b, a, { spar: true });
    a.busy = b.busy = true;
    await Promise.all([this.walkTo(a, a.home.x, a.home.y, 55), this.walkTo(b, b.home.x, b.home.y, 55)]);
    a.busy = b.busy = false;
  }

  updateCrab(c, dt) {
    c.t += dt;
    c.hurt = Math.max(0, c.hurt - dt);
    if (c.dead) {
      c.deadT += dt;
      c.x += c.kbx * dt; c.kbx *= Math.pow(0.02, dt);
      c.vz -= 400 * dt; c.z = Math.max(0, c.z + c.vz * dt);
      if (c.z === 0) c.vz = 0;
      c.moving = false;
      return;
    }
    // knockback
    if (Math.abs(c.kbx) > 1) { c.x += c.kbx * dt; c.kbx *= Math.pow(0.001, dt); }
    if (c.victory) {
      c.angle = -1.9 + Math.sin(c.t * 7) * 0.35;
      if (c.z === 0 && c.vz === 0 && !c.moving && Math.random() < dt * 1.6) { c.vz = 140; this.excitement(0.1); }
    }
    // jump physics
    if (c.z > 0 || c.vz) { c.vz -= 420 * dt; c.z += c.vz * dt; if (c.z <= 0) { c.z = 0; c.vz = 0; this.dust(c.x, c.y, 3); } }
    const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
    if (d > 1.2) {
      const s = Math.min(d, c.speed * dt);
      c.x += dx / d * s; c.y += dy / d * s;
      if (Math.abs(dx) > 0.5) c.facing = dx > 0 ? 1 : -1;
      c.moving = true; c.walkT += dt;
      if (c.speed > 90 && Math.random() < dt * 14) this.dust(c.x - c.facing * 6, c.y, 1);
    } else {
      c.moving = false;
      if (c._arrive) { const r = c._arrive; c._arrive = null; r(); }
      if (!c.busy && c.wander) {
        c.wanderT -= dt;
        if (c.wanderT <= 0) {
          c.wanderT = rand(1.5, 4);
          const [x, y] = this.clampPos(c.home.x + rand(-14, 14), c.home.y + rand(-6, 6));
          c.tx = x; c.ty = y; c.speed = 22;
        }
      }
    }
    if (!c.noClamp) { const [x, y] = this.clampPos(c.x, c.y); c.x = x; c.y = y; }
  }

  updateParticle(p, dt) {
    if (p.delay > 0) { p.delay -= dt; return; }
    p.life -= dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.type === 'petal') { p.vy = Math.min(p.vy, 22); p.x += Math.sin(this.time * 3 + p.sway) * 10 * dt; }
    if (p.gy !== undefined && p.y >= p.gy) {
      p.y = p.gy;
      if ((p.type === 'helmet' || p.type === 'weapon') && Math.abs(p.vy) > 40) { p.vy *= -0.35; p.vx *= 0.6; this.dust(p.x, p.y, 2); }
      else {
        p.vy = 0; p.vx *= 0.8; p.g = 0;
        if (p.type === 'helmet' || p.type === 'weapon') { this.debris.push(p); p.life = 0; }
      }
    }
    if (p.type === 'dust') { p.vx *= 0.95; p.vy *= 0.95; }
  }

  // ------------------------------------------------------------ rendering
  render() {
    const g = this.ctx, t = this.time;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1a120b'; g.fillRect(0, 0, W, H);
    const sx = this.shake ? Math.round(rand(-this.shake, this.shake)) : 0;
    const sy = this.shake ? Math.round(rand(-this.shake, this.shake)) : 0;
    g.setTransform(1, 0, 0, 1, sx, sy);

    g.drawImage(this.sky, 0, 0);
    for (const cl of this.clouds) g.drawImage(this.cloudSprites[cl.s], Math.round(cl.x), Math.round(cl.y));
    g.fillStyle = '#3a3a4a';
    for (const bd of this.birds) {
      const up = Math.floor(bd.t * 8) % 2;
      const x = Math.round(bd.x), y = Math.round(bd.y);
      g.fillRect(x, y, 1, 1); g.fillRect(x - 2, y - up, 2, 1); g.fillRect(x + 1, y - up, 2, 1);
    }
    g.drawImage(this.struct, 0, 0);
    this.renderPennants(g, t);

    const mode = this.excite < 0.3 ? 0 : this.excite < 0.65 ? 1 : 2;
    const fr = Math.floor(t * [2, 4, 7][mode]) % 4;
    g.drawImage(this.crowdFrames[mode][fr], 0, 0);

    this.renderEmperor(g, t);
    this.renderGateTorches(g, t);
    this.renderBraziers(g, t);

    // debris on the sand
    for (const d of this.debris) this.renderDebris(g, d);

    // shadows
    g.fillStyle = 'rgba(70,40,10,0.35)';
    for (const c of this.crabs) {
      const w = Math.max(6, 13 - c.z / 4);
      g.fillRect(Math.round(c.x - w), Math.round(c.y - 1), w * 2, 2);
      g.fillRect(Math.round(c.x - w + 2), Math.round(c.y + 1), w * 2 - 4, 1);
    }
    const order = [...this.crabs].sort((a, b) => (a.dead - b.dead) * -1000 + (a.y - b.y));
    for (const c of order) this.renderCrab(g, c);

    if (this.marker && this.marker.alive) {
      const m = this.marker, bob = Math.floor(t * 6) % 2;
      const x = Math.round(m.x), y = Math.round(m.y - m.z - 44 - bob);
      g.fillStyle = '#3a0a0a';
      g.fillRect(x - 5, y - 1, 11, 4); g.fillRect(x - 3, y + 3, 7, 2); g.fillRect(x - 1, y + 5, 3, 2);
      g.fillStyle = '#ff3b30';
      g.fillRect(x - 4, y, 9, 2); g.fillRect(x - 2, y + 2, 5, 2); g.fillRect(x, y + 4, 1, 2);
    }

    for (const p of this.particles) this.renderParticle(g, p);

    for (const b of this.bolts) {
      for (const [w, col] of [[3, 'rgba(160,210,255,0.5)'], [1, '#ffffff']]) {
        g.fillStyle = col;
        for (let i = 0; i < b.pts.length - 1; i++) {
          const [x0, y0] = b.pts[i], [x1, y1] = b.pts[i + 1];
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
          for (let k = 0; k <= n; k++) g.fillRect(Math.round(x0 + (x1 - x0) * k / n) - (w >> 1), Math.round(y0 + (y1 - y0) * k / n), w, 1);
        }
      }
    }

    // foreground parapet + crowd heads
    g.drawImage(this.fg, 0, 0);
    for (const h of this.fgHeads) {
      const jump = this.excite > 0.5 ? Math.max(0, Math.round(Math.sin(t * 9 + h.s) * 3)) : Math.round(Math.sin(t * 1.5 + h.s) * 0.6);
      const y = 332 - h.h - jump;
      g.fillStyle = h.c;
      g.fillRect(h.x - 3, y, 7, 7); g.fillRect(h.x - 2, y - 1, 5, 1); g.fillRect(h.x - 5, y + 6, 11, 10);
      if (this.excite > 0.6 && h.s > 3) { g.fillRect(h.x + 5, y - 4, 2, 9); g.fillRect(h.x + 4, y - 6, 4, 3); }
    }

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,250,235,${Math.min(0.85, this.flash * 0.7)})`;
      g.fillRect(-10, -10, W + 20, H + 20);
    }
  }

  renderPennants(g, t) {
    const cols = [['#d0283c', '#8a1820'], ['#f0c850', '#b8912a'], ['#6a2a96', '#45186a'], ['#f4f1e8', '#c9c1ae']];
    this.masts.forEach((m, i) => {
      const [c1, c2] = cols[i % 4];
      for (let k = 0; k < 12; k++) {
        const h = Math.max(1, 5 - Math.floor(k / 3));
        const dy = Math.round(Math.sin(t * 5 + k * 0.55 + i) * 1.3);
        g.fillStyle = (Math.sin(t * 5 + k * 0.55 + i) > 0.3) ? c2 : c1;
        g.fillRect(m.x + 2 + k, m.top + dy, 1, h);
      }
    });
  }

  renderEmperor(g, t) {
    const e = this.emperor;
    const x0 = 312, y0 = 127 + (e.stand ? -3 : 0);
    const P = (x, y, c) => { g.fillStyle = c; g.fillRect(x0 + x, y0 + y, 1, 1); };
    // body + head from the pixel map, outlined automatically
    EMPEROR_MAP.forEach((row, j) => {
      let first = -1, last = -1;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        if (first < 0) first = i;
        last = i;
        P(i, j, EMP_PAL[ch]);
      }
      if (j >= 10 && first >= 0) { P(first - 1, j, EMP_PAL.K); P(last + 1, j, EMP_PAL.K); }
    });
    // face: blink, and a mouth that follows his mood
    if ((t % 4.3) < 0.14) { P(6, 4, EMP_PAL.s); P(10, 4, EMP_PAL.s); }
    if (e.thumb < 0) { P(6, 3, EMP_PAL.K); P(10, 3, EMP_PAL.K); P(7, 7, EMP_PAL.m); P(9, 7, EMP_PAL.m); P(6, 8, EMP_PAL.m); P(10, 8, EMP_PAL.m); }
    else if (e.thumb > 0) { P(7, 7, EMP_PAL.m); P(9, 7, EMP_PAL.m); P(6, 6, EMP_PAL.m); P(10, 6, EMP_PAL.m); }
    // resting hand on the left armrest
    P(2, 18, EMP_PAL.K); P(3, 18, EMP_PAL.S); P(4, 18, EMP_PAL.S); P(3, 19, EMP_PAL.s); P(4, 19, EMP_PAL.s);
    // right arm: resting, or thrust out with a big pumping thumb
    if (e.thumb) {
      const w = Math.round(Math.sin(t * 9) * 1.2);
      for (let i = 15; i <= 21; i++) { P(i, 11, EMP_PAL.K); P(i, 12, EMP_PAL.P); P(i, 13, EMP_PAL.q); P(i, 14, EMP_PAL.K); }
      g.fillStyle = EMP_PAL.K; g.fillRect(x0 + 21, y0 + 9 + w, 6, 7);
      g.fillStyle = EMP_PAL.S; g.fillRect(x0 + 22, y0 + 10 + w, 4, 5);
      g.fillStyle = EMP_PAL.s; g.fillRect(x0 + 22, y0 + 14 + w, 4, 1);
      g.fillStyle = EMP_PAL.K;
      if (e.thumb > 0) { g.fillRect(x0 + 22, y0 + 5 + w, 3, 5); g.fillStyle = EMP_PAL.S; g.fillRect(x0 + 23, y0 + 6 + w, 1, 4); }
      else { g.fillRect(x0 + 22, y0 + 15 + w, 3, 5); g.fillStyle = EMP_PAL.S; g.fillRect(x0 + 23, y0 + 15 + w, 1, 4); }
    } else {
      P(13, 18, EMP_PAL.S); P(14, 18, EMP_PAL.S); P(15, 18, EMP_PAL.K); P(13, 19, EMP_PAL.s); P(14, 19, EMP_PAL.s);
    }
    // redraw the box's front parapet over his legs
    g.drawImage(this.struct, 286, 150, 69, 37, 286, 150, 69, 37);
    // praetorian guards on the sand
    for (const gx of [274, 366]) {
      const gy = Math.round(floorTop(gx)) + 14;
      const hop = this.excite > 0.7 ? Math.max(0, Math.round(Math.sin(t * 8 + gx) * 1.5)) : 0;
      const Q = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(gx + x, gy - hop + y, w, h); };
      Q(-2, -4, 2, 4, '#6b3f1f'); Q(1, -4, 2, 4, '#6b3f1f');
      Q(-3, -12, 7, 8, '#a3222a'); Q(-3, -12, 1, 8, '#7d161d'); Q(-3, -6, 7, 1, GOLD[2]);
      Q(-2, -17, 5, 5, '#e0ac7e'); Q(-3, -19, 7, 3, METAL.bronze[1]); Q(-2, -21, 5, 2, '#d0283c'); Q(-1, -22, 3, 1, '#d0283c');
      Q(gx < CX ? 3 : -4, -30, 1, 28, '#7a5028'); Q(gx < CX ? 2 : -5, -33, 3, 3, STEEL[1]);
      Q(gx < CX ? -6 : 4, -12, 3, 8, '#a3222a'); Q(gx < CX ? -6 : 4, -12, 3, 1, GOLD[1]);
    }
  }

  renderFlame(g, x, y, t, size = 1) {
    for (let cx = -4 * size; cx <= 4 * size; cx++) {
      const n = vnoise(cx * 0.6 + x, t * 9, 3);
      const h = Math.max(0, (6 + 7 * n) * size * (1 - Math.abs(cx) / (5 * size)));
      for (let k = 0; k < h; k++) {
        const f = k / h;
        g.fillStyle = f < 0.3 ? '#fff3b0' : f < 0.55 ? '#ffc93c' : f < 0.8 ? '#ff8a1f' : '#d4421c';
        if (Math.abs(cx) > 2 * size && f < 0.3) g.fillStyle = '#ffc93c';
        g.fillRect(x + cx, y - k, 1, 1);
      }
    }
    if (Math.random() < 0.08) this.particles.push({ type: 'ember', x: x + rand(-3, 3), y: y - 8, vx: rand(-6, 6), vy: rand(-30, -15), g: 0, life: rand(0.6, 1.2), max: 1.2 });
    if (Math.random() < 0.05) this.particles.push({ type: 'smoke', x: x + rand(-2, 2), y: y - 14 * size, vx: rand(-3, 5), vy: rand(-14, -8), g: 0, life: rand(1.2, 2), max: 2 });
  }

  renderBraziers(g, t) {
    for (const bx of [150, 236, 404, 490]) {
      const by = Math.round(floorTop(bx)) + 12;
      const glow = g.createRadialGradient(bx, by - 16, 1, bx, by - 16, 26);
      glow.addColorStop(0, 'rgba(255,170,60,0.28)'); glow.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = glow; g.fillRect(bx - 26, by - 42, 52, 52);
      g.fillStyle = '#2e2a28';
      for (let k = 0; k < 9; k++) { g.fillRect(bx - 5 + Math.round(k * 0.45), by - k, 1, 1); g.fillRect(bx + 5 - Math.round(k * 0.45), by - k, 1, 1); }
      g.fillRect(bx, by - 9, 1, 9);
      g.fillStyle = 'rgba(70,40,10,0.35)'; g.fillRect(bx - 6, by + 1, 13, 1);
      g.fillStyle = METAL.bronze[3]; g.fillRect(bx - 6, by - 13, 13, 4);
      g.fillStyle = METAL.bronze[1]; g.fillRect(bx - 7, by - 13, 15, 1);
      g.fillStyle = METAL.bronze[2]; g.fillRect(bx - 4, by - 10, 9, 1);
      this.renderFlame(g, bx, by - 14, t, 1);
    }
  }

  renderGateTorches(g, t) {
    for (const gx of [44, 596]) for (const tx of [gx - 20, gx + 19]) {
      const ty = Math.round(floorTop(tx)) - 21;
      this.renderFlame(g, tx, ty, t + tx, 0.55);
    }
  }

  renderCrab(g, c) {
    const s = this.sg;
    s.clearRect(0, 0, 96, 72);
    drawCrab(s, 48, 56, c);
    if (c.hurt > 0 && !c.dead) {
      s.globalCompositeOperation = 'source-atop';
      s.fillStyle = `rgba(255,255,255,${Math.min(1, c.hurt * 5)})`;
      s.fillRect(0, 0, 96, 72);
      s.globalCompositeOperation = 'source-over';
    }
    g.save();
    g.translate(Math.round(c.x), Math.round(c.y - c.z));
    if (c.facing < 0) g.scale(-1, 1);
    if (c.dead) {
      g.translate(0, -9); g.scale(1, -1); g.translate(0, 9);
      if (!c.charred) g.filter = 'saturate(45%) brightness(85%)';
    }
    g.drawImage(this.spr, -48, -56);
    g.restore();
    g.filter = 'none';
  }

  renderDebris(g, d) {
    const x = Math.round(d.x), y = Math.round(d.y);
    if (d.type === 'helmet') {
      const f = FIGHTERS[d.id], m = METAL[f.metal];
      g.fillStyle = m[3]; g.fillRect(x - 5, y - 4, 10, 4);
      g.fillStyle = m[1]; g.fillRect(x - 4, y - 5, 8, 4);
      g.fillStyle = m[0]; g.fillRect(x - 2, y - 5, 2, 1);
      g.fillStyle = f.plume; g.fillRect(x - 3, y - 8, 7, 3);
      g.fillStyle = lighten(f.plume, 0.4); g.fillRect(x - 2, y - 8, 4, 1);
    } else if (d.type === 'weapon') {
      drawWeapon((px, py, col) => { g.fillStyle = col; g.fillRect(px, py, 1, 1); }, d.kind, x - 8, y - 2, 0.08 + (d.rot % 0.3), d.gold);
    }
  }

  renderParticle(g, p) {
    if (p.delay > 0) return;
    const x = Math.round(p.x), y = Math.round(p.y), f = p.life / p.max;
    switch (p.type) {
      case 'spark': g.fillStyle = f > 0.6 ? '#ffffff' : f > 0.3 ? '#ffe066' : '#ff9a2a'; g.fillRect(x, y, f > 0.5 ? 2 : 1, 1); break;
      case 'chip': g.fillStyle = CRAB.out; g.fillRect(x - 1, y - 1, 3, 3); g.fillStyle = p.col; g.fillRect(x, y, 2, 1); break;
      case 'dust': g.fillStyle = `rgba(233,207,146,${f * 0.8})`; { const s = f > 0.5 ? 2 : 3; g.fillRect(x - 1, y - 1, s, s); } break;
      case 'ember': g.fillStyle = Math.random() < 0.5 ? '#ffc93c' : '#ff6a1f'; g.fillRect(x, y, 1, 1); break;
      case 'smoke': g.fillStyle = `rgba(90,80,75,${f * 0.35})`; g.fillRect(x - 1, y - 1, 3 - Math.round(f), 3 - Math.round(f)); break;
      case 'petal': g.fillStyle = p.col; g.fillRect(x, y, 2, 1); if (p.g) g.fillRect(x + 1, y - 1, 1, 1); break;
      case 'text': {
        const a = Math.min(1, f * 2);
        g.globalAlpha = a;
        drawText(g, p.text, x, y, p.col, p.sc, '#1a0a05');
        g.globalAlpha = 1;
        break;
      }
      case 'helmet': case 'weapon': this.renderDebris(g, p); break;
      case 'ghost': {
        const s = this.sg;
        s.clearRect(0, 0, 96, 72);
        drawCrab(s, 48, 56, { id: p.id, ghost: true, t: this.time, angle: -1.1 });
        g.globalAlpha = Math.min(0.55, f * 0.8);
        g.drawImage(this.spr, x - 48 + Math.round(Math.sin(this.time * 4) * 2), y - 56);
        g.fillStyle = '#fff6c0';
        g.fillRect(x - 5, y - 32, 11, 1); g.fillRect(x - 6, y - 31, 1, 1); g.fillRect(x + 6, y - 31, 1, 1);
        g.globalAlpha = 1;
        break;
      }
    }
  }
}

// Stand-alone portrait (used on the fighter-select cards)
function renderPortrait(canvas, id, t = 0) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas'); tmp.width = 48; tmp.height = 40;
  const tg = tmp.getContext('2d');
  drawCrab(tg, 22, 36, { id, t, angle: -1.1, seed: 0 });
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(tmp, 0, 0, 48, 40, 0, 0, canvas.width, canvas.height);
}

window.Arena = Arena;
window.renderPortrait = renderPortrait;
window.FIGHTERS = FIGHTERS;
window.floorTop = floorTop;
window.ARENA_W = W; window.ARENA_H = H;
