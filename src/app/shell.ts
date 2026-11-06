// The app shell: screens, the box placement and the box scene, pause and save, and XR session
// handling. Per-frame work lives in ShellSystem; this class reacts to events. The box session
// (the game) plugs in through `useFlow` and runs boxes the shell restores and saves.
import { type Object3D, SessionMode, type World } from "@iwsdk/core";
import { todayKey } from "../core/daily";
import { specOfKey } from "../core/generator";
import type { BoxSnapshot } from "../core/profile";
import { BoxScene } from "../render/box-scene";
import { placement } from "../render/placement";
import type { ContinueTo } from "../ui/menus/home";
import type { LessonRow } from "../ui/menus/lessons";
import type { Behind } from "../ui/menus/types";
import type { Access } from "./access";
import { on } from "./bus";
import { STORE_PAGE_URL } from "./edition";
import { Lifecycle, type LifecycleSession, type XrVisibility } from "./lifecycle";
import { Panels } from "./panels";
import type { ProfileStore } from "./profile-store";
import { currentScreen, go } from "./screens";
import type { SettingsStore } from "./settings";

/** How long Enter waits for the browser to answer a session request before offering a retry. */
export const ENTER_TIMEOUT_MS = 120_000;

/** The game the shell hands saved boxes to (the box session). */
export interface GameFlow {
  /** Resume a saved box (Continue): returns the session the lifecycle drives; throws when it cannot be played on. */
  resume(snapshot: BoxSnapshot): LifecycleSession;
  /** Which save the session's snapshots go to: the numbered box in progress, the Daily Box's, or none. */
  slot(): "box" | "daily" | null;
}

/**
 * What the menus ask of the game: what waits behind them, and how to play. The box session and the
 * lessons plug in through `useMenuGame`; until then nothing waits and nothing can start but Continue
 * (which resumes a saved box through the GameFlow when there is one).
 */
export interface MenuGame {
  /** A box or lesson paused behind the menus, or null. */
  behind(): Behind;
  /** Close the menus and go back to it. */
  back(): void;
  /** Play numbered box `n` (from its save when `resume`). */
  playBox(n: number, resume: boolean): void;
  /** Today's Daily Box. */
  playDaily(nowMs: number): void;
  /** Replay a lesson example or a tip (never touches box progress). */
  replay(row: LessonRow): void;
  /** Progress was reset: drop whatever box or lesson was in play. */
  dropped(): void;
  /** A first launch: lesson 1 at once (the play screen), never Home. False when it cannot start. */
  startFirst(): boolean;
}

export class Shell {
  readonly lifecycle: Lifecycle;
  readonly panels: Panels;
  /** The box in the lap, at the box placement. */
  readonly box: BoxScene;
  /** The virtual room shown without passthrough (none yet); `updateRoomVisibility` switches it. */
  room: Object3D | null = null;
  /** Recenter was asked for (a key, or Quest's own recenter); ShellSystem places the box on its next frame. */
  recenterAsked = false;
  private xrSession: XRSession | null = null;
  private flow: GameFlow | null = null;
  private game: MenuGame | null = null;

  constructor(
    readonly world: World,
    readonly profiles: ProfileStore,
    readonly settings: SettingsStore,
    readonly access: Access,
  ) {
    this.lifecycle = new Lifecycle({ persist: (snap) => this.persist(snap) });
    this.box = new BoxScene(world);
    // Menus emit `press` themselves and call back here for anything beyond the screens.
    this.panels = new Panels(world, {
      profiles,
      settings,
      actions: {
        recenter: () => this.requestRecenter(),
        continueBox: (to) => this.continueBox(to),
        playDaily: () => this.game?.playDaily(Date.now()),
        replay: (row) => this.game?.replay(row),
        resetProgress: () => this.resetProgress(),
        buy: () => access.buy(),
        openStore: () => this.openStore(),
      },
      data: {
        behind: () => this.game?.behind() ?? null,
        ent: () => access.ent,
        canBuy: () => access.canBuy,
        today: () => todayKey(Date.now()),
      },
    });
    on("screen", (e) => {
      this.panels.show(e.to);
      // Trial days move on with the calendar: look again whenever Home comes up.
      if (e.to === "home") void access.refresh();
    });
    access.onChange(() => this.panels.refresh());
    // The box size is part of the placement: it scales the box around its panel (ShellSystem lays it out).
    placement.setSize(this.settings.get().boxSizeCm);
    this.settings.subscribe((s) => placement.setSize(s.boxSizeCm));
    this.watchPage();
    this.watchXr();
  }

