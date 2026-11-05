// Settings: three stepped sliders (minus and plus keys around an LED meter), Recenter and three
// toggles. Every change applies live and is saved through the settings store, inside the profile's
// ranges. (The full settings screen, with every field and Reset progress, comes with the menus pass.)
import { BOX_SIZE_CM, type Settings } from "../../core/profile";
import { COPY } from "../copy";
import { UI } from "../theme";
import type { MenuSpec, PanelUi } from "./types";

export type SliderKey = "musicVol" | "sfxVol" | "boxSizeCm";
export type ToggleKey = "captions" | "reducedMotion" | "dimming";

interface SliderDef {
  key: SliderKey;
  /** Button id prefix: `<prefix>-down`, `<prefix>-up`. */
  prefix: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Ranges match the profile loader (src/core/profile.ts `migrate`). */
export const SLIDERS: readonly SliderDef[] = [
  { key: "musicVol", prefix: "music", label: COPY.settings.music, min: 0, max: 1, step: 0.1 },
  { key: "sfxVol", prefix: "effects", label: COPY.settings.effects, min: 0, max: 1, step: 0.1 },
  { key: "boxSizeCm", prefix: "box", label: COPY.settings.boxSize, min: BOX_SIZE_CM.min, max: BOX_SIZE_CM.max, step: 2 },
];

export const TOGGLES: readonly { id: string; key: ToggleKey; label: string; sub: string }[] = [
  { id: "toggle-captions", key: "captions", label: COPY.settings.captions, sub: COPY.settings.captionsSub },
  { id: "toggle-motion", key: "reducedMotion", label: COPY.settings.motion, sub: COPY.settings.motionSub },
  { id: "toggle-dimming", key: "dimming", label: COPY.settings.dimming, sub: COPY.settings.dimmingSub },
];

/** LED segments in each slider's meter. */
export const METER_SEGMENTS = 10;

export const SETTINGS: MenuSpec = {
  node: "settings-panel",
  screen: "settings",
  keys: [...SLIDERS.flatMap((s) => [`${s.prefix}-down`, `${s.prefix}-up`]), "settings-recenter", ...TOGGLES.map((t) => t.id), "settings-done"],
};

const def = (key: SliderKey): SliderDef => SLIDERS.find((s) => s.key === key) as SliderDef;

export function formatSetting(key: SliderKey, v: number): string {
  switch (key) {
    case "boxSizeCm":
      return `${Math.round(v)} cm`;
    default:
      return v <= 0.001 ? COPY.settings.off : `${Math.round(v * 100)}%`;
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
  for (const d of SLIDERS) {
    if (id === `${d.prefix}-up`) return stepSetting(s, d.key, 1);
    if (id === `${d.prefix}-down`) return stepSetting(s, d.key, -1);
  }
  const t = TOGGLES.find((x) => x.id === id);
  if (t) return { [t.key]: !s[t.key] } as Partial<Settings>;
  return null;
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
  sliders: SliderView[];
  toggles: { id: string; label: string; sub: string; on: boolean; state: string }[];
  /** Stepper keys at the end of their range: they move under the finger but never click. */
  disabled: string[];
}

export function settingsView(s: Readonly<Settings>): SettingsView {
  return {
    sliders: SLIDERS.map((d) => {
      const v = s[d.key];
      const fill = Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min)));
      return {
        key: d.key,
        prefix: d.prefix,
        label: d.label,
        value: formatSetting(d.key, v),
        fill,
        atMin: v <= d.min + 1e-6,
        atMax: v >= d.max - 1e-6,
      };
    }),
    toggles: TOGGLES.map((t) => ({
      id: t.id,
      label: t.label,
      sub: t.sub,
      on: s[t.key],
      state: s[t.key] ? COPY.settings.on : COPY.settings.off,
    })),
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
  for (const sl of v.sliders) {
    ui.text(`${sl.prefix}-value`, sl.value);
    const lit = Math.round(sl.fill * METER_SEGMENTS);
    for (let i = 0; i < METER_SEGMENTS; i++) ui.fill(`${sl.prefix}-seg-${i}`, i < lit ? UI.ledOn : UI.ledOff);
    // A key at the end of its range dims its mark (it still moves, but never clicks).
    ui.fill(`${sl.prefix}-down-bar`, sl.atMin ? UI.stepperOff : UI.text);
    ui.fill(`${sl.prefix}-up-bar`, sl.atMax ? UI.stepperOff : UI.text);
    ui.fill(`${sl.prefix}-up-bar-v`, sl.atMax ? UI.stepperOff : UI.text);
  }
  // A toggle that is on lights up: a brass cap (the menus light the cap) with ink legends, an
  // amber LED and "On".
  for (const t of v.toggles) {
    ui.fill(`${t.id}-led`, t.on ? UI.ledOn : UI.ledOff);
    ui.text(`${t.id}-state`, t.state);
    ui.ink(`${t.id}-cap`, t.on ? UI.ink : UI.text);
    ui.ink(`${t.id}-sub`, t.on ? UI.inkSoft : UI.textOnGraphiteDim);
  }
}
