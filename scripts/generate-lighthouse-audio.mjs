import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 22050;

export const COMPOSITIONS = {
  'town-day': {
    title: '水巷晨光', scene: '灯塔镇日常', seconds: 72, bpm: 78, seed: 1107,
    palette: 'jiangnan-warm',
    description: '温暖江南五声音阶、竹笛般主旋律、古筝点奏、轻木打击与柔和水乡空气感。',
  },
  'werewolf-night': {
    title: '灯影入夜', scene: '狼人杀夜晚', seconds: 64, bpm: 62, seed: 2201,
    palette: 'qin-night',
    description: '克制低鼓、古琴泛音、稀疏木质敲击与低风声，不含惊吓或暴力声音。',
  },
  'werewolf-discussion': {
    title: '围桌辨言', scene: '狼人杀白天讨论', seconds: 68, bpm: 84, seed: 3301,
    palette: 'wood-dialogue',
    description: '轻拨弦、木质节奏与低存在感和声，给推理留出语言空间。',
  },
  'werewolf-vote': {
    title: '落签之前', scene: '狼人杀投票', seconds: 48, bpm: 96, seed: 4409,
    palette: 'tense-vote',
    description: '逐渐清晰的低鼓与拨弦脉冲，紧张但不恐怖。',
  },
  'werewolf-result': {
    title: '灯火归席', scene: '狼人杀结算', seconds: 24, bpm: 76, seed: 5519,
    palette: 'bright-resolution',
    description: '木槌提示后以明亮五声音阶和弦收束，适合回到小镇生活。',
  },
};

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function addTone(samples, start, duration, frequency, gain, options = {}) {
  const startIndex = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const length = Math.min(samples.length - startIndex, Math.floor(duration * SAMPLE_RATE));
  const attack = options.attack ?? 0.025;
  const release = options.release ?? Math.min(0.8, duration * 0.5);
  const harmonic = options.harmonic ?? 0.22;
  const decay = options.decay ?? 2.4;
  const tremolo = options.tremolo ?? 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const remaining = duration - time;
    const envelope = Math.min(1, time / attack, remaining / release) * Math.exp(-time / decay);
    const modulation = tremolo ? 0.84 + Math.sin(Math.PI * 2 * tremolo * time) * 0.16 : 1;
    const phase = Math.PI * 2 * frequency * time;
    samples[startIndex + index] += gain * envelope * modulation *
      (Math.sin(phase) + harmonic * Math.sin(phase * 2.01) + harmonic * 0.35 * Math.sin(phase * 3.98));
  }
}

function addWood(samples, start, gain, random, low = false) {
  const startIndex = Math.floor(start * SAMPLE_RATE);
  const length = Math.min(samples.length - startIndex, Math.floor((low ? 0.28 : 0.12) * SAMPLE_RATE));
  let filtered = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    filtered += (noise - filtered) * (low ? 0.055 : 0.18);
    const body = Math.sin(Math.PI * 2 * (low ? 78 : 310) * time) * 0.55;
    samples[startIndex + index] += (filtered + body) * gain * Math.exp(-time * (low ? 13 : 35));
  }
}

function addAir(samples, random, gain, brightness) {
  let low = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const noise = random() * 2 - 1;
    low += (noise - low) * brightness;
    samples[index] += low * gain;
  }
}

function addDrone(samples, frequencies, gain, movement = 0.04) {
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / SAMPLE_RATE;
    let value = 0;
    for (let tone = 0; tone < frequencies.length; tone += 1) {
      value += Math.sin(Math.PI * 2 * frequencies[tone] * time + tone * 0.7) / frequencies.length;
    }
    const breath = 0.72 + 0.28 * Math.sin(Math.PI * 2 * movement * time);
    samples[index] += value * gain * breath;
  }
}

function addBird(samples, start, gain) {
  const startIndex = Math.floor(start * SAMPLE_RATE);
  const length = Math.min(samples.length - startIndex, Math.floor(0.7 * SAMPLE_RATE));
  let phase = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const frequency = 1150 + 520 * Math.sin(Math.PI * time / 0.7);
    phase += Math.PI * 2 * frequency / SAMPLE_RATE;
    samples[startIndex + index] += Math.sin(phase) * gain * Math.sin(Math.PI * time / 0.7) ** 2;
  }
}

function composeTown(samples, config, random) {
  addDrone(samples, [146.83, 220], 0.035, 0.025);
  addAir(samples, random, 0.018, 0.008);
  const scale = [293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];
  const melody = [0, 2, 4, 2, 1, 3, 5, 4, 2, 0, 1, 2, 4, 3, 2, 1];
  const beat = 60 / config.bpm;
  for (let bar = 0; bar * beat * 4 < config.seconds; bar += 1) {
    const base = bar * beat * 4;
    const note = melody[bar % melody.length];
    addTone(samples, base, beat * 2.8, scale[note], 0.12, { harmonic: 0.16, decay: 2.7 });
    addTone(samples, base + beat * 2, beat * 1.6, scale[(note + 2) % scale.length] / 2, 0.07);
    addWood(samples, base, 0.07, random);
    if (bar % 4 === 2) addBird(samples, base + beat * 2.7, 0.018);
  }
}

function composeNight(samples, config, random) {
  addDrone(samples, [73.42, 110, 146.83], 0.075, 0.018);
  addAir(samples, random, 0.03, 0.0035);
  const beat = 60 / config.bpm;
  const notes = [146.83, 174.61, 220, 261.63, 220, 174.61];
  for (let bar = 0; bar * beat * 4 < config.seconds; bar += 1) {
    const base = bar * beat * 4;
    addWood(samples, base, 0.16, random, true);
    if (bar % 2 === 0) {
      addTone(samples, base + beat * 1.5, beat * 3, notes[bar % notes.length], 0.095, {
        attack: 0.01, release: 1.2, harmonic: 0.42, decay: 1.7,
      });
    }
  }
}

