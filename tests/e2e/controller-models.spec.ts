// Controller models on the older Quests (src/app/input-profiles.ts). IWSDK draws a controller's model from the first
// profile the controller reports, and does not look further down the list when that model fails to load. IWER's
// Quest 2 profile reports oculus-touch-v3 and its Quest Pro profile meta-quest-touch-pro, as the real controllers do:
// both models ship in public/input-profiles/ and load from our own origin, as Quest 3's meta-quest-touch-plus does
// (boot.spec.ts).
import { emulateHeadset } from "./helpers/headset";
import { expect, test } from "./helpers/test";

/** What IWSDK's controller visual adapters hold for each hand: the profile reported, the one resolved, the model. */
interface Held {
  reported: string | null;
  resolved: string | null;
  model: boolean;
  attached: boolean;
  meshes: number;
}

for (const [device, profile] of [
  ["metaQuest2", "oculus-touch-v3"],
  ["metaQuestPro", "meta-quest-touch-pro"],
] as const) {
  test(`${device}'s controllers draw their ${profile} model, loaded from our own origin`, async ({ page, boot }) => {
    await emulateHeadset(page, device);
    const app = await boot();
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
    for (const hand of ["left", "right"]) expect(app.requested(`/input-profiles/${profile}/${hand}.glb`)).toBe(true);
    expect(app.foreignHosts()).toEqual([]);
    expect(app.consoleLines.filter((l) => l.includes("Failed to load visual asset"))).toEqual([]);
  });
}
