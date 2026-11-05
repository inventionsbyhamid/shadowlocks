/** Minimal fake Web Audio graph that records nodes, params and scheduled times. */

export interface ParamEvent {
  type: "set" | "linear" | "target" | "curve" | "cancel";
  value?: number;
  time: number;
  duration?: number;
  curve?: Float32Array;
  constant?: number;
}

export class FakeParam {
  events: ParamEvent[] = [];
  private initial: number;
  constructor(
    value = 0,
    private clock: () => number = () => 0,
  ) {
    this.initial = value;
  }

  /** Reads the automation timeline at the context's current time. */
  get value(): number {
    return this.at(this.clock());
  }
  set value(v: number) {
    this.setValueAtTime(v, this.clock());
  }

  /**
   * Events still scheduled after every cancel. Like Chrome, a cancel removes events at or after its
   * time and also a value curve that is still running at that time.
   * `target` is treated as an instant set (good enough for these tests).
   */
  live(): ParamEvent[] {
    let live: ParamEvent[] = [];
    for (const e of this.events) {
      if (e.type === "cancel") live = live.filter((x) => x.time < e.time && !(x.type === "curve" && x.time + x.duration! > e.time));
      else live.push(e);
    }
    return live.sort((x, y) => x.time - y.time);
  }

  at(t: number): number {
    const live = this.live();
    let cur = this.initial;
    let curT = -Infinity;
    for (const e of live) {
      if (e.type === "set" || e.type === "target") {
        if (e.time > t) break;
        cur = e.value!;
        curT = e.time;
      } else if (e.type === "linear") {
        if (e.time <= t) {
          cur = e.value!;
          curT = e.time;
        } else {
          const from = curT === -Infinity ? t : curT;
          const k = (t - from) / (e.time - from);
          return cur + (e.value! - cur) * Math.max(0, Math.min(1, k));
        }
      } else if (e.type === "curve") {
        const c = e.curve!;
        if (e.time > t) break;
        const end = e.time + e.duration!;
        if (t >= end) {
          cur = c[c.length - 1]!;
          curT = end;
        } else {
          const x = ((t - e.time) / e.duration!) * (c.length - 1);
          const i = Math.floor(x);
          return c[i]! + (c[Math.min(i + 1, c.length - 1)]! - c[i]!) * (x - i);
        }
      }
    }
    return cur;
  }

  /** Chrome throws NotSupportedError when an event lands inside a running value curve. */
  private checkInsideCurve(t: number) {
    for (const x of this.live()) {
      if (x.type === "curve" && t >= x.time && t < x.time + x.duration!) {
        throw new Error(`NotSupportedError: event at ${t} overlaps a value curve at ${x.time}`);
      }
    }
  }
  setValueAtTime(v: number, t: number) {
    this.checkInsideCurve(t);
    this.events.push({ type: "set", value: v, time: t });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.checkInsideCurve(t);
    this.events.push({ type: "linear", value: v, time: t });
    return this;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    this.checkInsideCurve(t);
    this.events.push({ type: "target", value: v, time: t, constant: c });
    return this;
  }
  setValueCurveAtTime(curve: Float32Array, t: number, d: number) {
    for (const x of this.live()) {
      if (x.time > t && x.time < t + d) throw new Error(`NotSupportedError: value curve at ${t} overlaps an event at ${x.time}`);
    }
    this.checkInsideCurve(t);
    this.events.push({ type: "curve", curve, time: t, duration: d });
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push({ type: "cancel", time: t });
    return this;
  }
}

type Clock = () => number;
const zero: Clock = () => 0;

export class FakeNode {
  kind: string;
  out = new Set<FakeNode>();
  constructor(kind: string) {
    this.kind = kind;
  }
  connect(n: FakeNode) {
    this.out.add(n);
    return n;
  }
  disconnect() {
    this.out.clear();
  }
}

export class FakeGain extends FakeNode {
  gain: FakeParam;
  constructor(clock: Clock = zero) {
    super("gain");
    this.gain = new FakeParam(1, clock);
  }
}

