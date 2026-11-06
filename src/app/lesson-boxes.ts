// The lessons' boxes in the box session: a box client that serves the hand-built lesson boxes for lesson specs (the
// generator refuses them) and passes every other spec on, and the save a lesson resumed at a step starts from (the
// locks the steps before it opened). The session mirrors a box for a left-handed player itself.
import type { BoxClient } from "../core/box-client";
import { reviveBox } from "../core/box-client";
import { GENERATOR_VERSION } from "../core/generator";
import { type LessonId, lessonPlan } from "../core/lessons-data";
import type { BoxSnapshot } from "../core/profile";
import type { V3 } from "../core/types";
import { openBefore } from "./lessons-director";

/**
 * `inner` with the lessons: a lesson spec gets a fresh copy of its box every time (a lesson moves its scraps in
 * place while it stages an example, so no two sessions may share one).
 */
export function withLessons(inner: Pick<BoxClient, "get" | "prefetch">): Pick<BoxClient, "get" | "prefetch"> {
  return {
    get: (spec) => (spec.kind === "lesson" ? Promise.resolve(reviveBox(lessonPlan(spec.id, false).box)) : inner.get(spec)),
    prefetch: (spec) => {
      if (spec.kind !== "lesson") inner.prefetch(spec);
    },
  };
}

/**
 * What lesson `id` resumed at the start of step `step` shows: the locks the steps before it opened, the lantern at
 * the box's start (or `lantern`). Null at step 0 (the lesson starts afresh). `mirrored`: a left-handed player's box.
 */
export function lessonSnapshot(id: LessonId, step: number, mirrored: boolean, lantern?: V3): BoxSnapshot | null {
  if (step <= 0) return null;
  const box = lessonPlan(id, mirrored).box;
  const at = lantern ?? box.start;
  const open = openBefore(id, step);
  // An open finger lock has its piece in place, where its scrap would hang.
  const crystal: { lock: number; z: number }[] = [];
  for (const i of open) {
    const lock = box.locks[i]!;
    const piece = box.elements.find((e) => e.kind === "piece" && e.lock === i && e.piece === lock.missing);
    if (lock.finger && piece && piece.kind === "piece") crystal.push({ lock: i, z: piece.verts.reduce((s, v) => s + v[2], 0) / piece.verts.length });
  }
  return {
    key: box.key,
    gen: GENERATOR_VERSION,
    lantern: [at[0], at[1], at[2]],
    open,
    crystal,
    elapsedMs: 0,
    hints: 0,
    hintLevel: {},
  };
}
