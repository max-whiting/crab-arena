// Crab Arena — UI, backend bridge and the battle director.
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEFAULT_GLADIATORS = [
  { id: 'g0', name: 'Maximus', style: 'The Scholar' },
  { id: 'g1', name: 'Crixus', style: 'The Contrarian' },
  { id: 'g2', name: 'Spartacus', style: 'The Pragmatist' },
  { id: 'g3', name: 'Flamma', style: 'The Skeptic' },
  { id: 'g4', name: 'Priscus', style: 'The Minimalist' },
  { id: 'g5', name: 'Verus', style: 'The Storyteller' },
  { id: 'g6', name: 'Tetraites', style: 'The Strategist' },
  { id: 'g7', name: 'Carpophorus', style: 'The Wildcard' },
];

const arena = new Arena($('#game'));
const S = {
  gladiators: DEFAULT_GLADIATORS, ollamaModels: null, api: null, selected: new Set(), scale: 1,
  runId: 0, running: false, question: '', model: '', answers: {}, status: {}, log: [], round: 0,
  winner: null, crabById: {}, events: [], eventWaiter: null, skip: null, previews: {},
};
const MODEL = id => S.gladiators.find(m => m.id === id) || { id, name: id, style: '' };

// ====================================================================== layout
function layout() {
  const s = Math.min(innerWidth / ARENA_W, innerHeight / ARENA_H);
  const w = Math.round(ARENA_W * s), h = Math.round(ARENA_H * s);
  const st = $('#stage');
  Object.assign(st.style, { width: w + 'px', height: h + 'px', left: ((innerWidth - w) >> 1) + 'px', top: ((innerHeight - h) >> 1) + 'px' });
  S.scale = s;
}
addEventListener('resize', layout);
layout();

// ====================================================================== labels & bubbles
function ensureLabel(c) {
  if (c.label) return c.label;
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = `<div class="ic"></div><div class="nm">${esc(c.name)}</div><div class="hp"><i style="width:100%"></i></div>`;
  $('#overlay').appendChild(el);
  c.label = el;
  return el;
}
const bubbles = new Set();
arena.onFrame = () => {
  const s = S.scale;
  for (const c of arena.crabs) {
    const el = ensureLabel(c);
    el.style.left = (c.x * s) + 'px';
    el.style.top = ((c.dead ? c.y - 18 : c.y - c.z - 38) * s) + 'px';
    el.classList.toggle('dead', c.dead);
    el.classList.toggle('low', c.hp < 40);
    const bar = el.querySelector('.hp i');
    if (bar._hp !== c.hp) { bar.style.width = c.hp + '%'; bar._hp = c.hp; }
    const ic = (c.dead ? '' : (c.scroll ? '📜' : '') + (c.votes ? '💀'.repeat(Math.min(c.votes, 5)) : ''));
    const icEl = el.firstChild;
    if (icEl._v !== ic) { icEl.textContent = ic; icEl._v = ic; }
    el.style.display = c.hidden ? 'none' : '';
  }
  for (const b of bubbles) placeBubble(b);
};

function placeBubble(b) {
  const s = S.scale, stageW = ARENA_W * s;
  let ax, ay;
  if (b.anchor === 'emperor') { ax = 320; ay = 126; }
  else { ax = b.anchor.x; ay = b.anchor.y - b.anchor.z - 50; }
  const w = b.el.offsetWidth || 200;
  let x = ax * s;
  const minX = w / 2 + 8, maxX = stageW - w / 2 - 8;
  const cx = Math.max(minX, Math.min(maxX, x));
  b.el.style.left = cx + 'px';
  b.el.style.top = Math.max(b.el.offsetHeight + 50, ay * s) + 'px';
  b.el.style.setProperty('--tail', Math.max(14, Math.min(w - 14, w / 2 + (x - cx))) + 'px');
}