export class FakePanner extends FakeNode {
  panningModel = "equalpower";
  distanceModel = "inverse";
  refDistance = 1;
  rolloffFactor = 1;
  positionX: FakeParam;
  positionY: FakeParam;
  positionZ: FakeParam;
  constructor(clock: Clock = zero) {
    super("panner");
    this.positionX = new FakeParam(0, clock);
    this.positionY = new FakeParam(0, clock);
    this.positionZ = new FakeParam(0, clock);
  }
}

export class FakeFilter extends FakeNode {
  type = "lowpass";
  Q: FakeParam;
  frequency: FakeParam;
  constructor(clock: Clock = zero) {
    super("filter");
    this.frequency = new FakeParam(350, clock);
    this.Q = new FakeParam(1, clock);
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate: FakeParam;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: ((e: { target: unknown }) => void) | null = null;
  constructor(clock: Clock = zero) {
    super("source");
    this.playbackRate = new FakeParam(1, clock);
  }
  start(when = 0) {
    this.startedAt = when;
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
  end() {
    this.onended?.({ target: this });
  }
}

export class FakeBuffer {
  data: Float32Array[];
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c]!;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  state: "suspended" | "running" = "suspended";
  sampleRate = 48000;
  destination = new FakeNode("destination");
  private clock: Clock = () => this.currentTime;
  listener = Object.fromEntries(
    ["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map((k) => [k, new FakeParam(0, () => this.currentTime)]),
  ) as Record<"positionX" | "positionY" | "positionZ" | "forwardX" | "forwardY" | "forwardZ" | "upX" | "upY" | "upZ", FakeParam>;
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  filters: FakeFilter[] = [];
  sources: FakeSource[] = [];
  compressors: FakeNode[] = [];
  resumeCalls = 0;
  suspendCalls = 0;

  createGain() {
    const g = new FakeGain(this.clock);
    this.gains.push(g);
    return g;
  }
  createPanner() {
    const p = new FakePanner(this.clock);
    this.panners.push(p);
    return p;
  }
  createBiquadFilter() {
    const f = new FakeFilter(this.clock);
    this.filters.push(f);
    return f;
  }
  createDynamicsCompressor() {
    const c = Object.assign(new FakeNode("compressor"), {
      threshold: new FakeParam(0, this.clock),
      ratio: new FakeParam(0, this.clock),
      attack: new FakeParam(0, this.clock),
      release: new FakeParam(0, this.clock),
      knee: new FakeParam(0, this.clock),
    });
    this.compressors.push(c);
    return c;
  }
  createBufferSource() {
    const s = new FakeSource(this.clock);
    this.sources.push(s);
    return s;
  }
  createBuffer(ch: number, len: number, rate: number) {
    return new FakeBuffer(ch, len, rate);
  }
  async decodeAudioData(ab: ArrayBuffer) {
    return new FakeBuffer(1, Math.max(1, ab.byteLength), 48000);
  }
  /** ok: resolves at once; pending: waits for finishResume(); reject: throws. */
  resumeMode: "ok" | "pending" | "reject" = "ok";
  private pendingResume: (() => void)[] = [];
  finishResume() {
    for (const r of this.pendingResume.splice(0)) r();
  }
  async resume() {
    this.resumeCalls++;
    if (this.resumeMode === "reject") throw new Error("resume blocked");
    if (this.resumeMode === "pending") {
      await new Promise<void>((r) => this.pendingResume.push(r));
    }
    this.state = "running";
  }
  async suspend() {
    this.suspendCalls++;
    this.state = "suspended";
  }
}

export function asCtx(c: FakeAudioContext): AudioContext {
  return c as unknown as AudioContext;
}

/** Sources playing a given buffer, in creation order. */
export function sourcesOf(ctx: FakeAudioContext, buf: unknown): FakeSource[] {
  return ctx.sources.filter((s) => s.buffer === buf);
}
