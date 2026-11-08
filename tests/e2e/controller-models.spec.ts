// Controller models beyond Quest 3's (src/app/input-profiles.ts). IWSDK draws a controller's model from the first
// profile the controller reports, and does not look further down the list when that model fails to load. IWER's
// Quest 2 profile reports oculus-touch-v3 and its Quest Pro profile meta-quest-touch-pro, as the real controllers do;
// the Quest 3S Xbox Edition's controllers report meta-quest-touch-plus-v2 (the registry's note for that profile), which
// no IWER profile does, so that case rewrites the emulated Quest 3's Touch Plus list. Each model ships in
// public/input-profiles/ and loads from our own origin, as Quest 3's meta-quest-touch-plus does (boot.spec.ts); the
// Xbox Edition's is drawn with that Touch Plus model (input-profiles.ts MODEL_STANDINS: its own is too big to ship).
import type { Page } from "@playwright/test";
import { emulateHeadset, emulateTouchPlusProfiles } from "./helpers/headset";
import { expect, test } from "./helpers/test";

/** What IWSDK's controller visual adapters hold for each hand: the profile reported, the one resolved, the model. */
interface Held {
  reported: string | null;
  resolved: string | null;
  model: boolean;
  attached: boolean;
  meshes: number;
}

/** The registry's list for the Xbox Edition's controllers: its own id, then what it falls back to. */
const TOUCH_PLUS_V2 = [
  "meta-quest-touch-plus-v2",
  "meta-quest-touch-plus",
  "oculus-touch-v3",
  "oculus-touch",
  "generic-trigger-squeeze-thumbstick",
] as const;

/** Each case's controllers, set up before boot; a rewrite of IWER's code says afterwards whether it applied. */
interface Case {
  name: string;
  /** The profile the controllers report first, and IWSDK resolves. */
  profile: string;
  /** The folder its model loads from. */
  model: string;
  emulate(page: Page): Promise<void | { applied(): boolean }>;
}

const CASES: readonly Case[] = [
  { name: "metaQuest2", profile: "oculus-touch-v3", model: "oculus-touch-v3", emulate: (page) => emulateHeadset(page, "metaQuest2") },
  {
    name: "metaQuestPro",
    profile: "meta-quest-touch-pro",
    model: "meta-quest-touch-pro",
    emulate: (page) => emulateHeadset(page, "metaQuestPro"),
  },
  {
    name: "the Quest 3S Xbox Edition",
    profile: "meta-quest-touch-plus-v2",
    model: "meta-quest-touch-plus",
    emulate: (page) => emulateTouchPlusProfiles(page, TOUCH_PLUS_V2),
  },
];

for (const { name, profile, model, emulate } of CASES) {
  test(`${name}'s controllers (${profile}) draw the ${model} model, loaded from our own origin`, async ({ page, boot }) => {
    const rewrite = await emulate(page);
    const app = await boot();
    if (rewrite) expect(rewrite.applied(), "IWER's Touch Plus config found and rewritten").toBe(true);
    await app.stepUntil(
      (ns) => {
        const c = (ns.world as unknown as { input: { visualAdapters: { controller: Record<string, { visual?: unknown }> } } }).input.visualAdapters
          .controller;
        return !!c.left?.visual && !!c.right?.visual;
      },
      { maxMs: 20_000, label: "both controllers' models loaded" },
    );
    const held = await page.evaluate((): Held[] => {
      interface Adapter {
        inputSource?: { profiles: readonly string[] };
        inputConfig?: { resolvedProfileId: string };
        visual?: { model: { parent: unknown; traverse(fn: (o: { isMesh?: boolean }) => void): void } };
      }
      const c = (window.__ns!.world as unknown as { input: { visualAdapters: { controller: Record<string, Adapter> } } }).input.visualAdapters
        .controller;
      return ["left", "right"].map((h) => {
        const a = c[h]!;
        let meshes = 0;
        a.visual?.model.traverse((o) => {
          if (o.isMesh) meshes++;
        });
        return {
          reported: a.inputSource?.profiles[0] ?? null,
          resolved: a.inputConfig?.resolvedProfileId ?? null,
          model: !!a.visual,
          attached: !!a.visual?.model.parent,
          meshes,
        };
      });
    });
    for (const h of held) {
      expect(h).toMatchObject({ reported: profile, resolved: profile, model: true, attached: true });
      expect(h.meshes).toBeGreaterThan(0);
    }
    for (const hand of ["left", "right"]) expect(app.requested(`/input-profiles/${model}/${hand}.glb`)).toBe(true);
    if (model !== profile) expect(app.requested(`/input-profiles/${profile}/`), "the profile's own folder, which does not ship").toBe(false);
    expect(app.foreignHosts()).toEqual([]);
    expect(app.consoleLines.filter((l) => l.includes("Failed to load visual asset"))).toEqual([]);
  });
}
