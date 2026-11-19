/**
 * Synthesized cues (J22, D167). No samples. Client code calls `play`. The kit does not.
 * One voice, each cue under 450 ms. The same cue inside 180 ms is dropped. Reduced motion
 * and a hidden tab stay silent without changing the stored mute.
 */

export const SOUND_KEY = 'jobhacker.sound';
/** Loud enough to hear on the laptop speakers. The cues are still under half a second. */
export const MASTER_GAIN = 0.45;
export const REPEAT_MS = 180;
export const MAX_CUE_MS = 450;
const FLOOR = 0.0001;

export interface CueDef {
  durationMs: number;
  /** Peak into the master gain, 0–1. */
  gain: number;
  /** Tones this cue is built from. A glide is from, then to. Empty for noise only. */
  hz: readonly number[];
}

export const CUES = {
  shortlist: { durationMs: 110, gain: 0.85, hz: [2600, 5200] },
  skip: { durationMs: 90, gain: 0.4, hz: [420, 160] },
  archive: { durationMs: 100, gain: 0.35, hz: [110] },
  undo: { durationMs: 80, gain: 0.5, hz: [1800, 2600] },
  palette: { durationMs: 70, gain: 0.65, hz: [1100, 1700] },
  error: { durationMs: 150, gain: 0.3, hz: [] },
  'scout-start': { durationMs: 340, gain: 0.35, hz: [2100, 1800] },
  'scout-done': { durationMs: 160, gain: 0.8, hz: [2600, 5200] },
  'score-done': { durationMs: 80, gain: 0.65, hz: [1500, 1700] },
  submitted: { durationMs: 200, gain: 0.9, hz: [2600, 5200] },
} as const satisfies Record<string, CueDef>;

export type Cue = keyof typeof CUES;

export interface SoundStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Missing, `on`, or anything other than `off` is on. */
export function readChoice(raw: string | null): boolean {
  return raw !== 'off';
}

export function readStored(store: SoundStore): boolean {
  try {
    return readChoice(store.get(SOUND_KEY));
  } catch {
    return true;
  }
}

/** Flips the stored choice and returns whether sound is now on. */
export function writeToggle(store: SoundStore): boolean {
  const next = !readStored(store);
  try {
    store.set(SOUND_KEY, next ? 'on' : 'off');
  } catch {
    return readStored(store);
  }
  return next;
}

function browserStore(): SoundStore | null {
  if (typeof localStorage === 'undefined') return null;
  return {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
  };
}

/** The stored choice. Reduced motion does not change it. Default on. */
export function soundEnabled(): boolean {
  const store = browserStore();
  return store ? readStored(store) : true;
}

export function toggleMuted(): boolean {
  const store = browserStore();
  if (!store) return true;
  return writeToggle(store);
}

export interface GateEnv {
  enabled: boolean;
  reducedMotion: boolean;
  hidden: boolean;
}

export interface GateState {
  cue: Cue | null;
  at: number;
}

export function admit(cue: Cue, now: number, state: GateState, env: GateEnv): boolean {
  if (!env.enabled || env.reducedMotion || env.hidden) return false;
  if (state.cue === cue && now - state.at < REPEAT_MS) return false;
  const spec = CUES[cue];
  return spec.durationMs > 0 && spec.durationMs <= MAX_CUE_MS && spec.gain > 0 && spec.gain <= 1;
}

export interface AudioParamLike {
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
  cancelScheduledValues(time: number): void;
}

export interface SourceLike {
  connect(dest: object): void;
  start(when?: number): void;
  stop(when?: number): void;
  disconnect(): void;
}

export interface OscLike extends SourceLike {
  type: OscillatorType;
  frequency: AudioParamLike;
}

export interface GainLike {
  gain: AudioParamLike;
  connect(dest: object): void;
  disconnect(): void;
}

export interface BufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends SourceLike {
  buffer: BufferLike | null;
}

export interface ShaperLike {
  curve: Float32Array | null;
  connect(dest: object): void;
  disconnect(): void;
}

export interface FilterLike {
  type: BiquadFilterType;
  frequency: AudioParamLike;
  Q: AudioParamLike;
  connect(dest: object): void;
  disconnect(): void;
}