function composeDiscussion(samples, config, random) {
  addDrone(samples, [130.81, 196], 0.028, 0.035);
  addAir(samples, random, 0.012, 0.014);
  const beat = 60 / config.bpm;
  const pattern = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 392];
  for (let step = 0; step * beat < config.seconds; step += 1) {
    const start = step * beat;
    addTone(samples, start, beat * 0.78, pattern[step % pattern.length], 0.065, {
      release: 0.22, harmonic: 0.18, decay: 0.65,
    });
    if (step % 2 === 0) addWood(samples, start, 0.045, random);
  }
}

function composeVote(samples, config, random) {
  addDrone(samples, [82.41, 123.47], 0.055, 0.045);
  addAir(samples, random, 0.014, 0.007);
  const beat = 60 / config.bpm;
  const pulse = [220, 261.63, 293.66, 329.63];
  for (let step = 0; step * beat < config.seconds; step += 1) {
    const start = step * beat;
    addWood(samples, start, step % 4 === 0 ? 0.2 : 0.09, random, step % 4 === 0);
    addTone(samples, start + beat * 0.5, beat * 0.4, pulse[step % pulse.length], 0.07, {
      attack: 0.005, release: 0.12, harmonic: 0.32, decay: 0.38,
    });
  }
}

function composeResult(samples, config, random) {
  addDrone(samples, [146.83, 220, 293.66], 0.045, 0.06);
  addAir(samples, random, 0.01, 0.012);
  const beat = 60 / config.bpm;
  const arpeggio = [293.66, 392, 440, 587.33, 659.25, 587.33, 440, 392];
  addWood(samples, 0, 0.18, random);
  for (let step = 0; step * beat < config.seconds; step += 1) {
    addTone(samples, step * beat, beat * 1.7, arpeggio[step % arpeggio.length], 0.105, {
      release: 0.7, harmonic: 0.2, decay: 1.9,
    });
  }
}

function makeLoopSafe(samples) {
  const fadeSamples = Math.min(samples.length >> 1, Math.floor(SAMPLE_RATE * 0.25));
  for (let index = 0; index < fadeSamples; index += 1) {
    const progress = index / fadeSamples;
    const fadeIn = Math.sin(progress * Math.PI / 2) ** 2;
    const fadeOut = Math.cos(progress * Math.PI / 2) ** 2;
    const start = samples[index];
    const endIndex = samples.length - fadeSamples + index;
    const end = samples[endIndex];
    const mixed = start * fadeIn + end * fadeOut;
    samples[index] = mixed;
    samples[endIndex] = mixed;
  }
}

export function renderComposition(id) {
  const config = COMPOSITIONS[id];
  if (!config) throw new Error(`Unknown composition: ${id}`);
  const samples = new Float32Array(Math.floor(config.seconds * SAMPLE_RATE));
  const random = seededRandom(config.seed);
  if (id === 'town-day') composeTown(samples, config, random);
  else if (id === 'werewolf-night') composeNight(samples, config, random);
  else if (id === 'werewolf-discussion') composeDiscussion(samples, config, random);
  else if (id === 'werewolf-vote') composeVote(samples, config, random);
  else composeResult(samples, config, random);
  makeLoopSafe(samples);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const normalization = peak > 0 ? Math.min(1, 0.82 / peak) : 1;
  if (normalization !== 1) {
    for (let index = 0; index < samples.length; index += 1) samples[index] *= normalization;
    peak *= normalization;
  }
  return { samples, peak, config };
}

export function encodeWav(samples) {
  const dataSize = samples.length * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write('WAVE', 8);
  output.write('fmt ', 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const bounded = Math.max(-1, Math.min(1, samples[index]));
    output.writeInt16LE(Math.round(bounded * 32767), 44 + index * 2);
  }
  return output;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = join(scriptDir, '..', 'public', 'assets', 'audio', 'lighthouse-town');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateGenerated() {
  const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
  for (const track of manifest.tracks) {
    const bytes = readFileSync(join(outputDir, `${track.id}.wav`));
    if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') {
      throw new Error(`${track.id}: invalid WAV header`);
    }
    const seconds = bytes.readUInt32LE(40) / (SAMPLE_RATE * 2);
    if (Math.abs(seconds - track.seconds) > 0.02) throw new Error(`${track.id}: duration mismatch`);
    if (sha256(bytes) !== track.sha256) throw new Error(`${track.id}: hash mismatch`);
    process.stdout.write(`${track.id}: valid (${seconds.toFixed(1)}s)\n`);
  }
}

function generateAll() {
  mkdirSync(outputDir, { recursive: true });
  const tracks = [];
  for (const id of Object.keys(COMPOSITIONS)) {
    const { samples, peak, config } = renderComposition(id);
    const bytes = encodeWav(samples);
    writeFileSync(join(outputDir, `${id}.wav`), bytes);
    tracks.push({
      id,
      title: config.title,
      scene: config.scene,
      seconds: config.seconds,
      sampleRate: SAMPLE_RATE,
      loopSafe: true,
      peak: Number(peak.toFixed(4)),
      sha256: sha256(bytes),
      generationDescription: config.description,
      license: 'Original project-generated audio; MIT project distribution',
    });
    process.stdout.write(`${id}: generated (${config.seconds}s, peak ${peak.toFixed(3)})\n`);
  }
  writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify({ version: 1, tracks }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--validate')) validateGenerated();
  else generateAll();
}