// A compact speech bubble: a header and a one-liner, with an optional "full argument"
// section. Expanding it pauses the countdown until the viewer continues.
function bubble(anchor, { head = '', short = '', full = '' }, cls = '', voice = 0) {
  const el = document.createElement('div');
  el.className = 'bubble ' + cls;
  el.innerHTML = `<div class="b-head">${head}</div><div class="b-short">${esc(short)}</div>`
    + (full ? `<div class="b-full" hidden>${full}</div>` : '')
    + `<div class="b-bar">${full ? '<button class="b-more" title="Show the full argument (E)">▾ full argument</button>' : ''}<button class="b-go" title="Continue (Space)">▶</button></div>`;
  $('#overlay').appendChild(el);
  const b = { el, anchor };
  bubbles.add(b);
  placeBubble(b);
  Sound.chatter(voice);
  let remaining = readTime(short), expanded = false;
  const more = el.querySelector('.b-more');
  const toggle = () => {
    if (!more) return;
    expanded = !expanded;
    el.classList.toggle('expanded', expanded);
    el.querySelector('.b-full').hidden = !expanded;
    more.textContent = expanded ? '▴ less' : '▾ full argument';
    if (!expanded) remaining = Math.max(remaining, 1.5);
    placeBubble(b);
  };
  return new Promise(res => {
    const done = () => { if (!bubbles.has(b)) return; bubbles.delete(b); el.remove(); S.skip = S.expand = null; res(); };
    S.skip = done; S.expand = toggle;
    el.querySelector('.b-go').onclick = done;
    if (more) { more.onclick = toggle; el.querySelector('.b-short').onclick = toggle; }
    (async () => {
      while (bubbles.has(b)) {
        await arena.wait(0.1);
        if (!expanded) remaining -= 0.1;
        if (remaining <= 0) done();
      }
    })();
  });
}
const readTime = text => Math.min(6, Math.max(2.6, 1.4 + String(text).split(/\s+/).length * 0.28));
const shorten = (text, n = 12) => { const w = String(text || '').trim().split(/\s+/); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };

addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if ((e.code === 'Space' || e.code === 'Enter') && S.skip) { e.preventDefault(); S.skip(); }
  if (e.code === 'KeyE' && S.expand) { e.preventDefault(); S.expand(); }
});

// ====================================================================== banner
let bannerTimer = null;
function banner(title, sub = '', secs = 2.2) {
  const b = $('#banner');
  b.querySelector('h1').textContent = title;
  b.querySelector('h2').textContent = sub;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerTimer);
  return new Promise(res => arena.wait(secs).then(() => { b.classList.remove('show'); res(); }));
}
const roman = n => [['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]].reduce((s, [r, v]) => { while (n >= v) { s += r; n -= v; } return s; }, '');

function toast(msg, ms = 4200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), ms);
}