/** The slice of an AudioContext the cues use. Tests pass a fake. */
export interface AudioGraph {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: object;
  createOscillator(): OscLike;
  createGain(): GainLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): BufferSourceLike;
  createWaveShaper(): ShaperLike;
  createBiquadFilter(): FilterLike;
}

interface Voice {
  stop(at: number): void;
}

export interface Player {
  play(cue: Cue): boolean;
  cut(): void;
}

export interface PlayerDeps {
  now(): number;
  env(): GateEnv;
  graph(): AudioGraph | null;
}

function hzAt(spec: CueDef, index: number): number {
  const value = spec.hz[index];
  if (value === undefined) throw new Error('sfx: cue is missing a frequency');
  return value;
}

function envGain(graph: AudioGraph, peak: number, t0: number, dur: number): GainLike {
  const gain = graph.createGain();
  const level = Math.max(peak, FLOOR);
  // Hold the peak. A ramp that runs the whole cue drops to silence within a few
  // milliseconds, so a 110 ms whistle is a click.
  const attack = Math.min(0.012, dur * 0.2);
  const release = Math.min(0.04, dur * 0.28);
  const hold = Math.max(attack, dur - release);
  gain.gain.setValueAtTime(FLOOR, t0);
  gain.gain.exponentialRampToValueAtTime(level, t0 + attack);
  gain.gain.setValueAtTime(level, t0 + hold);
  gain.gain.exponentialRampToValueAtTime(FLOOR, t0 + dur);
  return gain;
}

function chopGain(
  graph: AudioGraph,
  peak: number,
  t0: number,
  dur: number,
  bursts: number,
): GainLike {
  const gain = graph.createGain();
  const slice = dur / (bursts * 2);
  for (let i = 0; i < bursts; i++) {
    gain.gain.setValueAtTime(peak, t0 + slice * (i * 2));
    gain.gain.setValueAtTime(FLOOR, t0 + slice * (i * 2 + 1));
  }
  return gain;
}

let clipCurve: Float32Array | null = null;
function softClip(): Float32Array {
  if (clipCurve) return clipCurve;
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.5);
  }
  clipCurve = curve;
  return curve;
}

function noise(graph: AudioGraph, dur: number): BufferSourceLike {
  const length = Math.max(1, Math.floor(graph.sampleRate * dur));
  const buffer = graph.createBuffer(1, length, graph.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = graph.createBufferSource();
  src.buffer = buffer;
  return src;
}

function silence(gain: GainLike, sources: SourceLike[], natural: number): Voice {
  let cut = false;
  return {
    stop(at: number) {
      if (cut || at >= natural - 0.001) return;
      cut = true;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(FLOOR, at);
      gain.disconnect();
      for (const source of sources) source.disconnect();
    },
  };
}

function bundle(parts: Voice[]): Voice {
  return {
    stop(at: number) {
      for (const part of parts) part.stop(at);
    },
  };
}

function tone(
  graph: AudioGraph,
  out: GainLike,
  t0: number,
  dur: number,
  peak: number,
  fromHz: number,
  toHz: number | null,
  type: OscillatorType,
  harmonicHz: number | null,
): Voice {
  const gain = envGain(graph, peak, t0, dur);
  gain.connect(out);
  const osc = graph.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, t0);
  if (toHz !== null) osc.frequency.linearRampToValueAtTime(toHz, t0 + dur);
  osc.connect(gain);
  const sources: SourceLike[] = [osc];
  if (harmonicHz !== null) {
    const harm = graph.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(harmonicHz, t0);
    const mix = graph.createGain();
    mix.gain.setValueAtTime(0.12, t0);
    harm.connect(mix);
    mix.connect(gain);
    sources.push(harm);
  }
  for (const source of sources) {
    source.start(t0);
    source.stop(t0 + dur);
  }
  return silence(gain, sources, t0 + dur);
}

function grit(
  graph: AudioGraph,
  out: GainLike,
  t0: number,
  dur: number,
  peak: number,
  fromHz: number,
  toHz: number,
): Voice {
  const gain = envGain(graph, peak, t0, dur);
  const shape = graph.createWaveShaper();
  shape.curve = softClip();
  const osc = graph.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(fromHz, t0);
  osc.frequency.linearRampToValueAtTime(toHz, t0 + dur);
  osc.connect(shape);
  shape.connect(gain);
  gain.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur);
  return silence(gain, [osc], t0 + dur);
}

