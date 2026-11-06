// Theatre lights: while a box is in play the room dims, so the lantern's light and the shadows carry the scene; the
// light comes back up when the box opens, and half way in the menus. The room is the passthrough (or, without it,
// the virtual studio below), so dimming it is a veil: an inside-out sphere 3 m round the head, near black, blended
// over the clear page as the very first thing drawn, writing no depth. Everything drawn after it in front (the box,
// the menus, the lantern's glow) covers it at full light; what stays is its opacity over the room: in passthrough
// the headset shows the room through what the page leaves transparent, so the room shows at 1 - opacity. Drawn
// before the hand mask, it dims the room behind a real hand too, so the mask's capsules (wider than the hand) cut
// no bright halo out of the dark room. Brightness kept (theme.ts, ROOM): 35% in play, 55% in menus, full when the box opens or dimming is
// off, never darker than 35%. Every change fades over 0.8 s, eased, from wherever the light is; a fade is a slow
// change of light, not motion and not a flash, so it is the same with reduced motion.
//
// Without passthrough (an opaque VR session, the 2D page) the shell shows the virtual room instead: a dark studio
// dome with a floor and a warm pool of light under the box, two draw calls; the veil dims it the same way.
//
// One draw call for the veil while the room is dimmed, none at full light. Nothing allocates per frame.
import {
  AddEquation,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SphereGeometry,
  SrcAlphaFactor,
  type Vector3,
} from "@iwsdk/core";
import { smoothstep } from "./fx/ease";
import { ROOM } from "./theme";

/** How much light the room has: full, menus open, a box in play. */
export type RoomLight = "up" | "menu" | "play";

export const THEATRE = {
  /** The veil's radius round the head (m). */
  radiusM: 3,
  fadeS: ROOM.fadeS,
  /** Veil opacity per light: what the room loses. */
  opacity: { up: 0, menu: 1 - ROOM.menu, play: 1 - ROOM.play } as const,
  /** Drawn first of all (the studio just before it), ahead of the hand mask (-10). */
  renderOrder: -100,
  /** The virtual room: its dome (m, centred at head height over the box) and floor. */
  domeRadiusM: 4.5,
  floorRadiusM: 4.4,
  headHeightM: 1.2,
  /** The warm pool on the floor under the box (m). */
  poolRadiusM: 1.6,
} as const;

/**
 * The light for a screen and the box: every screen but play is a menu (half way); in play the room is dimmed, and
 * full again once the box has opened (until the next box starts).
 */
export function roomLightFor(screen: string, boxOpen = false): RoomLight {
  if (screen !== "play") return "menu";
  return boxOpen ? "up" : "play";
}

/**
 * The room's light as the game moves on: the screen (a menu or play) and whether the box in play has opened (the
 * `box-open` event; a new box closes it, before its play screen: Shell.boxBegins, and its `box-start` again). Sets
 * the theatre's light and says when it changed (the theatre's sounds), from and to.
 */
export class RoomLights {
  private screenNow = "boot";
  private open = false;

  constructor(
    private readonly theatre: Theatre,
    private readonly changed?: (from: RoomLight, to: RoomLight) => void,
  ) {}

  screen(to: string): void {
    this.screenNow = to;
    this.apply();
  }

  boxOpen(open: boolean): void {
    this.open = open;
    this.apply();
  }

  private apply(): void {
    const from = this.theatre.light, to = roomLightFor(this.screenNow, this.open);
    if (to === from) return;
    this.theatre.setLight(to);
    this.changed?.(from, to);
  }
}

/** Linear RGB of an sRGB hex colour, written into `out` at `i`. */
function put(out: Float32Array, i: number, c: Color): void {
  out[i * 3] = c.r;
  out[i * 3 + 1] = c.g;
  out[i * 3 + 2] = c.b;
}

/** The studio dome: charcoal above, a cool band at the horizon, dark below; vertex colours, dithered. */
function domeGeometry(): BufferGeometry {
  const g = new SphereGeometry(THEATRE.domeRadiusM, 48, 24);
  const pos = g.getAttribute("position"), col = new Float32Array(pos.count * 3);
  const S = ROOM.studio, top = new Color(S.top), mid = new Color(S.horizon), low = new Color(S.floor), c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const e = pos.getY(i) / THEATRE.domeRadiusM;
    if (e >= 0) c.copy(mid).lerp(top, smoothstep(0.05, 0.75, e));
    else c.copy(mid).lerp(low, smoothstep(0, 0.3, -e));
    put(col, i, c);
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g.translate(0, THEATRE.headHeightM, 0);
}