// ====================================================================== markdown-lite
function md(src) {
  const blocks = [];
  src = String(src || '').replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(code); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.t}>` + list.items.map(i => `<li>${inline(i)}</li>`).join('') + `</${list.t}>`); list = null; } };
  for (const line of src.split('\n')) {
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) { flushPara(); flushList(); out.push('<pre><code>' + esc(blocks[+line.trim().slice(1, -1)]) + '</code></pre>'); }
    else if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
    else if ((m = line.match(/^>\s?(.*)/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => '<pre><code>' + esc(blocks[+i]) + '</code></pre>');
}

// ====================================================================== backends
const RealBackend = {
  start: (q, ids, o) => window.pywebview.api.start_battle(q, ids, o.model, o.judge, o.styles),
  poll: () => window.pywebview.api.poll(),
  stop: () => window.pywebview.api.stop_battle(),
};

const DemoBackend = (() => {
  let queue = [], timers = [];
  const TAUNTS = [
    "{t} claims the answer is simple, but ignores the most common exception entirely. Anyone following that advice gets it wrong half the time.",
    "{t} gives three options and never says which one to pick or why. A question asked deserves an answer, not a menu.",
    "{t} states a 'fact' with no reasoning behind it, and it's the one claim the whole answer depends on.",
    "{t} contradicts itself: the second paragraph undoes the first. Which is it, gladiator?",
    "{t} answers a different, easier question than the one that was asked.",
  ];
  const QUIPS = [
    '{t} forgot the exception that matters most!',
    '{t} gave a menu, not an answer.',
    "{t}'s key claim has no legs to stand on.",
    '{t} argues with itself and loses.',
    '{t} answered the wrong question entirely!',
  ];
  const DEFENSES = [
    "My answer names the exception explicitly and explains why it matters.",
    "Fair hit on length, but every point I made is correct and actionable.",
    "I was attacked for hedging. I hedged because the evidence is genuinely mixed, and I said so.",
    "Nobody laid a claw on my reasoning. It stands.",
  ];
  const push = (ms, ev) => timers.push(setTimeout(() => queue.push(ev), ms));
  return {
    start(q, ids) {
      queue = []; timers.forEach(clearTimeout); timers = [];
      let alive = [...ids], t = 300, cost = 0;
      const name = id => MODEL(id).name;
      push(t, { type: 'start', fighters: ids });
      const dqId = ids.length > 3 && Math.random() < 0.35 ? ids[ids.length - 1] : null;
      const answerTimes = ids.map(() => 2500 + Math.random() * 5000);
      ids.forEach((id, i) => {
        cost += 180;
        const c = cost;
        push(answerTimes[i], { type: 'stats', tokens: c, secs: Math.round(answerTimes[i] / 1000) });
        if (id === dqId) push(answerTimes[i], { type: 'dq', id, reason: 'HTTP 404: model not available (demo)' });
        else push(answerTimes[i], { type: 'answer', id, text: `**${name(id)}'s answer** *(practice bout: this is placeholder text)*\n\nHere is where the real answer to:\n\n> ${q || 'your question'}\n\nwould appear. In a real battle every model answers this independently, then the crabs argue over whose scroll is best.\n\n- Point one, argued with great conviction\n- Point two, backed by a claw-wave\n- A \`code snippet\` for flavour` });
      });
      if (dqId) alive = alive.filter(a => a !== dqId);
      t = Math.max(...answerTimes) + 400;
      push(t, { type: 'answers_done', alive: [...alive] });
      let rnd = 0;
      while (alive.length > 1) {
        rnd++;
        t += 1500;
        push(t, { type: 'round', n: rnd, alive: [...alive] });
        t += 2500 + Math.random() * 2000;
        const votes = {}, voters = {};
        for (const id of alive) {
          const rivals = alive.filter(a => a !== id);
          const tgt = rivals[(Math.random() * rivals.length) | 0];
          votes[tgt] = (votes[tgt] || 0) + 1;
          (voters[tgt] = voters[tgt] || []).push(id);
          const k = (Math.random() * TAUNTS.length) | 0;
          push(t, { type: 'taunt', id, target: tgt, text: TAUNTS[k].replace('{t}', name(tgt)), quip: QUIPS[k].replace('{t}', name(tgt)), defense: DEFENSES[(Math.random() * DEFENSES.length) | 0] });
        }
        t += 2000;
        const doomed = alive[(Math.random() * alive.length) | 0];
        push(t, { type: 'verdict', doomed, tied: [...alive], text: `${name(doomed)} never answered the criticism of its central claim. An unanswered wound is a mortal one.`, short: 'An unanswered wound is a mortal one.' });
        alive = alive.filter(a => a !== doomed);
        push(t, { type: 'eliminate', id: doomed, voters: voters[doomed] || [], tally: votes, by_emperor: true, final: alive.length === 1 });
      }
      push(t + 200, { type: 'winner', id: alive[0] });
      push(t + 300, { type: 'done' });
      return Promise.resolve({ ok: true });
    },
    poll() { const out = queue; queue = []; return Promise.resolve(out); },
    stop() { timers.forEach(clearTimeout); timers = []; queue = []; return Promise.resolve(); },
  };
})();

// ====================================================================== event stream
function startPolling(backend, runId) {
  S.events = [];
  (async function loop() {
    while (S.runId === runId) {
      let evs = [];
      try { evs = await backend.poll(); } catch (e) { console.error(e); }
      for (const ev of evs || []) {
        if (ev.type === 'stats') { $('#hudCost').textContent = `${S.model} · ${ev.tokens} tok · ${ev.secs}s`; continue; }
        S.events.push(ev);
      }
      if (S.events.length && S.eventWaiter) { const w = S.eventWaiter; S.eventWaiter = null; w(); }
      if (S.events.some(e => e.type === 'done')) return;
      await sleep(250);
    }
  })();
}
async function nextEvent(runId) {
  while (!S.events.length) {
    if (S.runId !== runId) return null;
    arena.skirmish = true;
    await new Promise(res => { S.eventWaiter = res; setTimeout(res, 500); });
  }
  arena.skirmish = false;
  return S.events.shift();
}

// ====================================================================== director
const crab = id => S.crabById[id];
const spots = n => Array.from({ length: n }, (_, i) => {
  const a = Math.PI + (i * 2 * Math.PI) / n + (n % 2 ? 0 : Math.PI / n / 2);
  return { x: 320 + Math.cos(a) * 160, y: 266 + Math.sin(a) * 44 };
});
function setHomes(list) {
  spots(list.length).forEach((p, i) => { const [x, y] = arena.clampPos(p.x, p.y); list[i].home = { x, y }; });
}
function status(text) { $('#hudStatus').textContent = text; }
function logSys(text) { S.log.push({ sys: true, text }); }

