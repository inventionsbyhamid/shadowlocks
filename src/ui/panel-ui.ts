// UIKit side of a menu panel: element lookup, text and colour changes when a screen is painted,
// and count-up numbers. Values that move every frame go through signals, so a frame only assigns
// numbers or constant strings (no allocation in our code).
import { type Object3D, type Signal, signal, type UIKitMLAsset } from "@iwsdk/core";
import type { Lang } from "../i18n";
import { breakUnits } from "../render/label";
import { CountUp } from "./count-up";
import { applyBrandFonts, applyNames, FONT_FAMILIES, fontFamiliesFor } from "./fonts";
import type { MenuSpec, PanelUi } from "./menus/types";
import { MOTION } from "./motion";

/** The parts of a UIKit element the menus use. */
export interface UiEl extends Object3D {
  setProperties(p: Record<string, unknown>): void;
  /** Laid out size in UIKit units (mm here). */
  size?: { peek(): readonly [number, number] | undefined };
  isVisible?: { peek(): boolean };
  properties?: { value: Record<string, unknown> };
}

interface Roll {
  id: string;
  text: Signal<string>;
  counter: CountUp;
}

/**
 * Japanese text with a plain space at every place a line may break (the Japanese atlas draws it with no width). A
 * space already there is one the reader sees (between a number and its unit, "24 cm", or inside a Latin name), so
 * it becomes a no-break space first: it keeps its width and never breaks.
 */
export function japaneseBreaks(s: string): string {
  return breakUnits(s.replace(/ /g, " ")).join(" ");
}

/** Told when a count-up shows its next value (`k` of the way, 0..1) and when it lands (`done`). */
export type RollListener = (id: string, k: number, done: boolean) => void;

export class PanelView implements PanelUi {
  readonly root: UiEl;
  /** Fade of the whole panel (UIKit opacity, inherited by every element). */
  readonly opacity = signal(0);
  private readonly els = new Map<string, UiEl | null>();
  private readonly rolls = new Map<string, Roll>();
  private readonly rollList: Roll[] = [];
  /** Count-up steps and landings (ticks, and the sounds that land with a number). */
  onRoll: RollListener | null = null;

  constructor(
    readonly asset: UIKitMLAsset,
    /** The panel's spec (its keys are built by the menus). */
    readonly spec: MenuSpec,
  ) {
    this.root = asset.document.rootElement as unknown as UiEl;
    this.root.setProperties({ opacity: this.opacity, fontFamilies: FONT_FAMILIES });
    applyBrandFonts(this.root, "en");
    applyNames(this.root);
  }

  /** Japanese text gets a place to break between characters (see `text`). */
  private japanese = false;

  /** Draw in language `l`: its fonts for every family (Japanese draws all of them with the Japanese font). */
  setLanguage(l: Lang): void {
    const japanese = l === "ja";
    // Words that read the same either way ("24 cm") are written differently in Japanese: write every text again.
    if (japanese !== this.japanese) {
      for (const k of this.given.keys()) if (k.startsWith("t:")) this.given.delete(k);
      // The interface face is tracked; the Japanese font standing in for it is not.
      applyBrandFonts(this.root, l);
    }
    this.japanese = japanese;
    this.root.setProperties({ fontFamilies: fontFamiliesFor(l) });
  }

  el(id: string): UiEl | null {
    let e = this.els.get(id);
    if (e === undefined) {
      e = (this.asset.getElementById(id) as unknown as UiEl | null) ?? null;
      if (!e) console.warn(`menu element "${id}" is missing from "${this.asset.assetId}"`);
      this.els.set(id, e);
    }
    return e;
  }

  /**
   * Set an element's text. UIKit breaks lines only at a plain space; Japanese has none, so in Japanese a plain
   * space (drawn with no width by the Japanese atlas) goes wherever a line may break by the kinsoku rules: never
   * before a closing mark or small kana, never after an opening mark, never inside a Latin word.
   */
  text(id: string, s: string): void {
    if (!this.changed("t", id, s)) return;
    const shown = this.japanese ? japaneseBreaks(s) : s;
    this.written.set(id, shown);
    this.el(id)?.setProperties({ text: shown });
  }

  /** What `text` last put on an element (the layout check: on a Japanese panel only these may hold plain spaces). */
  wrote(id: string): string | null {
    return this.written.get(id) ?? null;
  }

  show(id: string, on: boolean): void {
    if (this.changed("d", id, on ? "flex" : "none")) this.el(id)?.setProperties({ display: on ? "flex" : "none" });
  }

  /** Seen or not, keeping its place in the layout (no relayout, unlike show). Children follow. */
  visible(id: string, on: boolean): void {
    if (this.changed("v", id, on ? "visible" : "hidden")) this.el(id)?.setProperties({ visibility: on ? "visible" : "hidden" });
  }

  fill(id: string, color: string): void {
    if (this.changed("f", id, color)) this.el(id)?.setProperties({ backgroundColor: color });
  }

  ink(id: string, color: string): void {
    if (this.changed("i", id, color)) this.el(id)?.setProperties({ color });
  }

  edge(id: string, color: string): void {
    if (this.changed("e", id, color)) this.el(id)?.setProperties({ borderColor: color });
  }

  /** What each element was last given, per property: a paint writes only what changed (no relayout for nothing). */
  private readonly given = new Map<string, string>();
  private readonly written = new Map<string, string>();

  private changed(kind: string, id: string, value: string): boolean {
    const k = `${kind}:${id}`;
    if (this.given.get(k) === value) return false;
    this.given.set(k, value);
    return true;
  }

  roll(id: string, steps: readonly string[], delayS: number): void {
    let r = this.rolls.get(id);
    if (!r) {
      const el = this.el(id);
      if (!el) return;
      r = { id, text: signal(""), counter: new CountUp() };
      el.setProperties({ text: r.text });
      this.rolls.set(id, r);
      this.rollList.push(r);
    }
    r.counter.start(steps, MOTION.countUp.ms, delayS);
    r.text.value = r.counter.text;
    // Nothing to count (the value did not change): it has landed already.
    if (r.counter.done) this.onRoll?.(id, 1, true);
  }

  /** Per frame: advance count-ups. Allocation free. */
  step(dt: number, reduced: boolean): void {
    for (let i = 0; i < this.rollList.length; i++) {
      const r = this.rollList[i] as Roll;
      if (r.counter.done) continue;
      if (reduced) r.counter.finish();
      else if (!r.counter.step(dt)) continue;
      r.text.value = r.counter.text;
      this.onRoll?.(r.id, r.counter.progress, r.counter.done);
    }
  }

  get rolling(): boolean {
    for (const r of this.rollList) if (!r.counter.done) return true;
    return false;
  }

  finishRolls(): void {
    for (const r of this.rollList) {
      r.counter.finish();
      r.text.value = r.counter.text;
    }
  }

  /**
   * Text shown by an element (tests): a count-up, its own text or its first text child. Null when
   * the element is missing or not shown.
   */
  textOf(id: string): string | null {
    const el = this.el(id);
    if (!el || el.isVisible?.peek() === false) return null;
    const r = this.rolls.get(id);
    if (r) return r.text.value;
    const own = el.properties?.value.text;
    if (typeof own === "string") return own;
    for (const c of el.children) {
      const t = (c as UiEl).properties?.value.text;
      if (typeof t === "string") return t;
    }
    return null;
  }
}
