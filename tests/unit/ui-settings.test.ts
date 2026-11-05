import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/core/profile";
import { HOME, homeView, paintHome } from "../../src/ui/menus/home";
import { formatSetting, paintSettings, SETTINGS, settingAction, settingsView, sliderPosition, stepSetting } from "../../src/ui/menus/settings";
import { UI } from "../../src/ui/theme";
import { expectCleanCopy } from "./helpers/ui";

const recorder = () => {
  const calls: string[] = [];
  const ui = {
    text: (id: string, t: string) => calls.push(`text ${id} ${t}`),
    show: (id: string, on: boolean) => calls.push(`show ${id} ${on}`),
    fill: (id: string, c: string) => calls.push(`fill ${id} ${c}`),
    ink: (id: string, c: string) => calls.push(`ink ${id} ${c}`),
    edge: () => {},
    roll: () => {},
  };
  return { calls, ui };
};

describe("settings", () => {
  it("formats each value plainly", () => {
    expect(formatSetting("boxSizeCm", 24)).toBe("24 cm");
    expect(formatSetting("boxSizeCm", 18)).toBe("18 cm");
    expect(formatSetting("musicVol", 0.7)).toBe("70%");
    expect(formatSetting("musicVol", 0)).toBe("Off");
    expect(formatSetting("sfxVol", 0.9)).toBe("90%");
  });

  it("steps on a clean grid and stops at the profile's limits", () => {
    const s = defaultProfile().settings;
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
    const s = defaultProfile().settings;
    expect(settingAction("music-up", s)).toEqual({ musicVol: 0.8 });
    expect(settingAction("effects-down", s)).toEqual({ sfxVol: 0.8 });
    expect(settingAction("box-up", s)).toEqual({ boxSizeCm: 26 });
    expect(settingAction("toggle-captions", s)).toEqual({ captions: false });
    expect(settingAction("toggle-motion", s)).toEqual({ reducedMotion: true });
    expect(settingAction("toggle-dimming", { ...s, dimming: false })).toEqual({ dimming: true });
    expect(settingAction("settings-done", s)).toBeNull();
    expect(settingAction("settings-recenter", s)).toBeNull();
  });

  it("offers every key it paints", () => {
    expect(SETTINGS.keys).toEqual([
      "music-down",
      "music-up",
      "effects-down",
      "effects-up",
      "box-down",
      "box-up",
      "settings-recenter",
      "toggle-captions",
      "toggle-motion",
      "toggle-dimming",
      "settings-done",
    ]);
  });

  it("shows values, meter fill and the ends of each range", () => {
    const v = settingsView({ ...defaultProfile().settings, boxSizeCm: 30, musicVol: 0, reducedMotion: true });
    expect(v.sliders.find((x) => x.key === "boxSizeCm")).toMatchObject({ label: "Box size", value: "30 cm", fill: 1, atMax: true });
    expect(v.sliders.find((x) => x.key === "musicVol")).toMatchObject({ label: "Music", value: "Off", fill: 0, atMin: true });
    expect(v.sliders.map((x) => x.label)).toEqual(["Music", "Effects", "Box size"]);
    expect(v.toggles).toEqual([
      { id: "toggle-captions", label: "Captions", sub: "Text cues", on: true, state: "On" },
      { id: "toggle-motion", label: "Less motion", sub: "No bounce", on: true, state: "On" },
      { id: "toggle-dimming", label: "Dim room", sub: "In play", on: true, state: "On" },
    ]);
    expectCleanCopy(v);
  });

  it("keys at the end of their range are disabled (no click, no sound) until the value moves back", () => {
    const v = settingsView({ ...defaultProfile().settings, boxSizeCm: 18, sfxVol: 1, musicVol: 0 });
    expect([...v.disabled].sort()).toEqual(["box-down", "effects-up", "music-down"]);
    expect(settingsView(defaultProfile().settings).disabled).toEqual([]);
  });

  it("paints a dim stepper at its range end and a lit cap with On for a toggle that is on", () => {
    const { calls, ui } = recorder();
    paintSettings(ui, settingsView({ ...defaultProfile().settings, boxSizeCm: 18, captions: false }));
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
    const s = { ...defaultProfile().settings, musicVol: 0.5, boxSizeCm: 18, sfxVol: 1 };
    expect(sliderPosition("music-up", s)).toBeCloseTo(0.5, 9);
    expect(sliderPosition("box-down", s)).toBe(0);
    expect(sliderPosition("effects-up", s)).toBeCloseTo(1, 9);
    expect(sliderPosition("toggle-captions", s)).toBeNull();
    expect(sliderPosition("settings-done", s)).toBeNull();
  });
});

describe("home", () => {
  it("shows the storage notice only when there is one", () => {
    const a = recorder();
    paintHome(a.ui, homeView("Progress will not be saved on this device."));
    expect(a.calls).toEqual(["show home-notice true", "text home-notice-text Progress will not be saved on this device."]);
    const b = recorder();
    paintHome(b.ui, homeView(null));
    expect(b.calls).toEqual(["show home-notice false"]);
    expect(HOME.keys).toEqual(["home-recenter", "home-settings"]);
  });
});