async function runBattle(backend, question, ids, opts) {
  const runId = ++S.runId;
  const live = () => S.runId === runId;
  Object.assign(S, { running: true, question, model: opts.model, answers: {}, status: {}, log: [], round: 0, winner: null, crabById: {}, backend });
  clearPreviews();
  arena.clear();
  $('#setup').hidden = true;
  $('#winner').hidden = true;
  $('#hud').hidden = false;
  $('#hudQ').textContent = '“' + question + '”';
  $('#hudQ').title = question;
  $('#hudCost').textContent = opts.model;
  status('Opening the gates…');

  try { await backend.start(question, ids, opts); }
  catch (e) { toast('Could not start the battle: ' + e); return backToSetup(); }
  startPolling(backend, runId);

  // crabs march in from the two gates
  const crabs = ids.map((id, i) => {
    const gate = arena.gates[i % 2];
    const c = arena.addCrab(id, MODEL(id).name, gate.x, gate.y);
    c.hidden = true;
    S.crabById[id] = c;
    S.status[id] = 'Fighting';
    return c;
  });
  setHomes(crabs);
  Sound.fanfare();
  arena.baseExcite = 0.2;
  banner('LET THE GAMES BEGIN', ids.length + ' gladiators enter the arena', 2.6);
  for (let i = 0; i < crabs.length; i++) {
    const c = crabs[i], dir = i % 2 ? -1 : 1;
    c.hidden = false;
    c.busy = true;
    arena.excitement(0.15);
    arena.walkTo(c, c.x + dir * 34, c.y + 16, 70, true)
      .then(() => arena.walkTo(c, c.home.x, c.home.y, 70))
      .then(() => { c.busy = false; c.wander = true; c.facing = c.x < 320 ? 1 : -1; });
    await arena.wait(0.45);
  }
  await arena.settle();
  if (!live()) return;
  let answered = 0;
  status(`The gladiators are writing their scrolls… 0/${ids.length}`);

  while (live()) {
    const ev = await nextEvent(runId);
    if (!ev || !live()) return;
    await arena.settle();
    if (!live()) return;
    switch (ev.type) {
      case 'answer': {
        const c = crab(ev.id);
        S.answers[ev.id] = ev.text;
        c.scroll = true;
        c.vz = 110;
        arena.floatText(c.x - 14, c.y - 48, 'READY!', '#ffe066', 1);
        Sound.blip();
        answered++;
        status(`The gladiators are writing their scrolls… ${answered}/${ids.length}`);
        break;
      }
      case 'dq': {
        const c = crab(ev.id);
        S.status[ev.id] = 'Struck down by Jupiter: ' + ev.reason;
        logSys(`⚡ ${c.name} was struck down by Jupiter (${ev.reason})`);
        answered++;
        c.busy = true;
        await arena.strike(c);
        await bubble(c, { head: '⚡ JUPITER STRIKES!', short: `${c.name} is disqualified`, full: `<p>${esc(ev.reason)}</p>` }, 'jupiter');
        break;
      }
      case 'answers_done': {
        crabs.forEach(c => (c.scroll = false));
        status('The scrolls are sealed');
        arena.baseExcite = 0.25;
        if (ev.alive.length > 1) await banner('THE SCROLLS ARE SEALED', 'Now they argue. To the death.', 2.4);
        break;
      }
      case 'round': {
        S.round = ev.n;
        const alive = ev.alive.map(crab);
        crabs.forEach(c => (c.votes = 0));
        logSys(`— ROUND ${roman(ev.n)} —`);
        status(`Round ${roman(ev.n)} · ${alive.length} remain · preparing their arguments…`);
        setHomes(alive);
        Sound.fanfare();
        banner('ROUND ' + roman(ev.n), alive.length === 2 ? 'The final two' : alive.length + ' gladiators remain', 2.2);
        await Promise.all(alive.map(c => { c.busy = true; return arena.walkTo(c, c.home.x, c.home.y, 60).then(() => { c.busy = false; c.facing = c.x < 320 ? 1 : -1; }); }));
        break;
      }
      case 'taunt': await showTaunt(ev); break;
      case 'verdict': {
        const d = crab(ev.doomed);
        status('The Emperor has weighed the arguments');
        arena.emperor.stand = 1; arena.emperor.thumb = 0;
        arena.marker = d;
        S.log.push({ who: 'THE EMPEROR', text: ev.text, target: d.name });
        Sound.drumroll();
        await bubble('emperor', { head: `👑 THE EMPEROR CONDEMNS ${esc(d.name.toUpperCase())}`, short: ev.short || shorten(ev.text), full: `<p>${esc(ev.text)}</p>` }, 'emperor', 9);
        arena.marker = null;
        break;
      }
      case 'eliminate': await execute(ev, runId); break;
      case 'winner': await victory(ev); break;
      case 'fatal': {
        toast(ev.message, 9000);
        status('The games were cancelled');
        logSys('✖ ' + ev.message);
        arena.baseExcite = 0.05;
        Sound.boo();
        break;
      }
      case 'done': S.running = false; return;
    }
  }
}