function burst(
  graph: AudioGraph,
  out: GainLike,
  t0: number,
  dur: number,
  peak: number,
  chops: number | null,
  filterHz: number | null,
): Voice {
  const gain =
    chops === null ? envGain(graph, peak, t0, dur) : chopGain(graph, peak, t0, dur, chops);
  const shape = graph.createWaveShaper();
  shape.curve = softClip();
  const src = noise(graph, dur);
  src.connect(shape);
  let into: { connect(dest: object): void } = shape;
  if (filterHz !== null) {
    const filter = graph.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterHz, t0);
    filter.Q.setValueAtTime(0.7, t0);
    shape.connect(filter);
    into = filter;
  }
  into.connect(gain);
  gain.connect(out);
  src.start(t0);
  src.stop(t0 + dur);
  return silence(gain, [src], t0 + dur);
}

function render(graph: AudioGraph, out: GainLike, cue: Cue, t0: number): Voice {
  const spec = CUES[cue];
  const dur = spec.durationMs / 1000;
  const peak = spec.gain;
  switch (cue) {
    case 'shortlist':
    case 'scout-done':
    case 'submitted':
      return tone(graph, out, t0, dur, peak, hzAt(spec, 0), null, 'sine', hzAt(spec, 1));
    case 'undo':
      return tone(graph, out, t0, dur, peak, hzAt(spec, 0), hzAt(spec, 1), 'sine', null);
    case 'palette':
    case 'score-done':
      return pair(graph, out, t0, dur, peak, hzAt(spec, 0), hzAt(spec, 1));
    case 'skip':
      return grit(graph, out, t0, dur, peak, hzAt(spec, 0), hzAt(spec, 1));
    case 'archive':
      return bundle([
        tone(graph, out, t0, dur, peak, hzAt(spec, 0), null, 'sine', null),
        burst(graph, out, t0, dur, peak * 0.6, 2, null),
      ]);
    case 'error':
      return burst(graph, out, t0, dur, peak, 3, null);
    case 'scout-start': {
      const toneS = 0.16;
      const rest = dur - toneS;
      return bundle([
        tone(graph, out, t0, toneS, peak, hzAt(spec, 0), null, 'sine', null),
        burst(graph, out, t0 + toneS, rest, peak * 0.75, null, hzAt(spec, 1)),
      ]);
    }
    default: {
      const never: never = cue;
      return never;
    }
  }
}

function pair(
  graph: AudioGraph,
  out: GainLike,
  t0: number,
  dur: number,
  peak: number,
  a: number,
  b: number,
): Voice {
  const gain = envGain(graph, peak, t0, dur);
  gain.connect(out);
  const sources: SourceLike[] = [];
  for (const hz of [a, b]) {
    const osc = graph.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, t0);
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + dur);
    sources.push(osc);
  }
  return silence(gain, sources, t0 + dur);
}

export function createPlayer(deps: PlayerDeps): Player {
  let last: GateState = { cue: null, at: Number.NEGATIVE_INFINITY };
  let voice: Voice | null = null;
  let master: GainLike | null = null;
  let bound: AudioGraph | null = null;

  return {
    play(cue: Cue): boolean {
      const now = deps.now();
      if (!admit(cue, now, last, deps.env())) return false;
      const graph = deps.graph();
      if (!graph) return false;
      if (bound !== graph || !master) {
        master = graph.createGain();
        master.gain.setValueAtTime(MASTER_GAIN, graph.currentTime);
        master.connect(graph.destination);
        bound = graph;
      }
      voice?.stop(graph.currentTime);
      voice = render(graph, master, cue, graph.currentTime);
      last = { cue, at: now };
      return true;
    },
    cut(): void {
      if (!bound || !voice) return;
      voice.stop(bound.currentTime);
      voice = null;
    },
  };
}

function reducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function tabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function readEnv(): GateEnv {
  return { enabled: soundEnabled(), reducedMotion: reducedMotion(), hidden: tabHidden() };
}

const nodes = new WeakMap<object, AudioNode>();

function link(from: AudioNode, dest: object, destination: AudioDestinationNode): void {
  if (dest === destination) {
    from.connect(destination);
    return;
  }
  const target = nodes.get(dest);
  if (!target) throw new Error('sfx: cannot connect to that node');
  from.connect(target);
}

