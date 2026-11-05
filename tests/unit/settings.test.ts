import { describe, expect, it } from "vitest";
import { ProfileStore } from "../../src/app/profile-store";
import { SettingsStore } from "../../src/app/settings";
import { defaultProfile, type Profile } from "../../src/core/profile";
import type { Store } from "../../src/platform/store";

function memStore() {
  const saves: Profile[] = [];
  const store: Store = {
    persistent: true,
    load: async () => defaultProfile(),
    save: async (p) => {
      saves.push(JSON.parse(JSON.stringify(p)));
    },
  };
  return { store, saves };
}

describe("settings", () => {
  it("reads the profile's settings", async () => {
    const ps = await ProfileStore.open(memStore().store, () => {});
    const st = new SettingsStore(ps);
    expect(st.get().boxSizeCm).toBe(24);
    expect(st.get().sfxVol).toBe(0.9);
  });

  it("clamps, saves and tells subscribers", async () => {
    const m = memStore();
    const ps = await ProfileStore.open(m.store, () => {});
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
    const ps = await ProfileStore.open(memStore().store, () => {});
    const st = new SettingsStore(ps);
    await st.set({ captions: "yes" as unknown as boolean, boxSizeCm: Number.NaN, handed: "both" as unknown as "left" });
    expect(st.get().captions).toBe(true);
    expect(st.get().boxSizeCm).toBe(24);
    expect(st.get().handed).toBe("right");
  });
});