async function showTaunt(ev) {
  const a = crab(ev.id), t = crab(ev.target);
  if (!a || !t || !a.alive) return;
  status(`Round ${roman(S.round)} · ${a.name} speaks`);
  a.busy = true;
  const home = { ...a.home };
  arena.marker = t;
  Sound.ooh();
  await arena.walkTo(a, a.x + (t.x - a.x) * 0.22, a.y + (t.y - a.y) * 0.22, 60);
  a.facing = t.x > a.x ? 1 : -1;
  a.angry = true; a.angle = -0.25;
  t.votes = (t.votes || 0) + 1;
  arena.excitement(0.18);
  S.log.push({ who: a.name, target: t.name, text: ev.text, defense: ev.defense });
  const def = ev.defense ? `<p class="def"><b>🛡 Defence</b> ${esc(ev.defense)}</p>` : '';
  await bubble(a, {
    head: `${esc(a.name)} <span class="tgt">⚔ ${esc(t.name)}</span>`,
    short: ev.quip || shorten(ev.text),
    full: `<p><b>⚔ Attack</b> ${esc(ev.text)}</p>${def}`,
  }, '', Number(a.id.slice(1)) || 0);
  a.angry = false; a.angle = -1.1;
  arena.marker = null;
  await arena.walkTo(a, home.x, home.y, 60);
  a.facing = a.x < 320 ? 1 : -1;
  a.busy = false;
}

async function execute(ev, runId) {
  const d = crab(ev.id);
  const votes = ev.tally?.[ev.id] || 0;
  arena.emperor.stand = 1; arena.emperor.thumb = -1; arena.emperor.thumbT = 3.5;
  d.busy = true; d.wander = false;
  S.status[ev.id] = `Slain in round ${roman(S.round)}` + (ev.by_emperor ? ' by imperial decree' : '');
  Sound.boo();
  await banner(d.name + ' IS CONDEMNED', votes ? `${votes} rival${votes === 1 ? '' : 's'} struck at its answer` : 'its answer could not survive the debate', 1.8);
  const others = arena.crabs.filter(c => c.alive && c !== d);
  if (ev.final && others.length === 1) {
    await duel(others[0], d);
  } else {
    let voters = (ev.voters || []).map(crab).filter(c => c && c.alive && c !== d);
    if (!voters.length) voters = [others[(Math.random() * others.length) | 0]];
    voters = voters.slice(0, 5);
    for (let i = 0; i < voters.length; i++) {
      const v = voters[i], last = i === voters.length - 1;
      const dmg = last ? d.hp : Math.min(d.hp - 10, 100 / voters.length + Math.random() * 8);
      await arena.attack(v, d, { dmg, lethal: last });
      v.busy = true;
      arena.walkTo(v, v.home.x, v.home.y, 60).then(() => { v.busy = false; v.facing = v.x < 320 ? 1 : -1; });
    }
  }
  logSys(`☠ ${d.name} has fallen`);
  arena.crabs.forEach(c => (c.votes = 0));
  await arena.wait(1.6);
}

async function duel(w, d) {
  status('The final duel!');
  w.busy = d.busy = true;
  await banner('FINAL DUEL', `${w.name}  vs  ${d.name}`, 1.8);
  await Promise.all([arena.walkTo(w, 360, 268, 70), arena.walkTo(d, 280, 268, 70)]);
  const seq = [[d, w, 14], [w, d, 22], [d, w, 18], [w, d, 26], [d, w, 12], [w, d, 20]];
  for (const [a, v, dmg] of seq) {
    await arena.attack(a, v, { dmg });
    a.busy = v.busy = true;
    await arena.wait(0.15);
  }
  await arena.attack(w, d, { dmg: d.hp, lethal: true });
  w.busy = false;
}