  /** The game that resumes saved boxes; set once at startup. */
  useFlow(flow: GameFlow): void {
    this.flow = flow;
  }

  /** What the menus play through (the box session and the lessons); set once at startup. */
  useMenuGame(game: MenuGame): void {
    this.game = game;
  }

  /** Continue on Home: back to what waits behind the menus, else the box in progress, else the next. */
  continueBox(to: Exclude<ContinueTo, { kind: "trial" }>): void {
    const g = this.game;
    if (to.kind === "back") {
      if (g) g.back();
      else go("play");
      return;
    }
    if (g) g.playBox(to.n, to.resume);
    else if (to.resume && this.flow) this.continueSaved();
    // No game to start a box with: the drawer shuts, and opens again with a pull.
    else go("play");
  }

  /** Reset progress (after the confirm): the profile starts over and whatever was in play is let go. */
  async resetProgress(): Promise<void> {
    this.game?.dropped();
    this.drop();
    await this.profiles.resetProgress();
    await this.access.refresh();
  }

  /** Opens a page in a new tab (the test hooks record it instead). */
  openPage: (url: string) => void = (url) => {
    try {
      window.open(url, "_blank", "noopener");
    } catch (err) {
      console.warn("could not open the page", err);
    }
  };

  /** The store's page for the game (a browser's trial screen). */
  openStore(): void {
    this.openPage(STORE_PAGE_URL);
  }

  /** Save soon (something worth keeping changed outside the lifecycle's own triggers). */
  markDirty(now: number): void {
    this.lifecycle.markDirty(now);
  }

  /**
   * First screen. A first launch (lesson 1 not finished) goes straight into lesson 1, never Home; any
   * later launch opens on Home, on the open drawer (the entitlement is worked out as it comes up).
   * Without lessons to start, Home.
   */
  start(): void {
    if (!this.profiles.profile.lessons.l1 && this.game?.startFirst()) return;
    go("home");
  }

  /** Place the box again from the head on the next frame (the Recenter key, Quest's recenter). */
  requestRecenter(): void {
    this.recenterAsked = true;
  }

  /** Lay out the box and the panels after the placement (or the box size) changed. */
  layout(): void {
    this.box.setPlacement(placement.matrix());
    this.panels.layout(placement.pose(), placement.matrix());
  }

  /** The virtual room shows only without passthrough (VR session or the 2D page). */
  updateRoomVisibility(): void {
    if (!this.room) return;
    const blend = this.xrSession?.environmentBlendMode;
    this.room.visible = !this.xrSession || blend === "opaque";
  }

  get sessionMode(): "immersive-ar" | "immersive-vr" | null {
    if (!this.xrSession) return null;
    return this.xrSession.environmentBlendMode === "opaque" ? "immersive-vr" : "immersive-ar";
  }