/** The studio floor, facing up: dark, with a warm pool of light under the box fading out over rings. */
function floorGeometry(): BufferGeometry {
  const rings = 12, seg = 64, verts: number[] = [], cols: number[] = [], idx: number[] = [];
  const S = ROOM.studio, glow = new Color(S.glow), floor = new Color(S.floor), c = new Color();
  for (let r = 0; r <= rings; r++) {
    const rad = (THEATRE.floorRadiusM * r) / rings;
    const k = 1 - smoothstep(0, THEATRE.poolRadiusM, rad);
    c.copy(floor).lerp(glow, k * k);
    const n = r === 0 ? 1 : seg;
    for (let s = 0; s < n; s++) {
      const a = (s / seg) * Math.PI * 2;
      verts.push(Math.cos(a) * rad, 0, -Math.sin(a) * rad);
      cols.push(c.r, c.g, c.b);
    }
  }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + s, 1 + ((s + 1) % seg));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg, b0 = 1 + r * seg;
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      idx.push(a0 + s, b0 + s, b0 + s1, a0 + s, b0 + s1, a0 + s1);
    }
  }
  const g = new BufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(cols), 3));
  return g;
}

export class Theatre {
  /** The veil over the room: an inside-out sphere round the head (add it to the scene). */
  readonly veil: Mesh;
  /** The virtual room for sessions without passthrough (add it to the scene; the shell shows or hides it). */
  readonly room = new Group();
  private lightNow: RoomLight = "up";
  private enabled = true;
  private value = 0;
  private from = 0;
  private to = 0;
  private t = 0;
  private readonly mat: MeshBasicMaterial;

  constructor() {
    // Blended over what is there (normal alpha blending, written out), but in the opaque pass: drawn first of all,
    // before the hand mask, so the room behind a real hand dims too (the mask's capsules are wider than the hand;
    // undimmed, they would cut a bright halo out of the dark room round it).
    this.mat = new MeshBasicMaterial({
      color: ROOM.veil,
      side: BackSide,
      transparent: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.veil = new Mesh(new SphereGeometry(THEATRE.radiusM, 32, 16), this.mat);
    this.veil.name = "Theatre Veil";
    this.veil.renderOrder = THEATRE.renderOrder;
    // It surrounds the eye: never culled, never drawn at full light.
    this.veil.frustumCulled = false;
    this.veil.visible = false;

    const studio = new MeshBasicMaterial({ vertexColors: true, side: BackSide, toneMapped: false, dithering: true });
    const dome = new Mesh(domeGeometry(), studio);
    dome.name = "Theatre Dome";
    const floor = new Mesh(floorGeometry(), new MeshBasicMaterial({ vertexColors: true, toneMapped: false, dithering: true }));
    floor.name = "Theatre Floor";
    for (const m of [dome, floor]) {
      m.frustumCulled = false;
      // Drawn before the veil, which writes no depth and must lie over it.
      m.renderOrder = THEATRE.renderOrder - 1;
    }
    this.room.name = "Theatre Room";
    this.room.add(dome, floor);
  }

  /** The light the room heads to (whatever dimming is set to). */
  get light(): RoomLight {
    return this.lightNow;
  }

  /** The veil's opacity now: the share of the room's light it takes. */
  get opacity(): number {
    return this.value;
  }

  /** Dim the room for a box in play, or bring the light back up (the box opened). */
  dim(on: boolean): void {
    this.setLight(on ? "play" : "up");
  }

  setLight(light: RoomLight): void {
    if (light === this.lightNow) return;
    this.lightNow = light;
    this.retarget();
  }

  /** Room dimming on or off (the setting): off, the room stays at full light. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.retarget();
  }

  /** Put the virtual room's floor under the box (world metres; the floor is y = 0). */
  placeRoom(x: number, z: number): void {
    this.room.position.set(x, 0, z);
  }

  /** Per frame: the fade by `dt` seconds, and the veil round the head (world metres) when given. */
  update(dt: number, head?: Readonly<Vector3>): void {
    if (head) this.veil.position.copy(head);
    if (this.value === this.to) return;
    this.t += dt > 0 ? dt : 0;
    this.value = this.t >= THEATRE.fadeS ? this.to : this.from + (this.to - this.from) * smoothstep(0, THEATRE.fadeS, this.t);
    this.mat.opacity = this.value;
    this.veil.visible = this.value > 0;
  }

  private retarget(): void {
    const to = this.enabled ? THEATRE.opacity[this.lightNow] : 0;
    if (to === this.to) return;
    this.from = this.value;
    this.to = to;
    this.t = 0;
  }
}