async function victory(ev) {
  const w = crab(ev.id);
  if (!w) return;
  S.winner = w;
  if (ev.answer) S.answers[ev.id] = ev.answer;
  S.status[ev.id] = '🏆 Victor';
  logSys(`🏆 ${w.name} is victorious`);
  status(`${w.name} is victorious!`);
  w.busy = true; w.wander = false;
  arena.emperor.stand = 1; arena.emperor.thumb = 1; arena.emperor.thumbT = 9999;
  arena.baseExcite = 1;
  Sound.fanfare(true);
  Sound.roar();
  await arena.walkTo(w, 320, 292, 80);
  w.facing = 1; w.laurel = true; w.victory = true; w.hp = Math.max(w.hp, 1);
  arena.petals(160);
  await banner('VICTOR!', w.name, 3);
  arena.petals(80);
  showWinner(w);
}

// ====================================================================== winner / scrolls
function showWinner(w) {
  const el = $('#winner');
  el.innerHTML = `
    <div class="w-head"><canvas width="144" height="120"></canvas>
      <div><div class="k">🏆 VICTOR OF THE ARENA</div><h2>${esc(w.name)}</h2><small>${esc(MODEL(w.id).style || '')} · ${esc(S.model)}</small></div></div>
    <div class="w-q">“${esc(S.question)}”</div>
    <div class="w-ans md">${md(S.answers[w.id] || '')}</div>
    <div class="w-btns">
      <button id="wCopy">Copy answer</button>
      <button id="wAll">All scrolls</button>
      <button id="wHide">Hide</button>
      <button id="wNew" class="big">New battle</button>
    </div>`;
  renderPortrait(el.querySelector('canvas'), w.id, arena.time);
  el.hidden = false;
  $('#wCopy').onclick = () => { navigator.clipboard?.writeText(S.answers[w.id] || '').then(() => toast('Answer copied', 1600), () => toast('Copy failed', 1600)); };
  $('#wAll').onclick = () => openScrolls(w.id);
  $('#wHide').onclick = () => { el.hidden = true; };
  $('#wNew').onclick = backToSetup;
}

function openScrolls(focus) {
  const ids = Object.keys(S.crabById);
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  const show = key => {
    [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === key));
    const body = $('#modalBody');
    if (key === '__log') {
      body.innerHTML = S.log.length ? S.log.map(e => e.sys
        ? `<div class="log-entry sys">${esc(e.text)}</div>`
        : `<div class="log-entry"><span class="who">${esc(e.who)}</span>${e.target ? ' → <b>' + esc(e.target) + '</b>' : ''}: ${esc(e.text)}${e.defense ? '<br>🛡 <i>' + esc(e.defense) + '</i>' : ''}</div>`).join('')
        : '<p>No blood has been spilled yet.</p>';
    } else {
      body.innerHTML = `<div class="status">${esc(MODEL(key).name)} · ${esc(S.status[key] || '')}</div>` +
        (S.answers[key] ? md(S.answers[key]) : '<p><i>This gladiator has not finished its scroll.</i></p>');
    }
    body.scrollTop = 0;
  };
  for (const id of ids) {
    const b = document.createElement('button');
    b.textContent = MODEL(id).name; b.dataset.k = id;
    if (crab(id)?.dead) b.classList.add('dead');
    b.onclick = () => show(id);
    tabs.appendChild(b);
  }
  const lb = document.createElement('button');
  lb.textContent = 'Battle log'; lb.dataset.k = '__log'; lb.onclick = () => show('__log');
  tabs.appendChild(lb);
  show(focus && ids.includes(focus) ? focus : focus === '__log' ? '__log' : (S.winner?.id || ids[0] || '__log'));
  $('#modal').hidden = false;
}
$('#modalClose').onclick = () => ($('#modal').hidden = true);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });

// click a crab to read its scroll
$('#game').addEventListener('click', e => {
  const r = $('#game').getBoundingClientRect();
  const x = (e.clientX - r.left) / S.scale, y = (e.clientY - r.top) / S.scale;
  let best = null, bd = 18;
  for (const c of arena.crabs) {
    const d = Math.hypot(c.x - x, c.y - 10 - y);
    if (d < bd) { bd = d; best = c; }
  }
  if (best && S.crabById[best.id]) openScrolls(best.id);
});

