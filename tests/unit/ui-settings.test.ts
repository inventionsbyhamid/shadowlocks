import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "../../src/core/profile";
import { formatSetting, paintSettings, RESET, SETTINGS, settingAction, settingsView, sliderPosition, stepSetting } from "../../src/ui/menus/settings";
import { UI } from "../../src/ui/theme";
import { expectCleanCopy, recorder } from "./helpers/ui";

describe("settings", () => {
  it("formats each value plainly", () => {
    expect(formatSetting("boxSizeCm", 24)).toBe("24 cm");
    expect(formatSetting("boxSizeCm", 18)).toBe("18 cm");
    expect(formatSetting("musicVol", 0.7)).toBe("70%");
    expect(formatSetting("musicVol", 0)).toBe("Off");
    expect(formatSetting("sfxVol", 0.9)).toBe("90%");
  });

  it("steps on a clean grid and stops at the profile's limits", () => {
    const s = defaultSettings();
    expect(stepSetting(s, "boxSizeCm", 1)).toEqual({ boxSizeCm: 26 });
    expect(stepSetting(s, "boxSizeCm", -1)).toEqual({ boxSizeCm: 22 });
    expect(stepSetting({ ...s, boxSizeCm: 30 }, "boxSizeCm", 1)).toEqual({ boxSizeCm: 30 });
    expect(stepSetting({ ...s, boxSizeCm: 18 }, "boxSizeCm", -1)).toEqual({ boxSizeCm: 18 });
    expect(stepSetting({ ...s, musicVol: 0.1 }, "musicVol", -1)).toEqual({ musicVol: 0 });
    expect(stepSetting({ ...s, sfxVol: 0.95 }, "sfxVol", 1)).toEqual({ sfxVol: 1 });
    // Off grid values (an old profile) snap onto it.
    expect(stepSetting({ ...s, musicVol: 0.63 }, "musicVol", 1)).toEqual({ musicVol: 0.7 });
    expect(stepSetting({ ...s, boxSizeCm: 23 }, "boxSizeCm", -1)).toEqual({ boxSizeCm: 22 });
  });

  it("maps buttons to changes", () => {
    const s = defaultSettings();
    expect(settingAction("music-up", s)).toEqual({ musicVol: 0.8 });
    expect(settingAction("effects-down", s)).toEqual({ sfxVol: 0.8 });
    expect(settingAction("box-up", s)).toEqual({ boxSizeCm: 26 });
    expect(settingAction("toggle-captions", s)).toEqual({ captions: false });
    expect(settingAction("toggle-motion", s)).toEqual({ reducedMotion: true });
    expect(settingAction("toggle-dimming", { ...s, dimming: false })).toEqual({ dimming: true });
    expect(settingAction("toggle-warmth", s)).toEqual({ warmth: false });
    expect(settingAction("toggle-hand", s)).toEqual({ handed: "left" });
    expect(settingAction("toggle-hand", { ...s, handed: "left" })).toEqual({ handed: "right" });
    expect(settingAction("toggle-voice", s)).toEqual({ voice: false });
    expect(settingAction("toggle-voice", { ...s, voice: false })).toEqual({ voice: true });
    // The Language key steps to the next language, and round.
    expect(settingAction("settings-language", s)).toEqual({ language: "en" });
    expect(settingAction("settings-language", { ...s, language: "de" })).toEqual({ language: "pt-BR" });
    expect(settingAction("settings-language", { ...s, language: "ja" })).toEqual({ language: "auto" });
    expect(settingAction("settings-done", s)).toBeNull();
    expect(settingAction("settings-recenter", s)).toBeNull();
    expect(settingAction("settings-reset", s)).toBeNull();
  });

  it("has a row for every Settings field", () => {
    const fields = Object.keys(defaultSettings()).sort();
    const changed = new Set<string>();
    for (const id of SETTINGS.keys) for (const k of Object.keys(settingAction(id, defaultSettings()) ?? {})) changed.add(k);
    expect([...changed].sort()).toEqual(fields);
    // Reset progress asks first.
    expect(RESET.keys).toEqual(["reset-keep", "reset-confirm"]);
  });

  it("offers every key it paints", () => {
    expect(SETTINGS.keys).toEqual([
      "settings-language",
      "music-down",
      "music-up",
      "effects-down",
      "effects-up",
      "box-down",
      "box-up",
      "settings-recenter",
      "settings-reset",
      "toggle-warmth",
      "toggle-captions",
      "toggle-motion",
      "toggle-dimming",
      "toggle-hand",
      "toggle-voice",
      "settings-done",
    ]);
  });

  it("shows the language: Automatic with the language it picked, or a language in its own words; and paints it", () => {
    const auto = settingsView(defaultSettings());
    expect(auto.language).toEqual({ label: "Language", value: "Automatic", sub: "English" });
    const ja = settingsView({ ...defaultSettings(), language: "ja" });
    expect(ja.language).toEqual({ label: "Language", value: "日本語", sub: "" });
    const a = recorder();
    paintSettings(a.ui, ja);
    expect(a.calls).toContain("text settings-language-value 日本語");
    expect(a.calls).toContain("show settings-language-sub false");
  });

  it("shows values, meter fill and the ends of each range", () => {
    const v = settingsView({ ...defaultSettings(), boxSizeCm: 30, musicVol: 0, reducedMotion: true });
    expect(v.sliders.find((x) => x.key === "boxSizeCm")).toMatchObject({ label: "Box size", value: "30 cm", fill: 1, atMax: true });
    expect(v.sliders.find((x) => x.key === "musicVol")).toMatchObject({ label: "Music", value: "Off", fill: 0, atMin: true });
    expect(v.sliders.map((x) => x.label)).toEqual(["Music", "Effects", "Box size"]);
    expect(v.toggles).toEqual([
      { id: "toggle-warmth", label: "Warmth", sub: "Glow, hums", on: true, state: "On" },
      { id: "toggle-captions", label: "Captions", sub: "Text cues", on: true, state: "On" },
      { id: "toggle-motion", label: "Less motion", sub: "No bounce", on: true, state: "On" },
      { id: "toggle-dimming", label: "Dim room", sub: "In play", on: true, state: "On" },
      { id: "toggle-hand", label: "Left hand", sub: "Mirrored", on: false, state: "Off" },
      { id: "toggle-voice", label: "Voice guide", sub: "Spoken help", on: true, state: "On" },
    ]);
    const left: Settings = { ...defaultSettings(), handed: "left", warmth: false };
    expect(settingsView(left).toggles.find((t) => t.id === "toggle-hand")).toMatchObject({ on: true, state: "On" });
    expect(settingsView(left).toggles.find((t) => t.id === "toggle-warmth")).toMatchObject({ on: false, state: "Off" });
    expectCleanCopy(v);
  });

  it("keys at the end of their range are disabled (no click, no sound) until the value moves back", () => {
    const v = settingsView({ ...defaultSettings(), boxSizeCm: 18, sfxVol: 1, musicVol: 0 });
    expect([...v.disabled].sort()).toEqual(["box-down", "effects-up", "music-down"]);
    expect(settingsView(defaultSettings()).disabled).toEqual([]);
  });

  it("paints a dim stepper at its range end and a lit cap with On for a toggle that is on", () => {
    const { calls, ui } = recorder();
    paintSettings(ui, settingsView({ ...defaultSettings(), boxSizeCm: 18, captions: false }));
    expect(calls).toContain(`fill box-down-bar ${UI.stepperOff}`);
    expect(calls).toContain(`fill box-up-bar ${UI.text}`);
    expect(calls).toContain(`fill box-up-bar-v ${UI.text}`);
    expect(calls).toContain("text toggle-motion-state Off");
    expect(calls).toContain(`ink toggle-dimming-cap ${UI.ink}`);
    expect(calls).toContain("text toggle-captions-state Off");
    expect(calls).toContain(`ink toggle-captions-cap ${UI.text}`);
    expect(calls).toContain(`fill toggle-captions-led ${UI.ledOff}`);
    // Cap colours follow the key's state through the menus (KeyView.paintCap), never the painter.
    expect(calls.some((c) => /^fill \S+-cap /.test(c))).toBe(false);
    expect(calls.some((c) => c.includes("-state ") && !/ (On|Off)$/.test(c))).toBe(false);
  });
});

describe("slider position", () => {
  it("is where a step key's slider sits in its range, for the tick's pitch", () => {
    const s = { ...defaultSettings(), musicVol: 0.5, boxSizeCm: 18, sfxVol: 1 };
    expect(sliderPosition("music-up", s)).toBeCloseTo(0.5, 9);
    expect(sliderPosition("box-down", s)).toBe(0);
    expect(sliderPosition("effects-up", s)).toBeCloseTo(1, 9);
    expect(sliderPosition("toggle-captions", s)).toBeNull();
    expect(sliderPosition("settings-done", s)).toBeNull();
  });
});
