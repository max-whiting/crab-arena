// Synthesised arena audio (WebAudio, no audio files).
// Crowd = a bank of formant-filtered "voices", weapons = inharmonic metal partials,
// music = a small lyre + frame-drum sequencer in D Phrygian dominant, all through a
// generated arena reverb.
'use strict';
const Sound = (() => {
  let ac = null, master = null, sfx = null, musicBus = null, reverb = null, wet = null;
  let crowdBus = null, voices = [], brown = null;
  let muted = false, musicOn = true;
  try {
    muted = localStorage.getItem('crab-muted') === '1';
    musicOn = localStorage.getItem('crab-music') !== '0';
  } catch (e) { /* storage unavailable */ }

  const now = () => ac.currentTime;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function makeImpulse(secs, decay) {
    const len = ac.sampleRate * secs, buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function makeBrown(secs) {
    const len = ac.sampleRate * secs, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return buf;
  }

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.8;
    master.connect(comp).connect(ac.destination);
    reverb = ac.createConvolver(); reverb.buffer = makeImpulse(2.6, 3.2);
    wet = ac.createGain(); wet.gain.value = 0.28;
    reverb.connect(wet).connect(master);
    sfx = ac.createGain(); sfx.gain.value = 0.9; sfx.connect(master); sfx.connect(reverb);
    musicBus = ac.createGain(); musicBus.gain.value = musicOn ? 0.22 : 0; musicBus.connect(master); musicBus.connect(reverb);
    brown = makeBrown(4);
    buildCrowd();
    startMusic();
  }

  // ------------------------------------------------------------ crowd
  function buildCrowd() {
    crowdBus = ac.createGain(); crowdBus.gain.value = 0;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    crowdBus.connect(lp); lp.connect(master); lp.connect(reverb);
    // formants of an open "ah" vowel
    const formants = [[700, 6, 1], [1150, 7, 0.6], [2600, 9, 0.25]].map(([f, q, g]) => {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gn = ac.createGain(); gn.gain.value = g;
      bp.connect(gn).connect(crowdBus);
      return bp;
    });
    for (let i = 0; i < 14; i++) {
      const o = ac.createOscillator(); o.type = 'sawtooth';
      const base = rnd(110, 260); o.frequency.value = base;
      const vib = ac.createOscillator(); vib.frequency.value = rnd(4, 6.5);
      const vg = ac.createGain(); vg.gain.value = base * 0.02; vib.connect(vg).connect(o.frequency);
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); formants.forEach(f => g.connect(f));
      o.start(); vib.start();
      voices.push({ o, g, base });
    }
    // low rumble of the stands (brown noise, not hiss)
    const src = ac.createBufferSource(); src.buffer = brown; src.loop = true;
    const lp2 = ac.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 420;
    const rg = ac.createGain(); rg.gain.value = 0.18;
    src.connect(lp2).connect(rg).connect(crowdBus); src.start();
    // babble: every voice wanders in loudness and pitch
    setInterval(() => {
      if (!ac) return;
      const t = now();
      for (const v of voices) {
        v.g.gain.setTargetAtTime(Math.random() < 0.55 ? rnd(0.01, 0.05) : 0, t, 0.12);
        v.o.frequency.setTargetAtTime(v.base * (1 + crowdLevel * 0.6) * rnd(0.94, 1.08), t, 0.2);
      }
    }, 260);
  }
  let crowdLevel = 0;

  // one-shot crowd reaction: 'cheer' (rising ahh), 'ooh' (surprised), 'boo' (low, falling)
  function react(kind, vol = 1) {
    if (!ac) return;
    const t = now();
    const cfg = { cheer: [240, 460, 1.2, 2.4, [750, 1200]], ooh: [180, 260, 1.0, 1.3, [380, 800]], boo: [120, 180, 0.75, 1.8, [330, 700]] }[kind];
    const [lo, hi, bendTo, dur, [f1, f2]] = cfg;
    const bus = ac.createGain(); bus.gain.value = 0.9 * vol;
    const b1 = ac.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = f1; b1.Q.value = 5;
    const b2 = ac.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = f2; b2.Q.value = 6;
    b1.connect(bus); b2.connect(bus); bus.connect(sfx);
    for (let i = 0; i < 12; i++) {
      const o = ac.createOscillator(); o.type = 'sawtooth';
      const f = rnd(lo, hi), st = t + rnd(0, 0.25);
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * bendTo * rnd(0.95, 1.05), st + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.05, st + 0.18);
      g.gain.setTargetAtTime(0.0001, st + dur * 0.55, dur * 0.2);
      o.connect(g); g.connect(b1); g.connect(b2);
      o.start(st); o.stop(st + dur + 0.6);
    }
  }

  // ------------------------------------------------------------ instruments
  function partial(freq, dur, vol, type = 'sine', at = 0, dest = sfx) {
    const t = now() + at;
    const o = ac.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function thump(f0, f1, dur, vol, at = 0, dest = sfx) {
    const t = now() + at;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function click(freq, dur, vol, at = 0) {   // short filtered burst for transients only
    const t = now() + at;
    const src = ac.createBufferSource(); src.buffer = brown;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(sfx); src.start(t, Math.random() * 3); src.stop(t + dur + 0.02);
  }
  function brass(freq, at, dur, vol = 0.08) {
    const t = now() + at;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(freq * 6, t + 0.06);
    lp.frequency.setTargetAtTime(freq * 3, t + 0.1, 0.2);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + dur - 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    lp.connect(g).connect(sfx);
    for (const d of [-6, 6]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d;
      const vib = ac.createOscillator(); vib.frequency.value = 5.5;
      const vg = ac.createGain(); vg.gain.value = 0; vg.gain.setValueAtTime(0, t + 0.15); vg.gain.linearRampToValueAtTime(freq * 0.008, t + 0.4);
      vib.connect(vg).connect(o.frequency);
      o.connect(lp); o.start(t); vib.start(t); o.stop(t + dur + 0.2); vib.stop(t + dur + 0.2);
    }
  }
  function lyre(freq, at, vol = 0.1, dest = musicBus) {
    const t = at;
    for (const [mult, v, d] of [[1, 1, 1.1], [2, 0.35, 0.6], [3, 0.12, 0.35]]) {
      const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = freq * mult;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
    }
  }
  function drum(at, low = true, vol = 0.5) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(low ? 110 : 190, at); o.frequency.exponentialRampToValueAtTime(low ? 55 : 120, at + 0.18);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (low ? 0.35 : 0.15));
    o.connect(g).connect(musicBus); o.start(at); o.stop(at + 0.4);
  }

  // ------------------------------------------------------------ music
  // D Phrygian dominant, the "ancient Mediterranean" scale
  const SCALE = [146.83, 155.56, 185.0, 196.0, 220.0, 233.08, 261.63, 293.66, 311.13, 369.99, 392.0, 440.0];
  const PHRASES = [
    [7, 6, 5, 4, 5, 4, 3, 2], [4, 5, 7, 5, 4, 2, 1, 0], [7, 8, 9, 8, 7, 5, 4, -1],
    [0, 2, 4, 5, 4, 2, 1, 0], [4, -1, 5, -1, 7, 6, 5, 4], [9, 8, 7, 5, 7, 5, 4, 2],
  ];
  let musicTimer = null, nextNote = 0, step = 0, phrase = PHRASES[0], intensity = 0;
  function startMusic() {
    if (musicTimer) return;
    nextNote = now() + 0.1;
    musicTimer = setInterval(() => {
      if (!ac || !musicOn) return;
      const beat = 60 / (84 + intensity * 40) / 2;   // eighth notes
      while (nextNote < now() + 0.25) {
        const s = step % 32;
        if (s % 8 === 0) phrase = PHRASES[(Math.random() * PHRASES.length) | 0];
        const n = phrase[s % 8];
        if (n >= 0 && (s % 2 === 0 || Math.random() < 0.55)) lyre(SCALE[n] * 2, nextNote, 0.075);
        if (s % 8 === 0) lyre(SCALE[0], nextNote, 0.09);
        if (s % 8 === 4) lyre(SCALE[4], nextNote, 0.06);
        if (s % 4 === 0) drum(nextNote, true, 0.45);
        if (s % 4 === 3 || (intensity > 0.5 && s % 2 === 1)) drum(nextNote, false, 0.18);
        nextNote += beat; step++;
      }
    }, 90);
  }

  return {
    init,
    get muted() { return muted; },
    get music() { return musicOn; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('crab-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, now(), 0.05);
      return muted;
    },
    toggleMusic() {
      musicOn = !musicOn;
      try { localStorage.setItem('crab-music', musicOn ? '1' : '0'); } catch (e) { /* ignore */ }
      if (musicBus) musicBus.gain.setTargetAtTime(musicOn ? 0.22 : 0, now(), 0.1);
      return musicOn;
    },
    intensity(v) { intensity = v; },
    crowd(level) {
      intensity = level;
      if (!crowdBus || Math.abs(level - crowdLevel) < 0.02) return;
      crowdLevel = level;
      crowdBus.gain.setTargetAtTime(0.18 + level * 0.9, now(), 0.3);
    },
    blip() { if (!ac) return; partial(880, 0.09, 0.05, 'triangle'); partial(1320, 0.12, 0.04, 'triangle', 0.06); },
    clang(v = 1) {
      if (!ac) return;
      const f = rnd(700, 1000);
      [[1, 0.1, 0.9], [2.76, 0.06, 0.5], [5.4, 0.04, 0.3], [8.93, 0.02, 0.18]].forEach(([m, vol, d]) => partial(f * m, d, vol * v));
      click(3500, 0.03, 0.4 * v);
    },
    hit() { if (!ac) return; thump(150, 48, 0.22, 0.7); click(900, 0.05, 0.5); },
    kill() {
      if (!ac) return;
      thump(120, 35, 0.6, 0.9);
      [[1, 0.12, 2.6], [2.4, 0.06, 1.8], [3.9, 0.03, 1.2], [5.6, 0.02, 0.8]].forEach(([m, vol, d]) => partial(98 * m, d, vol));
      react('cheer', 1.1);
    },
    roar() { react('cheer', 1.3); },
    ooh() { react('ooh', 0.7); },
    boo() { react('boo', 0.9); },
    thunder() {
      if (!ac) return;
      click(2500, 0.12, 0.9);
      const t = now();
      const src = ac.createBufferSource(); src.buffer = brown;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 2.2);
      const g = ac.createGain(); g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      src.connect(lp).connect(g).connect(sfx); src.start(t); src.stop(t + 2.5);
    },
    // crab gibberish: a few quick chirps, pitched per speaker
    chatter(seed = 0) {
      if (!ac) return;
      const base = 380 + (seed % 5) * 60;
      for (let i = 0; i < 5; i++) partial(base * rnd(0.85, 1.35), 0.07, 0.05, 'square', i * 0.07);
    },
    drumroll() { if (!ac) return; for (let i = 0; i < 10; i++) drum(now() + i * 0.06, i % 2 === 0, 0.25 + i * 0.03); },
    fanfare(victory) {
      if (!ac) return;
      const notes = victory
        ? [[293.66, 0, 0.18], [369.99, 0.18, 0.18], [440, 0.36, 0.18], [587.33, 0.54, 0.5], [440, 1.1, 0.16], [587.33, 1.26, 0.9]]
        : [[293.66, 0, 0.16], [293.66, 0.18, 0.12], [440, 0.32, 0.5]];
      for (const [f, at, d] of notes) { brass(f, at, d); brass(f / 2, at, d, 0.05); }
      if (victory) setTimeout(() => react('cheer', 1.4), 500);
    },
  };
})();
window.Sound = Sound;