// ====================================================================== HUD buttons
$('#btnSpeed').onclick = () => {
  arena.speed = arena.speed >= 3 ? 1 : arena.speed + 1;
  $('#btnSpeed').textContent = arena.speed + '×';
};
function syncMute() {
  $('#btnMute').textContent = Sound.muted ? '✕♪' : '♪';
  $('#btnMusic').textContent = Sound.music ? '♫' : '✕♫';
  $('#setMute').textContent = '♪ Sound: ' + (Sound.muted ? 'off' : 'on');
  $('#setMusic').textContent = '♫ Music: ' + (Sound.music ? 'on' : 'off');
  $('#btnMute').classList.toggle('off', Sound.muted); $('#btnMusic').classList.toggle('off', !Sound.music);
}
$('#btnMute').onclick = $('#setMute').onclick = () => { Sound.init(); Sound.toggle(); syncMute(); };
$('#btnMusic').onclick = $('#setMusic').onclick = () => { Sound.init(); Sound.toggleMusic(); syncMute(); };
addEventListener('pointerdown', () => Sound.init(), { once: true });
syncMute();
$('#btnScrolls').onclick = () => openScrolls();
$('#btnFlee').onclick = backToSetup;

function backToSetup() {
  S.runId++;
  S.running = false;
  S.skip?.();
  S.backend?.stop?.();
  for (const b of bubbles) b.el.remove();
  bubbles.clear();
  arena.clear();
  arena.skirmish = false;
  arena.speed = 1; $('#btnSpeed').textContent = '1×';
  $('#hud').hidden = true;
  $('#winner').hidden = true;
  $('#modal').hidden = true;
  $('#setup').hidden = false;
  syncPreviews();
}

// ====================================================================== setup screen
function clearPreviews() {
  for (const id in S.previews) S.previews[id].label?.remove();
  arena.crabs = arena.crabs.filter(c => !Object.values(S.previews).includes(c));
  S.previews = {};
}
function syncPreviews() {
  if ($('#setup').hidden) return;
  const ids = [...S.selected];
  for (const id of Object.keys(S.previews)) {
    if (!S.selected.has(id)) {
      const c = S.previews[id];
      delete S.previews[id];
      c.busy = true;
      arena.walkTo(c, 596, arena.gates[1].y, 90, true).then(() => { c.label?.remove(); arena.crabs = arena.crabs.filter(x => x !== c); });
    }
  }
  ids.forEach(id => {
    if (!S.previews[id]) {
      const g = arena.gates[1];
      const c = arena.addCrab(id, MODEL(id).name, g.x, g.y);
      S.previews[id] = c;
    }
  });
  // line them up on the right half of the arena
  ids.forEach((id, i) => {
    const c = S.previews[id];
    const col = i % 4, row = (i / 4) | 0;
    const [x, y] = arena.clampPos(390 + col * 55 + row * 20, 250 + row * 42);
    c.home = { x, y };
    c.busy = true;
    arena.walkTo(c, x, y, 80).then(() => { c.busy = false; c.wander = true; c.facing = -1; });
  });
}

function updateHints() {
  const n = S.selected.size;
  $('#pickCount').textContent = `(${n} chosen)`;
  let calls = n;
  for (let k = n; k >= 2; k--) calls += k + 1;
  $('#callHint').textContent = n >= 2
    ? `≈ ${calls} local model calls: ${n} answers, then every round each survivor argues and the Emperor judges.`
    : 'Choose at least two gladiators.';
}

function buildFighterCards() {
  const box = $('#fighters');
  box.innerHTML = '';
  for (const m of S.gladiators) {
    const card = document.createElement('div');
    card.className = 'fcard' + (S.selected.has(m.id) ? ' on' : '');
    card.innerHTML = `<canvas width="96" height="80"></canvas><div class="n">${esc(m.name)}</div><div class="t">${esc(m.style)}</div>`;
    renderPortrait(card.querySelector('canvas'), m.id);
    card.onclick = () => {
      Sound.init();
      if (S.selected.has(m.id)) S.selected.delete(m.id); else S.selected.add(m.id);
      card.classList.toggle('on', S.selected.has(m.id));
      updateHints();
      syncPreviews();
    };
    box.appendChild(card);
  }
}

