// Sound for the game: one Web Audio engine for the effects, the music and the captions. Effects
// load at boot, music once the first screen is up. Every bus event goes through the cue mapper
// (heard after every other listener), placed where it happened: at the button it names. Audio
// starts on the first pinch, poke or grab (or the Enter tap), pauses with the game whenever the
// player cannot see it (the lifecycle's audio hook), follows the head for spatial sounds, and plays
// room tone only in the virtual room (no passthrough). Variants and pitch spread come from a seeded
// random source, so a frame-stepped run sounds the same every time.
import { createSystem, type Object3D, Vector3, type World } from "@iwsdk/core";
import { attachCues, type CueEvent, CueMapper } from "../audio/cues";
import { AudioEngine } from "../audio/engine";
import type { ListenerPose } from "../audio/manifest";
import { loadSoundPack, type SoundPack } from "../audio/pack";
import { mulberry32, seedFrom } from "../core/rng";
import type { Vec3 } from "../core/types";
import { startAudio } from "./audio-unlock";
import { type FeedbackEvent, on, onAny } from "./bus";
import type { Lifecycle } from "./lifecycle";
import type { PanelButton } from "./panels";
import { currentScreen, type Screen } from "./screens";
import type { SettingsStore } from "./settings";

/** What sound needs of the app: the keys on screen, settings, the lifecycle and where captions go. */
export interface SoundDeps {
  world: World;
  settings: SettingsStore;
  lifecycle: Lifecycle;
  /** Keys of a menu screen (for where a press sounds). */
  menuButtons(screen: Screen): PanelButton[];
  /** Shows a sound's caption (Settings, Captions); none until the game draws captions. */
  caption?: (id: string, text: string) => void;
}

/** The listener moves when the head moved this far (m, summed over axes)... */
const LISTENER_MOVE_M = 0.002;
/** ...or turned more than about 1 degree (cosine of the angle between the old and new forward). */
const LISTENER_TURN_COS = Math.cos((1 * Math.PI) / 180);

export class Sound {
  readonly engine: AudioEngine;
  private readonly mapper: CueMapper;
  private readonly onEvents: (events: readonly CueEvent[]) => void;
  private readonly one: CueEvent[] = [{ type: "none" }];
  private readonly pose: ListenerPose = { position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
  /** The listener has been placed once (the first frame always places it). */
  private placed = false;
  private readonly tmp = new Vector3();
  private pack: Promise<{ pack: SoundPack; loadMusic: () => Promise<void> } | null>;
  private effects = false;

  constructor(private readonly deps: SoundDeps) {
    this.engine = new AudioEngine({
      random: mulberry32(seedFrom("shadow-locks-sound")),
      baseUrl: `${import.meta.env.BASE_URL}audio/`,
      // Captions only when the player asked for them; the engine sends one even for a sound it
      // does not play (muted, cooldown, before audio starts).
      onCaption: (id, text) => {
        if (deps.settings.get().captions) deps.caption?.(id, text);
      },
    });
    this.mapper = new CueMapper({ locate: (e) => this.locate(e) });
    this.onEvents = attachCues(this.engine, this.mapper);
    this.pack = loadSoundPack(this.engine, { baseUrl: `${import.meta.env.BASE_URL}audio/`, warn: (m) => console.warn(m) }).then(
      (p) => {
        this.effects = true;
        return p;
      },
      (err) => {
        console.warn("sound effects could not load", err);
        return null;
      },
    );

    onAny((e) => this.send(e));
    // The first pinch, poke or grab may start audio (browsers want a gesture).
    on("press", () => this.unlock());
    on("grab", () => this.unlock());
    deps.lifecycle.setAudio(this.engine);
    const apply = (s: { musicVol: number; sfxVol: number }) => this.engine.setVolumes({ music: s.musicVol, sfx: s.sfxVol });
    apply(deps.settings.get());
    deps.settings.subscribe(apply);
    this.watchXr();
  }

  /** The sound effects (and their captions) are loaded. */
  get loaded(): boolean {
    return this.effects;
  }

  /** Start audio (on a gesture). Every gesture tries again until audio runs. */
  unlock(): void {
    startAudio(this.engine);
  }

  /** Music is the bigger download: load it once the first screen is up. */
  loadMusicLater(): void {
    void this.pack.then((p) => p?.loadMusic()).catch((err) => console.warn("music could not load", err));
  }

  /**
   * Per frame: the listener follows the head (only while audio runs, and only when the head moved:
   * every listener write crosses into the audio graph). Allocation free.
   */
  update(): void {
    const head = this.deps.world.player?.head;
    if (head && this.engine.running) this.follow(head);
  }

  /** The listener at the head: one world matrix update, read straight from its columns. */
  private follow(head: Object3D): void {
    head.updateWorldMatrix(true, false);
    const e = head.matrixWorld.elements;
    const p = this.pose;
    const x = e[12] as number;
    const y = e[13] as number;
    const z = e[14] as number;
    // Forward is the head's -z axis, up its y axis (no scale on the head).
    const fx = -(e[8] as number);
    const fy = -(e[9] as number);
    const fz = -(e[10] as number);
    const moved =
      Math.abs(x - p.position[0]) + Math.abs(y - p.position[1]) + Math.abs(z - p.position[2]) > LISTENER_MOVE_M ||
      fx * p.forward[0] + fy * p.forward[1] + fz * p.forward[2] < LISTENER_TURN_COS;
    if (!moved && this.placed) return;
    this.placed = true;
    p.position[0] = x;
    p.position[1] = y;
    p.position[2] = z;
    p.forward[0] = fx;
    p.forward[1] = fy;
    p.forward[2] = fz;
    p.up[0] = e[4] as number;
    p.up[1] = e[5] as number;
    p.up[2] = e[6] as number;
    this.engine.setListener(p);
  }

  private send(e: FeedbackEvent): void {
    this.one[0] = e;
    this.onEvents(this.one);
  }

  /** Room tone only in the virtual room (an opaque VR session); passthrough has the real room. */
  private watchXr(): void {
    const xr = this.deps.world.renderer.xr;
    xr.addEventListener("sessionstart", () => {
      this.unlock();
      this.engine.setAmbience(xr.getSession()?.environmentBlendMode === "opaque");
    });
    xr.addEventListener("sessionend", () => this.engine.setAmbience(false));
    // A pinch or trigger anywhere counts as the first gesture too.
    xr.addEventListener("sessionstart", () => xr.getSession()?.addEventListener("selectstart", () => this.unlock()));
  }

  /** Where an event happened: the key it names on the current screen. */
  private locate(e: CueEvent): Vec3 | undefined {
    const id = (e as { id?: unknown }).id;
    if (typeof id !== "string") return undefined;
    const b = this.deps.menuButtons(currentScreen()).find((k) => k.id === id);
    if (!b) return undefined;
    b.object.getWorldPosition(this.tmp);
    return [this.tmp.x, this.tmp.y, this.tmp.z];
  }
}

let sound: Sound | null = null;

/** Hand the sound to its system (systems cannot take constructor arguments). */
export function useSound(s: Sound): void {
  sound = s;
}

/** Sound's per-frame work as an app system (timed in the per-frame budget). */
export class SoundSystem extends createSystem({}) {
  update(): void {
    sound?.update();
  }
}
