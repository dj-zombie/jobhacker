import { describe, expect, it } from 'vitest';
import {
  type AudioGraph,
  type AudioParamLike,
  type BufferLike,
  type BufferSourceLike,
  CUES,
  type Cue,
  type FilterLike,
  type GainLike,
  MASTER_GAIN,
  MAX_CUE_MS,
  type OscLike,
  REPEAT_MS,
  SOUND_KEY,
  type ShaperLike,
  type SoundStore,
  createPlayer,
  readChoice,
  readStored,
  writeToggle,
} from './sfx.js';

class Param implements AudioParamLike {
  sets: { v: number; t: number }[] = [];
  linear: { v: number; t: number }[] = [];
  exponential: { v: number; t: number }[] = [];
  setValueAtTime(v: number, t: number): void {
    this.sets.push({ v, t });
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.linear.push({ v, t });
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.exponential.push({ v, t });
  }
  cancelScheduledValues(): void {
    this.sets.push({ v: Number.NaN, t: Number.NaN });
  }
}

class FakeOsc implements OscLike {
  type: OscillatorType = 'sine';
  frequency = new Param();
  started: number[] = [];
  stopped: number[] = [];
  disconnected = false;
  connect(): void {}
  start(when?: number): void {
    this.started.push(when ?? 0);
  }
  stop(when?: number): void {
    this.stopped.push(when ?? 0);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain implements GainLike {
  gain = new Param();
  disconnected = false;
  connect(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeBuffer implements BufferLike {
  data: Float32Array;
  constructor(length: number) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeSource implements BufferSourceLike {
  buffer: BufferLike | null = null;
  started: number[] = [];
  stopped: number[] = [];
  disconnected = false;
  connect(): void {}
  start(when?: number): void {
    this.started.push(when ?? 0);
  }
  stop(when?: number): void {
    this.stopped.push(when ?? 0);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeShaper implements ShaperLike {
  curve: Float32Array | null = null;
  connect(): void {}
  disconnect(): void {}
}

class FakeFilter implements FilterLike {
  type: BiquadFilterType = 'lowpass';
  frequency = new Param();
  Q = new Param();
  connect(): void {}
  disconnect(): void {}
}

class FakeGraph implements AudioGraph {
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = {};
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  shapers: FakeShaper[] = [];
  filters: FakeFilter[] = [];
  createOscillator(): OscLike {
    const osc = new FakeOsc();
    this.oscs.push(osc);
    return osc;
  }
  createGain(): GainLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBuffer(_channels: number, length: number): BufferLike {
    return new FakeBuffer(length);
  }
  createBufferSource(): BufferSourceLike {
    const src = new FakeSource();
    this.sources.push(src);
    return src;
  }
  createWaveShaper(): ShaperLike {
    const shape = new FakeShaper();
    this.shapers.push(shape);
    return shape;
  }
  createBiquadFilter(): FilterLike {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter;
  }
}

function memoryStore(initial?: string): SoundStore & { value: string | null } {
  const box = { value: initial ?? null };
  return {
    get value() {
      return box.value;
    },
    set value(next: string | null) {
      box.value = next;
    },
    get(key: string) {
      return key === SOUND_KEY ? box.value : null;
    },
    set(key: string, value: string) {
      if (key === SOUND_KEY) box.value = value;
    },
  };
}

function rig(env?: Partial<{ enabled: boolean; reducedMotion: boolean; hidden: boolean }>) {
  const graph = new FakeGraph();
  let now = 0;
  let graphs = 0;
  const flags = { enabled: true, reducedMotion: false, hidden: false, ...env };
  const player = createPlayer({
    now: () => now,
    env: () => flags,
    graph: () => {
      graphs += 1;
      return graph;
    },
  });
  return {
    graph,
    player,
    flags,
    graphs: () => graphs,
    at(ms: number) {
      now = ms;
    },
  };
}

function endOf(graph: FakeGraph): number {
  const times = [
    ...graph.oscs.flatMap((osc) => osc.stopped),
    ...graph.sources.flatMap((src) => src.stopped),
  ];
  return Math.max(...times);
}

function heardHz(graph: FakeGraph, hz: number): boolean {
  const nodes = [...graph.oscs, ...graph.filters];
  return nodes.some(
    (node) =>
      node.frequency.sets.some((set) => set.v === hz) ||
      node.frequency.linear.some((ramp) => ramp.v === hz),
  );
}

const open = { enabled: true, reducedMotion: false, hidden: false };

describe('sound choice', () => {
  it('treats anything but off as on', () => {
    expect(readChoice(null)).toBe(true);
    expect(readChoice('on')).toBe(true);
    expect(readChoice('nope')).toBe(true);
    expect(readChoice('off')).toBe(false);
  });

  it('stores the mute and leaves a failed write unchanged', () => {
    const store = memoryStore();
    expect(readStored(store)).toBe(true);
    expect(writeToggle(store)).toBe(false);
    expect(store.get(SOUND_KEY)).toBe('off');
    expect(writeToggle(store)).toBe(true);
    expect(store.get(SOUND_KEY)).toBe('on');
    const broken: SoundStore = {
      get: () => 'on',
      set: () => {
        throw new Error('private mode');
      },
    };
    expect(writeToggle(broken)).toBe(true);
  });
});

describe('cues', () => {
  it('keeps every cue inside the duration and gain caps', () => {
    for (const spec of Object.values(CUES)) {
      expect(spec.durationMs).toBeGreaterThan(0);
      expect(spec.durationMs).toBeLessThanOrEqual(MAX_CUE_MS);
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.gain).toBeLessThanOrEqual(1);
    }
    expect(CUES.palette.hz).toEqual([1100, 1700]);
    expect(CUES.shortlist.hz[0]).toBe(2600);
    expect(CUES['scout-start'].hz).toEqual([2100, 1800]);
    expect(CUES['scout-start'].durationMs).toBe(340);
    expect(CUES['score-done'].hz).toEqual([1500, 1700]);
    expect(MASTER_GAIN).toBe(0.45);
  });

  it('schedules each cue from the table and no longer', () => {
    const { graph, player, at } = rig();
    const names = Object.keys(CUES).filter((key): key is Cue => Object.hasOwn(CUES, key));
    names.forEach((cue, i) => {
      at(i * 1000);
      graph.currentTime = i;
      expect(player.play(cue)).toBe(true);
      const spec = CUES[cue];
      const started = graph.currentTime;
      expect(endOf(graph)).toBeCloseTo(started + spec.durationMs / 1000, 5);
      for (const hz of spec.hz) expect(heardHz(graph, hz), `${cue} ${hz}`).toBe(true);
    });
    expect(graph.gains[0]?.gain.sets[0]).toEqual({ v: MASTER_GAIN, t: 0 });
    expect(graph.oscs.every((osc) => osc.started.length === 1 && osc.stopped.length === 1)).toBe(
      true,
    );
  });

  it('holds a whistle at its peak until the release', () => {
    const { graph, player } = rig();
    player.play('shortlist');
    const voice = graph.gains[1]?.gain;
    const dur = CUES.shortlist.durationMs / 1000;
    const held = voice?.sets.find((set) => set.v === CUES.shortlist.gain);
    expect(held).toBeDefined();
    expect(held?.t).toBeGreaterThan(dur * 0.5);
    expect(voice?.exponential.at(-1)).toEqual({ v: 0.0001, t: dur });
  });
});

describe('gates', () => {
  it.each([
    ['muted', { enabled: false }],
    ['reduced motion', { reducedMotion: true }],
    ['a hidden tab', { hidden: true }],
  ] as const)('schedules nothing when %s', (_label, env) => {
    const { player, graphs } = rig(env);
    expect(player.play('shortlist')).toBe(false);
    expect(graphs()).toBe(0);
  });

  it('drops the same cue inside 180 ms and plays it again at the boundary', () => {
    const { player, graph, at } = rig(open);
    expect(player.play('shortlist')).toBe(true);
    const oscs = graph.oscs.length;
    at(REPEAT_MS - 1);
    expect(player.play('shortlist')).toBe(false);
    expect(graph.oscs.length).toBe(oscs);
    at(REPEAT_MS);
    expect(player.play('shortlist')).toBe(true);
    expect(graph.oscs.length).toBeGreaterThan(oscs);
  });

  it('stops the previous cue when a different one starts', () => {
    const { player, graph, at } = rig(open);
    player.play('shortlist');
    const first = graph.oscs[0];
    expect(first?.disconnected).toBe(false);
    at(50);
    graph.currentTime = 0.05;
    player.play('skip');
    expect(first?.disconnected).toBe(true);
    expect(graph.oscs.some((osc) => osc.type === 'sawtooth')).toBe(true);
  });

  it('does not remember a cue the graph refused', () => {
    let now = 0;
    let graph: FakeGraph | null = null;
    const player = createPlayer({
      now: () => now,
      env: () => open,
      graph: () => graph,
    });
    expect(player.play('error')).toBe(false);
    now = 10;
    graph = new FakeGraph();
    expect(player.play('error')).toBe(true);
    expect(graph.sources).toHaveLength(1);
    expect(graph.shapers[0]?.curve).not.toBeNull();
  });
});