  /**
   * Enter XR: passthrough AR when the device offers it, else VR. Resolves true once a session runs,
   * false when the request failed, was refused or is still unanswered after `timeoutMs` (the player
   * may still accept later; the session then starts as usual).
   */
  async enterXR(timeoutMs = ENTER_TIMEOUT_MS): Promise<boolean> {
    if (this.world.session) return true;
    let ar = false;
    try {
      ar = (await navigator.xr?.isSessionSupported("immersive-ar")) ?? false;
    } catch {
      ar = false;
    }
    try {
      this.world.launchXR({ sessionMode: ar ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR });
    } catch (err) {
      console.error("could not enter XR", err);
      return false;
    }
    // IWSDK only logs a refused request, so wait for the request to settle and look. The wait is
    // counted in timer steps, not clock reads, so it holds in tests where the clocks are stepped.
    for (let waited = 0; this.world.sessionRequestPending && waited < timeoutMs; waited += 50) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return !!this.world.session;
  }

  /**
   * Restore the saved box the player chose to continue (never automatically). Without a game to
   * hand it to, the save stays for a build that has one. A save that cannot be played on is let go
   * and forgotten, so the next launch does not offer it again.
   */
  continueSaved(): boolean {
    const snap = this.profiles.profile.current;
    if (!snap || !this.flow) {
      go("home");
      return false;
    }
    try {
      const session = this.flow.resume(snap);
      this.lifecycle.attach(session, performance.now());
      go("play");
      return true;
    } catch (err) {
      console.error("saved box could not be restored", err);
      this.drop();
      void this.profiles.setCurrent(null);
      go("home");
      return false;
    }
  }

  /** Forget the saved box (the player chose to start fresh). */
  discardSaved(): void {
    this.drop();
    void this.profiles.setCurrent(null);
    go("home");
  }

  /** No box in progress: the session and its saves are let go. */
  private drop(): void {
    this.lifecycle.attach(null, performance.now());
  }

  /**
   * The lifecycle's save of the box in play, where the game says it goes: a Daily Box's to the daily save, a numbered
   * box's to the box in progress, a practice box (`?box=N`) nowhere. Without a game, by the save's key. Lessons keep
   * their own.
   */
  private persist(snap: BoxSnapshot | null): void {
    const kind = this.flow ? this.flow.slot() : snap ? specOfKey(snap.key)?.kind : undefined;
    if (kind === "daily") void this.profiles.setDailyCurrent(snap);
    else if (kind === "box") void this.profiles.setCurrent(snap);
  }

  private watchPage(): void {
    document.addEventListener("visibilitychange", () => {
      this.lifecycle.setDocumentHidden(document.visibilityState === "hidden", performance.now());
    });
    // Last chance on reload or close: write what we have.
    window.addEventListener("pagehide", () => this.lifecycle.flush(performance.now(), true));
  }

  private watchXr(): void {
    const xr = this.world.renderer.xr;
    xr.addEventListener("sessionstart", () => {
      const s = xr.getSession();
      if (!s) return;
      this.xrSession = s;
      const update = () => this.lifecycle.setXrVisibility(s.visibilityState as XrVisibility, performance.now());
      s.addEventListener("visibilitychange", update);
      update();
      this.updateRoomVisibility();
      this.tuneSession(s);
      // Quest's own recenter (hold the Meta button) resets the reference space: place the box again.
      xr.getReferenceSpace()?.addEventListener("reset", () => this.requestRecenter());
    });
    xr.addEventListener("sessionend", () => {
      this.xrSession = null;
      this.lifecycle.setXrVisibility("non-immersive", performance.now());
      this.updateRoomVisibility();
    });
  }

  /** Ask for 90 Hz and full foveation where the headset supports them; never fail over it. */
  private tuneSession(s: XRSession): void {
    try {
      const rates = s.supportedFrameRates;
      if (rates && Array.from(rates).includes(90) && s.updateTargetFrameRate) {
        s.updateTargetFrameRate(90).catch(() => {});
      }
    } catch {
      // not supported
    }
    try {
      this.world.renderer.xr.setFoveation(1);
    } catch {
      // not supported
    }
  }

  /** For the test hooks and debug overlay: what the current screen offers. */
  get screen() {
    return currentScreen();
  }
}
