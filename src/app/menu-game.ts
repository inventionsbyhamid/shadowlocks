// The menus over the game: what waits behind the drawer's panels (the box in the lap, or a lesson), and how
// their keys play. Continue goes back to the box behind, else resumes the saved one, else starts the next;
// the Daily Box goes back to today's when it is behind; a lesson row replays its example through the lessons
// (a tip, through the example that teaches its mechanic) and never touches box progress; a first launch goes
// straight into lesson 1; a progress reset lets the box in play go.
import type { TipId } from "../core/profile";
import type { BoxSpec } from "../core/types";
import { todayKey } from "../core/daily";
import type { LessonRow } from "../ui/menus/lessons";
import type { Behind, ExampleKey } from "../ui/menus/types";
import type { Stage } from "./session-deps";
import type { MenuGame } from "./shell";

/** What the menus need of the lessons (Task 15's LessonsDirector, as its wiring offers it). */
export interface MenuLessons {
  /** A lesson or a replay is in the lap now. */
  readonly running: boolean;
  /** Start lesson 1 (a first launch); false when the lessons cannot start one. */
  startFirst(): boolean;
  /** Replay one example alone; never touches box progress. False when it cannot. */
  replay(example: ExampleKey): boolean;
  /** Replay a tip's own demo, when the lessons have one; else the menus replay `TIP_EXAMPLE[tip]`. */
  replayTip?(tip: TipId): boolean;
}

/** No lessons wired yet: nothing starts, nothing replays (the menus stay where they are). */
export const NO_LESSONS: MenuLessons = { running: false, startFirst: () => false, replay: () => false };

/** The example that teaches each tip's mechanic (the drawer is lesson 2's, which ends on it). */
export const TIP_EXAMPLE: Readonly<Record<TipId, ExampleKey>> = { decoys: "near-far", ringless: "move", hidden: "move", drawer: "finger" };

/** A replay the menus asked for (the test hooks read them). */
export interface ReplayAsked {
  kind: "example" | "tip";
  id: string;
  ran: boolean;
}

export interface GameMenusDeps {
  game: { play(spec: BoxSpec): void; playNext(): void; playDaily(nowMs: number): void };
  session: { readonly stage: Stage; readonly spec: BoxSpec | null; rehand?(): Promise<void> };
  lessons: MenuLessons;
  /** Endless boxes may be played now (the entitlement: false while pending or once a trial is over). */
  canPlayBox(): boolean;
  /** An endless box was asked for that the entitlement refuses: the trial screen. */
  toTrial(): void;
  /** Close the menus: the play screen (the drawer shuts, the box it held runs on). */
  toPlay(): void;
  /** Clear the box from the lap (a progress reset). */
  clearBox(): void;
}

/** Replays remembered for the test hooks (the latest ones; older ones are let go). */
export const REPLAYS_KEPT = 16;

export class GameMenus implements MenuGame {
  /** The latest replays asked for (at most REPLAYS_KEPT), oldest first. */
  readonly replays: ReplayAsked[] = [];
  /** The box a progress reset let go (the session's spec at the time): it no longer waits behind the menus. */
  private letGo: BoxSpec | null = null;

  constructor(private readonly d: GameMenusDeps) {}

  /** The session's box, unless idle or the one a reset let go (a new box is a new spec). */
  private live(): BoxSpec | null {
    const spec = this.d.session.spec;
    return !spec || this.d.session.stage === "idle" || spec === this.letGo ? null : spec;
  }

  behind(): Behind {
    if (this.d.lessons.running) return { kind: "lesson" };
    const spec = this.live();
    if (!spec) return null;
    if (spec.kind === "box") return { kind: "box", n: spec.n };
    if (spec.kind === "daily") return { kind: "daily" };
    return { kind: "lesson" };
  }

  back(): void {
    this.d.toPlay();
  }

  playBox(n: number, resume: boolean): void {
    // An endless box, the one behind included: the entitlement first.
    if (!this.d.canPlayBox()) {
      this.d.toTrial();
      return;
    }
    const b = this.behind();
    if (b && b.kind === "box" && b.n === n) {
      this.back();
      return;
    }
    if (resume) this.d.game.playNext();
    else this.d.game.play({ kind: "box", n });
  }

  playDaily(nowMs: number): void {
    const spec = this.live();
    if (spec?.kind === "daily" && spec.day === todayKey(nowMs)) {
      this.back();
      return;
    }
    this.d.game.playDaily(nowMs);
  }

  replay(row: LessonRow): void {
    const l = this.d.lessons;
    let ran: boolean;
    if (row.kind === "example") ran = l.replay(row.id);
    else ran = l.replayTip ? l.replayTip(row.id) : l.replay(TIP_EXAMPLE[row.id]);
    this.replays.push({ kind: row.kind, id: row.id, ran });
    if (this.replays.length > REPLAYS_KEPT) this.replays.shift();
    if (ran) this.d.toPlay();
  }

  /** A first launch: lesson 1 at once (never Home). False when the lessons cannot start it. */
  startFirst(): boolean {
    if (!this.d.lessons.startFirst()) return false;
    this.d.toPlay();
    return true;
  }

  dropped(): void {
    this.letGo = this.d.session.spec;
    this.d.clearBox();
  }

  /** The Left hand setting changed: the box behind the menus follows it (never one a reset let go). */
  rehand(): Promise<void> {
    if (!this.live() || !this.d.session.rehand) return Promise.resolve();
    return this.d.session.rehand();
  }
}
