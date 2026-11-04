#!/usr/bin/env node
/**
 * Synthesizes the focus timer's sounds and encodes them as Ogg/Opus into
 * web/src/modules/focus/sounds/. Fully deterministic (seeded PRNG), so re-running it
 * reproduces the same audio. The output is original work, released under CC0 1.0.
 *
 *   node scripts/generate-sounds.mjs        (requires ffmpeg with libopus on PATH)
 *
 * Loops (`ticking` sounds) are built to be periodic: tick events sit inside the loop with
 * silence at the edges, and noise layers are circularly cross-faded so end → start is seamless.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48_000;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src', 'modules', 'focus', 'sounds');

// ------------------------------------------------------------------ primitives

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seconds = (s) => Math.round(s * SR);

function biquad(type, f0, q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * f0) / SR;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === 'highpass') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha]; // bandpass, 0 dB peak
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return (x) => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
}

function whiteNoise(n, rand) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  return out;
}

/** Paul Kellet's economical pink-noise filter. */
function pinkNoise(n, rand) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

function brownNoise(n, rand) {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

function mixInto(target, source, gain = 1, offset = 0) {
  for (let i = 0; i < source.length; i++) {
    const j = offset + i;
    if (j >= 0 && j < target.length) target[j] += source[i] * gain;
  }
}

/** Add `source` at `offset`, wrapping around the end (for loops). */
function mixCircular(target, source, gain, offset) {
  const n = target.length;
  for (let i = 0; i < source.length; i++) target[(((offset + i) % n) + n) % n] += source[i] * gain;
}

/**
 * Make a seamless loop of length n from a signal of length n + fade: the tail that follows the
 * loop's end is cross-faded (equal power) into its head, so end → start continues smoothly.
 */
function circularCrossfade(x, n) {
  const fade = x.length - n;
  const out = x.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = x[i] * Math.sin((t * Math.PI) / 2) + x[n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function peak(x) {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

function rms(x) {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
}

const db = (d) => 10 ** (d / 20);

function scale(x, gain) {
  for (let i = 0; i < x.length; i++) x[i] *= gain;
  return x;
}

function softLimit(x, ceiling) {
  for (let i = 0; i < x.length; i++) x[i] = ceiling * Math.tanh(x[i] / ceiling);
  return x;
}

function fadeOut(x, durationS) {
  const n = Math.min(x.length, seconds(durationS));
  for (let i = 0; i < n; i++) x[x.length - n + i] *= 1 - i / n;
  return x;
}

/** Sum of exponentially decaying sine modes (`t60` = time to fall 60 dB). */
function modes(durationS, list, { attackS = 0.0015, rand } = {}) {
  const n = seconds(durationS);
  const out = new Float32Array(n);
  const attack = Math.max(1, seconds(attackS));
  for (const { f, amp, t60, glide = 0 } of list) {
    const k = 6.907755 / (t60 * SR);
    const phase0 = rand ? rand() * 2 * Math.PI : 0;
    let phase = phase0;
    for (let i = 0; i < n; i++) {
      const env = Math.exp(-k * i) * Math.min(1, i / attack);
      if (env < 1e-5 && i > attack) break;
      const fi = f * (1 + glide * (i / n));
      phase += (2 * Math.PI * fi) / SR;
      out[i] += amp * env * Math.sin(phase);
    }
  }
  return out;
}

// ------------------------------------------------------------------ sounds

/** 2 s loop: a "tick" and a slightly lower "tock", each with a faint escapement after-click. */
function clockTick() {
  const rand = mulberry32(7);
  const out = new Float32Array(seconds(2));
  const strike = (at, base, gain) => {
    const body = modes(0.08, [
      { f: base, amp: 1, t60: 0.03 },
      { f: base * 1.52, amp: 0.6, t60: 0.02 },
      { f: base * 2.23, amp: 0.35, t60: 0.012 },
      { f: 210, amp: 0.45, t60: 0.05 },
    ], { attackS: 0.0004, rand });
    const click = biquad('highpass', 2500)(whiteNoise(seconds(0.003), rand));
    mixInto(out, body, gain, seconds(at));
    mixInto(out, click, gain * 0.5, seconds(at));
    mixInto(out, body, gain * 0.22, seconds(at + 0.014));
  };
  strike(0.25, 3100, 1);
  strike(1.25, 2650, 0.9);
  return scale(out, db(-9) / peak(out));
}

/** 24 s loop: rain hiss, body and rumble, plus many small droplets and occasional leaf drips. */
function rainforestRain() {
  const rand = mulberry32(42);
  const n = seconds(24);
  const fade = seconds(1.5);
  const total = n + fade;
  const t = (i) => i / SR;

  const hiss = biquad('lowpass', 7500)(biquad('highpass', 450)(whiteNoise(total, rand)));
  const body = biquad('lowpass', 1400)(biquad('highpass', 120)(pinkNoise(total, rand)));
  const rumble = biquad('lowpass', 160)(brownNoise(total, rand));
  const bed = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    // Slow swells whose periods divide the loop length, so they are periodic too.
    const swell = 1 + 0.18 * Math.sin((2 * Math.PI * t(i)) / 24) + 0.08 * Math.sin((2 * Math.PI * 3 * t(i)) / 24 + 1.3);
    bed[i] = swell * (0.55 * hiss[i] + 0.8 * body[i]) + 0.6 * rumble[i];
  }
  const out = circularCrossfade(bed, n);
  scale(out, db(-27) / rms(out));

  const drops = (count, fMin, fMax, t60Min, t60Max, gainMin, gainMax) => {
    for (let k = 0; k < count; k++) {
      const f = fMin * (fMax / fMin) ** rand();
      const t60 = t60Min + (t60Max - t60Min) * rand();
      const drop = modes(t60 * 1.2, [
        { f, amp: 1, t60, glide: 0.35 },
        { f: f * 1.9, amp: 0.25, t60: t60 * 0.6, glide: 0.35 },
      ], { attackS: 0.0005, rand });
      const gain = gainMin * (gainMax / gainMin) ** (rand() ** 2.5);
      mixCircular(out, drop, gain, Math.floor(rand() * n));
    }
  };
  drops(24 * 45, 1800, 6500, 0.004, 0.014, db(-40), db(-24));
  drops(24 * 3, 700, 1800, 0.02, 0.05, db(-30), db(-18));
  return softLimit(out, db(-3));
}

/** Inharmonic bell partials (ratio, amplitude, T60 in s), loosely after a hand bell. */
const BELL = [
  [0.5, 0.35, 3.6], [1, 1, 3], [1.19, 0.5, 2.3], [1.5, 0.4, 1.9], [2, 0.6, 1.7],
  [2.52, 0.3, 1.1], [2.66, 0.25, 0.95], [3.01, 0.2, 0.75], [4.17, 0.12, 0.5], [5.43, 0.07, 0.35],
];

function bellStrike(base, rand, durationS) {
  const list = [];
  for (const [ratio, amp, t60] of BELL) {
    // Two slightly detuned copies per partial give the characteristic slow beating.
    list.push({ f: base * ratio * 0.9996, amp: amp * 0.5, t60 });
    list.push({ f: base * ratio * 1.0004, amp: amp * 0.5, t60 });
  }
  const tone = modes(durationS, list, { attackS: 0.005, rand });
  const knock = biquad('lowpass', base * 4)(biquad('bandpass', base * 3, 2)(whiteNoise(seconds(0.012), rand)));
  mixInto(tone, knock, 0.2);
  return tone;
}

function bellSingle() {
  const rand = mulberry32(11);
  const out = bellStrike(523.25, rand, 4.5);
  return fadeOut(scale(out, db(-5) / peak(out)), 0.5);
}

function bellTriple() {
  const rand = mulberry32(12);
  const out = new Float32Array(seconds(4.5));
  for (const [i, at] of [0, 0.42, 0.84].entries()) {
    mixInto(out, bellStrike(783.99, rand, 4.5 - at), i === 2 ? 1 : 0.85, seconds(at));
  }
  return fadeOut(scale(out, db(-5) / peak(out)), 0.5);
}

function chimeSoft() {
  const rand = mulberry32(13);
  const out = new Float32Array(seconds(4.5));
  for (const [i, f] of [1046.5, 1318.51, 1567.98].entries()) {
    const chime = modes(4.5, [
      { f, amp: 1, t60: 3 },
      { f: f * 2.756, amp: 0.4, t60: 1.5 },
      { f: f * 5.404, amp: 0.15, t60: 0.7 },
      { f: f * 8.933, amp: 0.05, t60: 0.35 },
    ], { attackS: 0.008, rand });
    mixInto(out, chime, 1, seconds(i * 0.22));
  }
  return fadeOut(scale(out, db(-8) / peak(out)), 0.5);
}

// ------------------------------------------------------------------ output

function encode(name, samples, bitrate) {
  const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const out = join(OUT_DIR, `${name}.ogg`);
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0',
      '-c:a', 'libopus', '-b:a', bitrate, '-application', 'audio', '-map_metadata', '-1', '-fflags', '+bitexact', out],
    { input: pcm },
  );
  console.log(`${name}.ogg  ${(samples.length / SR).toFixed(2)} s`);
}

mkdirSync(OUT_DIR, { recursive: true });
encode('clock-tick', clockTick(), '32k');
encode('rainforest-rain', rainforestRain(), '48k');
encode('bell-single', bellSingle(), '40k');
encode('bell-triple', bellTriple(), '40k');
encode('chime-soft', chimeSoft(), '40k');
