// The app shell: screens, the box placement and the box scene, pause and save, and XR session
// handling. Per-frame work lives in ShellSystem; this class reacts to events. The box session
// (the game) plugs in through `useFlow` and runs boxes the shell restores and saves.
import { type Object3D, SessionMode, type World } from "@iwsdk/core";
import { todayKey } from "../core/daily";
import { specOfKey } from "../core/generator";
import type { BoxSnapshot, Profile } from "../core/profile";
import { BoxScene } from "../render/box-scene";
import { placement } from "../render/placement";
import { type RoomLight, RoomLights, Theatre } from "../render/theatre";
import type { ContinueTo } from "../ui/menus/home";
import type { LessonRow } from "../ui/menus/lessons";
import type { Behind } from "../ui/menus/types";
import type { Access } from "./access";
import { on } from "./bus";
import { STORE_PAGE_URL } from "./edition";
import { frameRateFlag } from "./field-flags";
import { detectHeadset, type Headset, targetFrameRate } from "./headset";
import { Lifecycle, type LifecycleSession, type XrVisibility } from "./lifecycle";
import { Panels } from "./panels";
import { type ProfileStore, type Slot, slotMoved } from "./profile-store";
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
  /** Theatre lights: the room dims while a box is in play, half way in menus (ShellSystem steps it). */
  readonly theatre: Theatre;
  /** Which light the room has: the screen and whether the box in play has opened. */
  readonly roomLights: RoomLights;
  /** Called when the room's light changes, from and to (the theatre's sounds). */
  onRoomLight: ((from: RoomLight, to: RoomLight) => void) | null = null;
  /** The virtual room shown without passthrough (the theatre's studio); `updateRoomVisibility` switches it. */
  room: Object3D | null = null;
  /** Recenter was asked for (a key, or Quest's own recenter); ShellSystem places the box on its next frame. */
  recenterAsked = false;
  /** Whether the lantern is held (set once the lantern exists): a lost box is never moved, nor its arrow shown, then. */
  lanternHeld: () => boolean = () => false;
  /** The headset the last session was tuned for (headset.ts), and the frame rate it asked for (null: none). */
  headset: Headset | null = null;
  frameRateAsked: number | null = null;
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
    this.theatre = new Theatre();
    world.scene.add(this.theatre.veil, this.theatre.room);
    this.room = this.theatre.room;
    this.updateRoomVisibility();
    // Menus dim the room half way, a box in play the most, and the light comes up when the box opens until the next
    // box starts; the dimming setting can turn it off. The theatre's sounds hook in through onRoomLight.
    this.theatre.setEnabled(this.settings.get().dimming);
    this.settings.subscribe((s) => this.theatre.setEnabled(s.dimming));
    this.roomLights = new RoomLights(this.theatre, (from, to) => this.onRoomLight?.(from, to));
    on("screen", (e) => this.roomLights.screen(e.to));
    on("box-open", () => this.roomLights.boxOpen(true));
    on("box-start", () => this.roomLights.boxOpen(false));
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
    // Another window (the hosted link in a second tab) played on: its profile is taken in place of this one's.
    profiles.onAdopt((before) => this.adopted(before));
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
  continueBox(to: Extract<ContinueTo, { kind: "back" | "box" }>): void {
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

  /**
   * Hide the box and its panels (true) while a session waits for the box's first placement, so nothing stands where the
   * head or phone happened to point as it started; shown again once placed, before the prewarm (which compiles for the
   * lights shown).
   */
  hideUntilPlaced(hidden: boolean): void {
    this.box.root.visible = !hidden;
    this.panels.setHidden(hidden);
  }

  /** Lay out the box and the panels after the placement (or the box size) changed. */
  layout(): void {
    this.box.setPlacement(placement.matrix());
    const pose = placement.pose();
    this.panels.layout(pose, placement.matrix());
    this.theatre.placeRoom(pose.position[0], pose.position[2]);
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
   * A box (or lesson) is about to start (Game.play and resume, before the play screen): the box opened before it is
   * done with, so the room goes down to play's light, not back up. The session's box-start says it again later.
   */
  boxBegins(): void {
    this.roomLights.boxOpen(false);
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

  /**
   * Another window's newer profile was taken in place of this one's (profile-store.ts). What is in the lap was saved
   * to the old one: when the other window moved its save on (played that box on, solved it, played another, went on
   * with the lessons), it is let go unsaved and Home offers the stored one; else it plays on. The settings and the
   * menus follow the new profile.
   */
  private adopted(before: Profile): void {
    const p = this.profiles.profile;
    const slot: Slot | null = this.flow?.slot() ?? (this.game?.behind()?.kind === "lesson" ? "lesson" : null);
    if (slot && slotMoved(before, p, slot)) {
      this.lifecycle.release(performance.now());
      this.game?.dropped();
      go("home");
    }
    if (JSON.stringify(before.settings) !== JSON.stringify(p.settings)) this.settings.changed();
    this.panels.refresh();
  }

  private watchPage(): void {
    document.addEventListener("visibilitychange", () => {
      const hidden = document.visibilityState === "hidden";
      this.lifecycle.setDocumentHidden(hidden, performance.now());
      // Seen again: another window may have played on meanwhile (the profile store takes its profile).
      if (!hidden) void this.profiles.refresh();
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
      // One line a session, for field checks (chrome://inspect on a phone): how the session says it is seen and used.
      const mode = (s as XRSession & { interactionMode?: string }).interactionMode ?? "none";
      console.info(`XR session: blend ${s.environmentBlendMode ?? "none"}, interactionMode ${mode}`);
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

  /**
   * Compile every shader the scene can show, hidden ones too (a crystallise, the settle ripple, the ring beam, the
   * theatre's veil and studio, menus not shown yet), for the session's own render target: a program compiled before
   * the session (or for the page) does not serve a multiview XR target, and a compile the first time something shows
   * stalls that frame on the headset. Call it inside an XR frame (three sets the session's target per frame):
   * ShellSystem does, on each session's first frame. Links in the background where the browser can; a failure
   * only costs that. The panel's etched textures upload now too, not on the first frame they show.
   */
  prewarm(): Promise<void> {
    const r = this.world.renderer;
    try {
      for (const t of [this.box.panelArt.uniforms.uAlbedo.value, this.box.panelArt.uniforms.uMasks.value, this.box.panelArt.uniforms.uHalo.value]) {
        if (t) r.initTexture(t);
      }
      return r.compileAsync(this.world.scene, this.world.camera).then(
        () => undefined,
        (err: unknown) => console.warn("shaders could not be compiled ahead", err),
      );
    } catch (err) {
      console.warn("shaders could not be compiled ahead", err);
      return Promise.resolve();
    }
  }

  /**
   * Ask for the headset's frame rate where it offers it (90 Hz, or 72 Hz on Quest 2 and Quest Pro: headset.ts; `?hz=`
   * names another) and full foveation where it supports it; never fail over it.
   */
  private tuneSession(s: XRSession): void {
    this.headset = detectHeadset(navigator.userAgent, this.world.renderer.getContext());
    this.frameRateAsked = null;
    try {
      const rate = targetFrameRate(this.headset.class, s.supportedFrameRates, frameRateFlag(location.search));
      if (rate !== null && s.updateTargetFrameRate) {
        this.frameRateAsked = rate;
        s.updateTargetFrameRate(rate).catch(() => {
          if (this.frameRateAsked === rate) this.frameRateAsked = null;
        });
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
