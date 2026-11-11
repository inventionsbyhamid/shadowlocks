// What the voice guide can say, by copy key: every line the coach chip can show (the lessons, the tips, the session's
// suggestion, and the phone's and the controllers' wordings), the key of a line from its English words, a lessons
// line as the device in hand shows it, and the lines a lesson step may show (so only those clips are decoded).
// Everything here is built once or runs on an event (a new line, a new step), never per frame.
import { COPY } from "../ui/copy";
import { CONTROLLER_KEYS } from "./controller-lines";
import type { LessonId } from "../core/lessons-data";
import { type ChipKey, type ExampleId, LESSON_STEPS, NUDGES, SAID, SUGGESTION_KEY } from "./lessons-director";
import { copyAt, PHONE_KEYS } from "./phone-lines";

/** The input in hand: the coach chip words some lines its way (phone-lines.ts, controller-lines.ts). */
export type Device = "hands" | "controllers" | "phone";

/** Every copy key the coach chip can show. */
export function chipKeys(): string[] {
  const lessons = Object.entries(COPY.lessons)
    .filter(([, v]) => typeof v === "string")
    .map(([k]) => `lessons.${k}`);
  const tips = Object.keys(COPY.lessons.tips).map((k) => `lessons.tips.${k}`);
  return [...new Set([...lessons, ...tips, SUGGESTION_KEY, ...Object.values(PHONE_KEYS), ...Object.values(CONTROLLER_KEYS)])];
}

let byText: Map<string, string> | null = null;

/** The copy key of a chip line from its English words, or null for a line with no key. */
export function keyOfLine(en: string): string | null {
  if (!byText) {
    byText = new Map();
    for (const k of chipKeys()) {
      const t = copyAt(k);
      if (t !== undefined && !byText.has(t)) byText.set(t, k);
    }
  }
  return byText.get(en) ?? null;
}

/** A director's chip key as a copy key: "goal" is "lessons.goal"; the suggestion is already one. */
export function chipPath(k: ChipKey): string {
  return k === SUGGESTION_KEY ? k : `lessons.${k}`;
}

/** Copy key `path` as the chip shows it with `device` in hand. */
export function deviceKey(path: string, device: Device): string {
  if (device === "phone") return PHONE_KEYS[path] ?? path;
  if (device === "controllers") return CONTROLLER_KEYS[path] ?? path;
  return path;
}

/** Each example's lines, in order: its opening, its beats' lines and its turn (a replay ends on "Your turn."). */
export const EXAMPLE_LINES: Readonly<Record<ExampleId, readonly string[]>> = {
  move: ["lessons.watch", "lessons.watchMove", "lessons.goal"],
  "near-far": ["lessons.watchNearFar", "lessons.nearSwing", "lessons.turnNearFar"],
  rings: ["lessons.watchRings", "lessons.lineUp", "lessons.slide", "lessons.yourTurn"],
  finger: ["lessons.watchFinger", "lessons.finger", "lessons.turnFinger"],
};

/** The lines step `n` of lesson `id` may show, in about the order they come (lessons keys as copy keys). */
function linesOf(id: LessonId, n: number): string[] {
  const steps = LESSON_STEPS[id], s = steps[n];
  if (!s) return [];
  const L = (k: string) => `lessons.${k}`;
  switch (s.kind) {
    case "intro":
      return [L("pickUp"), L("stuck")];
    case "move":
      return [L("goal"), ...NUDGES.move.map((x) => L(x.key)), L("letGo"), ...EXAMPLE_LINES.move];
    case "demo": {
      // Reached by a win: lesson 1 names it (the first lock open, or how many are).
      let opened = 0;
      for (let i = 0; i < n; i++) if (steps[i]!.kind === "move" || steps[i]!.kind === "turn") opened++;
      const win = id === "l1" ? [L(opened <= 1 ? "lockOpen" : "twoOpen")] : [];
      return [...win, ...EXAMPLE_LINES[s.example!]];
    }
    case "turn": {
      const ex = s.example!;
      const own = ex === "rings" ? [L("yourTurn"), L("lineUp"), L("slide")] : [L(SAID[ex].turn)];
      const suggest = ex === "finger" ? [SUGGESTION_KEY] : [];
      return [...own, ...suggest, ...NUDGES[ex].map((x) => L(x.key)), L("letGo")];
    }
    case "reward":
      return [L("boxOpen")];
    case "puppets":
      return [L("puppets")];
    case "drawer":
      return [L("boxOpen"), L("drawer")];
  }
}

/** Lines a step's part of a lesson needs decoded: the step's own and the next step's first two, as `device` shows them. */
export function stepLines(id: LessonId, n: number, device: Device): string[] {
  const out = [...linesOf(id, n), ...linesOf(id, n + 1).slice(0, 2)];
  return [...new Set(out.map((k) => deviceKey(k, device)))];
}

/** Lines a replay of example `ex` needs decoded: its own, ending on "Your turn.". */
export function replayLines(ex: ExampleId, device: Device): string[] {
  const own = EXAMPLE_LINES[ex].slice(0, -1);
  return [...new Set([...own, "lessons.yourTurn"].map((k) => deviceKey(k, device)))];
}
