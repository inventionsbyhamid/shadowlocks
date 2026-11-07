// Settings: every field of the profile's Settings. The Language key (Automatic, then each language in
// its own name, and round), three stepped sliders (music, effects, box size: minus and plus keys around
// an LED meter), five latching toggles (warmth, captions, less motion, dim room, left hand), Recenter,
// Reset progress (it asks first, on its own panel) and Done. Every change applies live and is saved
// through the settings store, inside the profile's ranges. Words come from the language shown.
import { BOX_SIZE_CM, type Settings } from "../../core/profile";
import { type Copy, copy, formatCm, formatPercent, lang } from "../../i18n";
import { UI } from "../theme";
import { type LanguageRowView, languageRow, stepLanguage } from "./language";
import type { MenuSpec, PanelUi } from "./types";

export type SliderKey = "musicVol" | "sfxVol" | "boxSizeCm";
export type ToggleKey = "warmth" | "captions" | "reducedMotion" | "dimming" | "handed";

type Words = (c: Copy) => string;

interface SliderDef {
  key: SliderKey;
  /** Button id prefix: `<prefix>-down`, `<prefix>-up`. */
  prefix: string;
  label: Words;
  min: number;
  max: number;
  step: number;
}

/** Ranges match the profile loader (src/core/profile.ts `migrate`). */
export const SLIDERS: readonly SliderDef[] = [
  { key: "musicVol", prefix: "music", label: (c) => c.settings.music, min: 0, max: 1, step: 0.1 },
  { key: "sfxVol", prefix: "effects", label: (c) => c.settings.effects, min: 0, max: 1, step: 0.1 },
  { key: "boxSizeCm", prefix: "box", label: (c) => c.settings.boxSize, min: BOX_SIZE_CM.min, max: BOX_SIZE_CM.max, step: 2 },
];

/** The toggles, in panel order. "Left hand" is on for a left-handed player (the box mirrors). */
export const TOGGLES: readonly { id: string; key: ToggleKey; label: Words; sub: Words }[] = [
  { id: "toggle-warmth", key: "warmth", label: (c) => c.settings.warmth, sub: (c) => c.settings.warmthSub },
  { id: "toggle-captions", key: "captions", label: (c) => c.settings.captions, sub: (c) => c.settings.captionsSub },
  { id: "toggle-motion", key: "reducedMotion", label: (c) => c.settings.motion, sub: (c) => c.settings.motionSub },
  { id: "toggle-dimming", key: "dimming", label: (c) => c.settings.dimming, sub: (c) => c.settings.dimmingSub },
  { id: "toggle-hand", key: "handed", label: (c) => c.settings.hand, sub: (c) => c.settings.handSub },
];

/** The Language key: each poke steps to the next setting. */
export const LANGUAGE_KEY = "settings-language";

/** A toggle's state in the settings. */
export function toggleOn(s: Readonly<Settings>, key: ToggleKey): boolean {
  return key === "handed" ? s.handed === "left" : s[key];
}

/** LED segments in each slider's meter. */
export const METER_SEGMENTS = 10;

/** Reset progress asks first, on its own small panel: keep it (back to Settings) or reset. */
export const RESET: MenuSpec = {
  node: "reset-panel",
  screen: "reset",
  keys: ["reset-keep", "reset-confirm"],
};

export const SETTINGS: MenuSpec = {
  node: "settings-panel",
  screen: "settings",
  keys: [
    LANGUAGE_KEY,
    ...SLIDERS.flatMap((s) => [`${s.prefix}-down`, `${s.prefix}-up`]),
    "settings-recenter",
    "settings-reset",
    ...TOGGLES.map((t) => t.id),
    "settings-done",
  ],
};

const def = (key: SliderKey): SliderDef => SLIDERS.find((s) => s.key === key) as SliderDef;

/** A slider's value the language's way: "24 cm", "70%" ("70 %" in French), or the word for a volume at zero. */
export function formatSetting(key: SliderKey, v: number): string {
  switch (key) {
    case "boxSizeCm":
      return formatCm(Math.round(v));
    default:
      return v <= 0.001 ? copy().settings.muted : formatPercent(v);
  }
}

/** One step up or down on the slider's grid, clamped to its range. */
export function stepSetting(s: Readonly<Settings>, key: SliderKey, dir: 1 | -1): Partial<Settings> {
  const d = def(key);
  const index = (s[key] - d.min) / d.step;
  // Off grid values move to the next grid point in that direction.
  const at = Math.abs(index - Math.round(index)) < 1e-6 ? Math.round(index) + dir : dir > 0 ? Math.ceil(index) : Math.floor(index);
  const steps = Math.round((d.max - d.min) / d.step);
  const clamped = Math.min(steps, Math.max(0, at));
  const value = Math.round((d.min + clamped * d.step) * 1000) / 1000;
  return { [key]: value } as Partial<Settings>;
}

