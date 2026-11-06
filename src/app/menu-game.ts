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
  session: { readonly stage: Stage; readonly spec: BoxSpec | null };
  lessons: MenuLessons;
  /** Close the menus: the play screen (the drawer shuts, the box it held runs on). */
  toPlay(): void;
  /** Clear the box from the lap (a progress reset). */
  clearBox(): void;
}

export class GameMenus implements MenuGame {
  /** Every replay asked for, oldest first. */
  readonly replays: ReplayAsked[] = [];
  /** A progress reset let the box in play go: nothing waits until the next box starts. */
  private let = false;

  constructor(private readonly d: GameMenusDeps) {}

  behind(): Behind {
    if (this.d.lessons.running) return { kind: "lesson" };
    const spec = this.d.session.spec;
    if (this.let || !spec || this.d.session.stage === "idle") return null;
    if (spec.kind === "box") return { kind: "box", n: spec.n };
    if (spec.kind === "daily") return { kind: "daily" };
    return { kind: "lesson" };
  }

  back(): void {
    this.d.toPlay();
  }

  playBox(n: number, resume: boolean): void {
    const b = this.behind();
    if (b && b.kind === "box" && b.n === n) {
      this.back();
      return;
    }
    this.let = false;
    if (resume) this.d.game.playNext();
    else this.d.game.play({ kind: "box", n });
  }

  playDaily(nowMs: number): void {
    const spec = this.d.session.spec;
    if (!this.let && this.d.session.stage !== "idle" && spec?.kind === "daily" && spec.day === todayKey(nowMs)) {
      this.back();
      return;
    }
    this.let = false;
    this.d.game.playDaily(nowMs);
  }

  replay(row: LessonRow): void {
    const l = this.d.lessons;
    let ran: boolean;
    if (row.kind === "example") ran = l.replay(row.id);
    else ran = l.replayTip ? l.replayTip(row.id) : l.replay(TIP_EXAMPLE[row.id]);
    this.replays.push({ kind: row.kind, id: row.id, ran });
    if (ran) this.d.toPlay();
  }

  /** A first launch: lesson 1 at once (never Home). False when the lessons cannot start it. */
  startFirst(): boolean {
    if (!this.d.lessons.startFirst()) return false;
    this.d.toPlay();
    return true;
  }

  dropped(): void {
    this.let = true;
    this.d.clearBox();
  }
}