const PREFERRED = ['llama3.1:8b', 'qwen2.5:7b', 'gemma2:9b'];
function fillModelSelects(saved = {}) {
  const models = S.ollamaModels || [];
  const opts = models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  $('#modelSel').innerHTML = opts || '<option value="">(no models)</option>';
  $('#judgeSel').innerHTML = '<option value="">Same as gladiators</option>' + opts;
  const def = [saved.model, ...PREFERRED].find(m => m && models.includes(m)) || models[0] || '';
  $('#modelSel').value = def;
  $('#judgeSel').value = saved.judge && models.includes(saved.judge) ? saved.judge : '';
}

function renderOllamaRow() {
  const row = $('#keyRow');
  if (!S.api) {
    row.innerHTML = `<span>Running outside the desktop app, so only practice bouts work here.</span>`;
    return;
  }
  if (S.ollamaModels) {
    row.innerHTML = `<span>🟢 Ollama is running · ${S.ollamaModels.length} model${S.ollamaModels.length === 1 ? '' : 's'} installed</span><button id="olRefresh">Refresh</button>`;
    if (!S.ollamaModels.length) row.innerHTML += `<div class="hint" style="width:100%">No models yet. In a terminal run: ollama pull llama3.1:8b</div>`;
  } else {
    row.innerHTML = `<span>🔴 Ollama isn't running</span><button id="olStart">Start Ollama</button><button id="olRefresh">Retry</button>
      <div class="hint" style="width:100%">Crab Arena runs on local models through Ollama (ollama.com).</div>`;
    $('#olStart').onclick = async () => {
      $('#olStart').disabled = true; $('#olStart').textContent = 'Starting…';
      const r = await S.api.start_ollama();
      if (!r.ok) toast("Couldn't start Ollama. Is it installed and on your PATH?");
      S.ollamaModels = r.models; fillModelSelects({ model: $('#modelSel').value }); renderOllamaRow();
    };
  }
  $('#olRefresh').onclick = async () => {
    const r = await S.api.ollama_status();
    S.ollamaModels = r.models; fillModelSelects({ model: $('#modelSel').value, judge: $('#judgeSel').value }); renderOllamaRow();
  };
}

const chosenIds = () => S.gladiators.map(m => m.id).filter(id => S.selected.has(id));
const battleOpts = () => ({ model: $('#modelSel').value, judge: $('#judgeSel').value, styles: $('#stylesChk').checked });

$('#btnStart').onclick = () => {
  Sound.init();
  const q = $('#question').value.trim();
  if (S.selected.size < 2) return toast('Choose at least two gladiators.');
  if (!q) return toast('Ask the gladiators a question first.');
  if (!S.api) return toast('Real battles need the desktop app. Try a practice bout instead.');
  if (!S.ollamaModels) return toast('Start Ollama first.');
  if (!$('#modelSel').value) return toast('Install a model first: ollama pull llama3.1:8b');
  runBattle(RealBackend, q, chosenIds(), battleOpts());
};
$('#btnDemo').onclick = () => {
  Sound.init();
  if (S.selected.size < 2) return toast('Choose at least two gladiators.');
  const q = $('#question').value.trim() || 'What is the meaning of life?';
  runBattle(DemoBackend, q, chosenIds(), { ...battleOpts(), model: $('#modelSel').value || 'demo' });
};

async function init() {
  // wait briefly for pywebview to inject its bridge
  for (let i = 0; i < 30 && !(window.pywebview && window.pywebview.api && window.pywebview.api.get_setup); i++) await sleep(100);
  let saved = {};
  if (window.pywebview?.api?.get_setup) {
    S.api = window.pywebview.api;
    try {
      const cfg = await S.api.get_setup();
      S.gladiators = cfg.gladiators;
      S.ollamaModels = cfg.models;
      saved = cfg;
      (cfg.last_fighters || []).forEach(id => S.selected.add(id));
      $('#stylesChk').checked = cfg.styles !== false;
    } catch (e) { console.error(e); }
  }
  buildFighterCards();
  fillModelSelects(saved);
  if (S.selected.size === 0) ['g0', 'g1', 'g2', 'g3'].forEach(id => S.selected.add(id));
  [...$('#fighters').children].forEach((c, i) => c.classList.toggle('on', S.selected.has(S.gladiators[i].id)));
  renderOllamaRow();
  updateHints();
  syncPreviews();
}
init();