/** The change a settings key asks for, or null for keys that only navigate or act. */
export function settingAction(id: string, s: Readonly<Settings>): Partial<Settings> | null {
  if (id === LANGUAGE_KEY) return { language: stepLanguage(s.language, 1) };
  for (const d of SLIDERS) {
    if (id === `${d.prefix}-up`) return stepSetting(s, d.key, 1);
    if (id === `${d.prefix}-down`) return stepSetting(s, d.key, -1);
  }
  const t = TOGGLES.find((x) => x.id === id);
  if (!t) return null;
  if (t.key === "handed") return { handed: s.handed === "left" ? "right" : "left" };
  return { [t.key]: !s[t.key] } as Partial<Settings>;
}

/** For a slider's step key (`<prefix>-up` / `-down`): where its value sits in the range (0..1); else null. */
export function sliderPosition(id: string, s: Readonly<Settings>): number | null {
  for (const d of SLIDERS) {
    if (id !== `${d.prefix}-up` && id !== `${d.prefix}-down`) continue;
    return Math.min(1, Math.max(0, (s[d.key] - d.min) / (d.max - d.min)));
  }
  return null;
}

export interface SliderView {
  key: SliderKey;
  prefix: string;
  label: string;
  value: string;
  /** 0..1 along the range. */
  fill: number;
  atMin: boolean;
  atMax: boolean;
}

export interface SettingsView {
  /** The Language key: "Automatic" (with the language it picked) or a language in its own name. */
  language: LanguageRowView;
  sliders: SliderView[];
  toggles: { id: string; label: string; sub: string; on: boolean; state: string }[];
  /** Stepper keys at the end of their range: they move under the finger but never click. */
  disabled: string[];
}

export function settingsView(s: Readonly<Settings>): SettingsView {
  const c = copy();
  return {
    language: languageRow(s.language, lang(), c),
    sliders: SLIDERS.map((d) => {
      const v = s[d.key];
      const fill = Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min)));
      return {
        key: d.key,
        prefix: d.prefix,
        label: d.label(c),
        value: formatSetting(d.key, v),
        fill,
        atMin: v <= d.min + 1e-6,
        atMax: v >= d.max - 1e-6,
      };
    }),
    toggles: TOGGLES.map((t) => {
      const on = toggleOn(s, t.key);
      return { id: t.id, label: t.label(c), sub: t.sub(c), on, state: on ? c.settings.on : c.settings.off };
    }),
    disabled: SLIDERS.flatMap((d) => {
      const v = s[d.key];
      const out: string[] = [];
      if (v <= d.min + 1e-6) out.push(`${d.prefix}-down`);
      if (v >= d.max - 1e-6) out.push(`${d.prefix}-up`);
      return out;
    }),
  };
}

export function paintSettings(ui: PanelUi, v: SettingsView): void {
  ui.text(`${LANGUAGE_KEY}-value`, v.language.value);
  ui.show(`${LANGUAGE_KEY}-sub`, v.language.sub !== "");
  if (v.language.sub !== "") ui.text(`${LANGUAGE_KEY}-sub`, v.language.sub);
  for (const sl of v.sliders) {
    ui.text(`${sl.prefix}-value`, sl.value);
    const lit = Math.round(sl.fill * METER_SEGMENTS);
    for (let i = 0; i < METER_SEGMENTS; i++) ui.fill(`${sl.prefix}-seg-${i}`, i < lit ? UI.ledOn : UI.ledOff);
    // A key at the end of its range dims its mark (it still moves, but never clicks).
    ui.fill(`${sl.prefix}-down-bar`, sl.atMin ? UI.stepperOff : UI.text);
    ui.fill(`${sl.prefix}-up-bar`, sl.atMax ? UI.stepperOff : UI.text);
    ui.fill(`${sl.prefix}-up-bar-v`, sl.atMax ? UI.stepperOff : UI.text);
  }
  // A toggle that is on lights up: a gold cap (the menus light the cap) with ink legends, an ink
  // dot (a gold one would vanish on the gold) and "On".
  for (const t of v.toggles) {
    ui.fill(`${t.id}-led`, t.on ? UI.ink : UI.ledOff);
    ui.text(`${t.id}-state`, t.state);
    ui.ink(`${t.id}-cap`, t.on ? UI.ink : UI.text);
    ui.ink(`${t.id}-sub`, t.on ? UI.inkSoft : UI.textOnGraphiteDim);
  }
}
