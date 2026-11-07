import { describe, expect, it } from "vitest";
import { ProfileStore } from "../../src/app/profile-store";
import { SettingsStore } from "../../src/app/settings";
import { newProfile, type Profile } from "../../src/core/profile";
import type { Store } from "../../src/platform/store";

const ENV = { now: () => Date.UTC(2026, 10, 6, 12, 0, 0), build: "1.0.0" };

function memStore() {
  const saves: Profile[] = [];
  const store: Store = {
    persistent: true,
    load: async (nowMs, build) => newProfile(nowMs, build),
    save: async (p) => {
      saves.push(JSON.parse(JSON.stringify(p)));
    },
  };
  return { store, saves };
}

describe("settings", () => {
  it("reads the profile's settings", async () => {
    const ps = await ProfileStore.open(memStore().store, () => {}, ENV);
    const st = new SettingsStore(ps);
    expect(st.get().boxSizeCm).toBe(24);
    expect(st.get().sfxVol).toBe(0.9);
  });

  it("clamps, saves and tells subscribers", async () => {
    const m = memStore();
    const ps = await ProfileStore.open(m.store, () => {}, ENV);
    const st = new SettingsStore(ps);
    const seen: number[] = [];
    const off = st.subscribe((s) => seen.push(s.boxSizeCm));
    await st.set({ boxSizeCm: 45, musicVol: -1 });
    expect(st.get().boxSizeCm).toBe(30);
    expect(st.get().musicVol).toBe(0);
    expect(m.saves.at(-1)?.settings.boxSizeCm).toBe(30);
    off();
    await st.set({ boxSizeCm: 18 });
    expect(seen).toEqual([30]);
    expect(ps.profile.settings.boxSizeCm).toBe(18);
  });

  it("ignores values of the wrong type", async () => {
    const ps = await ProfileStore.open(memStore().store, () => {}, ENV);
    const st = new SettingsStore(ps);
    await st.set({ captions: "yes" as unknown as boolean, boxSizeCm: Number.NaN, handed: "both" as unknown as "left" });
    expect(st.get().captions).toBe(true);
    expect(st.get().boxSizeCm).toBe(24);
    expect(st.get().handed).toBe("right");
  });

  it("saves the language and tells subscribers; a language the game does not speak is auto", async () => {
    const m = memStore();
    const ps = await ProfileStore.open(m.store, () => {}, ENV);
    const st = new SettingsStore(ps);
    expect(st.get().language).toBe("auto");
    const seen: string[] = [];
    st.subscribe((s) => seen.push(s.language));
    await st.set({ language: "ja" });
    expect(m.saves.at(-1)?.settings.language).toBe("ja");
    await st.set({ language: "klingon" as unknown as "ja" });
    expect(st.get().language).toBe("auto");
    expect(seen).toEqual(["ja", "auto"]);
  });
});
