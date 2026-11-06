// The app shell: screens, the box placement and the box scene, pause and save, and XR session
// handling. Per-frame work lives in ShellSystem; this class reacts to events. The box session
// (the game) plugs in through `useFlow` and runs boxes the shell restores and saves.
import { type Object3D, SessionMode, type World } from "@iwsdk/core";
import type { BoxSnapshot } from "../core/profile";
import { BoxScene } from "../render/box-scene";
import { placement } from "../render/placement";
import { roomLightFor, Theatre } from "../render/theatre";
import { on } from "./bus";
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
}

export class Shell {
  readonly lifecycle: Lifecycle;
  readonly panels: Panels;
  /** The box in the lap, at the box placement. */
  readonly box: BoxScene;
  /** Theatre lights: the room dims while a box is in play, half way in menus (ShellSystem steps it). */
  readonly theatre: Theatre;
  /** The virtual room shown without passthrough (the theatre's studio); `updateRoomVisibility` switches it. */
  room: Object3D | null = null;
  /** Recenter was asked for (a key, or Quest's own recenter); ShellSystem places the box on its next frame. */
  recenterAsked = false;
  private xrSession: XRSession | null = null;
  private flow: GameFlow | null = null;

  constructor(
    readonly world: World,
    readonly profiles: ProfileStore,
    readonly settings: SettingsStore,
  ) {
    this.lifecycle = new Lifecycle({ persist: (snap) => void this.profiles.setCurrent(snap) });
    this.box = new BoxScene(world);
    this.theatre = new Theatre();
    world.scene.add(this.theatre.veil, this.theatre.room);
    this.room = this.theatre.room;
    this.updateRoomVisibility();
    // Menus dim the room half way, a box in play the most; the dimming setting can turn it off.
    this.theatre.setEnabled(this.settings.get().dimming);
    this.settings.subscribe((s) => this.theatre.setEnabled(s.dimming));
    on("screen", (e) => this.theatre.setLight(roomLightFor(e.to)));
    // Menus emit `press` themselves and call back here for anything beyond the screens.
    this.panels = new Panels(world, {
      profiles,
      settings,
      actions: { recenter: () => this.requestRecenter() },
    });
    on("screen", (e) => this.panels.show(e.to));
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

  /** Save soon (something worth keeping changed outside the lifecycle's own triggers). */
  markDirty(now: number): void {
    this.lifecycle.markDirty(now);
  }

  /** First screen. */
  start(): void {
    go("home");
  }

  /** Place the box again from the head on the next frame (the Recenter key, Quest's recenter). */
  requestRecenter(): void {
    this.recenterAsked = true;
  }

  /** Lay out the box and the panels after the placement (or the box size) changed. */
  layout(): void {
    this.box.setPlacement(placement.matrix());
    const pose = placement.pose();
    this.panels.layout(pose);
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