function asGraph(ctx: AudioContext): AudioGraph {
  const destination = ctx.destination;
  return {
    get currentTime() {
      // Start a little ahead of the clock so the attack is not already over.
      return ctx.currentTime + 0.03;
    },
    get sampleRate() {
      return ctx.sampleRate;
    },
    destination,
    createOscillator() {
      const node = ctx.createOscillator();
      const wrapped: OscLike = {
        get type() {
          return node.type;
        },
        set type(value: OscillatorType) {
          node.type = value;
        },
        frequency: node.frequency,
        connect(dest) {
          link(node, dest, destination);
        },
        start(when) {
          node.start(when);
        },
        stop(when) {
          node.stop(when);
        },
        disconnect() {
          node.disconnect();
        },
      };
      nodes.set(wrapped, node);
      return wrapped;
    },
    createGain() {
      const node = ctx.createGain();
      const wrapped: GainLike = {
        gain: node.gain,
        connect(dest) {
          link(node, dest, destination);
        },
        disconnect() {
          node.disconnect();
        },
      };
      nodes.set(wrapped, node);
      return wrapped;
    },
    createBuffer(channels, length, sampleRate) {
      return ctx.createBuffer(channels, length, sampleRate);
    },
    createBufferSource() {
      const node = ctx.createBufferSource();
      const wrapped: BufferSourceLike = {
        get buffer() {
          return node.buffer;
        },
        set buffer(value: BufferLike | null) {
          node.buffer = value as AudioBuffer | null;
        },
        connect(dest) {
          link(node, dest, destination);
        },
        start(when) {
          node.start(when);
        },
        stop(when) {
          node.stop(when);
        },
        disconnect() {
          node.disconnect();
        },
      };
      nodes.set(wrapped, node);
      return wrapped;
    },
    createWaveShaper() {
      const node = ctx.createWaveShaper();
      const wrapped: ShaperLike = {
        get curve() {
          return node.curve;
        },
        set curve(value: Float32Array | null) {
          if (!value) {
            node.curve = null;
            return;
          }
          const copy = new Float32Array(value.length);
          copy.set(value);
          node.curve = copy;
        },
        connect(dest) {
          link(node, dest, destination);
        },
        disconnect() {
          node.disconnect();
        },
      };
      nodes.set(wrapped, node);
      return wrapped;
    },
    createBiquadFilter() {
      const node = ctx.createBiquadFilter();
      const wrapped: FilterLike = {
        get type() {
          return node.type;
        },
        set type(value: BiquadFilterType) {
          node.type = value;
        },
        frequency: node.frequency,
        Q: node.Q,
        connect(dest) {
          link(node, dest, destination);
        },
        disconnect() {
          node.disconnect();
        },
      };
      nodes.set(wrapped, node);
      return wrapped;
    },
  };
}

let ctx: AudioContext | null = null;
let graph: AudioGraph | null = null;

function liveAudio(): { ctx: AudioContext; graph: AudioGraph } | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  if (!ctx || !graph) {
    ctx = new window.AudioContext();
    graph = asGraph(ctx);
  }
  return { ctx, graph };
}

const engine = createPlayer({
  now: () => performance.now(),
  env: readEnv,
  graph: acquireGraph,
});

function acquireGraph(): AudioGraph | null {
  const live = liveAudio();
  if (!live || live.ctx.state !== 'running') return null;
  return live.graph;
}

let arming = false;

export function play(cue: Cue): void {
  // Mute, reduced motion and a hidden tab schedule nothing, and they do not start the clock.
  if (!soundEnabled() || reducedMotion() || tabHidden()) return;
  const live = liveAudio();
  if (!live) return;
  const run = () => {
    if (live.ctx.state !== 'running') return;
    // A throw here must not cancel the key that asked for the cue. The cue is dropped.
    try {
      engine.play(cue);
    } catch {
      /* the graph refused this cue */
    }
  };
  if (live.ctx.state === 'running') {
    run();
    return;
  }
  // resume() has to start in the click or key that asked for the cue.
  // The note is scheduled only after the clock is actually running.
  // A second cue that arrives while that is still happening is dropped, not queued.
  if (arming) return;
  arming = true;
  void live.ctx
    .resume()
    .then(() => {
      arming = false;
      run();
    })
    .catch(() => {
      arming = false;
    });
}
