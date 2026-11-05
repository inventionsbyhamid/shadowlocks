// Results numbers roll up like a mechanical counter: a fixed list of strings made when the screen
// opens, then played back eased (fast first). Per frame it only picks an index: no allocation.
import { easeOutCubic } from "./motion";

/**
 * The values shown while counting from `from` to `to`: `steps` evenly spaced samples, formatted,
 * with repeats dropped. Always starts at fmt(from) and ends at fmt(to).
 */
export function countUpSteps(from: number, to: number, steps: number, fmt: (v: number) => string): string[] {
  const n = Math.max(1, Math.floor(steps));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = n === 1 ? to : i === n - 1 ? to : from + ((to - from) * i) / (n - 1);
    const s = fmt(v);
    if (out[out.length - 1] !== s) out.push(s);
  }
  return out;
}

const NONE: readonly string[] = [""];

export class CountUp {
  text = "";
  done = true;
  private steps: readonly string[] = NONE;
  private index = 0;
  private t = 0;
  private duration = 0.9;
  private delay = 0;

  start(steps: readonly string[], durationMs: number, delayS: number): void {
    this.steps = steps.length ? steps : NONE;
    this.index = 0;
    this.text = this.steps[0] as string;
    this.t = 0;
    this.duration = Math.max(0.001, durationMs / 1000);
    this.delay = Math.max(0, delayS);
    this.done = this.steps.length <= 1;
  }

  /** Advance by `dt` seconds; returns true when the text changed, or when it landed (done now). */
  step(dt: number): boolean {
    if (this.done) return false;
    let d = dt;
    if (this.delay > 0) {
      this.delay -= d;
      if (this.delay > 0) return false;
      d = -this.delay;
      this.delay = 0;
    }
    this.t += d;
    const last = this.steps.length - 1;
    let i: number;
    if (this.t >= this.duration) {
      i = last;
      this.done = true;
    } else {
      i = Math.min(last, Math.floor(easeOutCubic(this.t / this.duration) * last + 1e-9));
    }
    // The last value can show a frame before the time is up; landing on it is still news.
    if (i === this.index) return this.done;
    this.index = i;
    this.text = this.steps[i] as string;
    return true;
  }

  /** How far along the shown value is (0 at the first step, 1 at the last). */
  get progress(): number {
    const last = this.steps.length - 1;
    return last > 0 ? this.index / last : 1;
  }

  /** Jump to the final value. */
  finish(): void {
    this.index = this.steps.length - 1;
    this.text = this.steps[this.index] as string;
    this.done = true;
  }
}
