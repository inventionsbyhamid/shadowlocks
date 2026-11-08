import fs from "node:fs";
import path from "node:path";
// IWSDK's own profile resolution (@iwsdk/xr-input, a dependency of @iwsdk/core; its index pulls in the renderer side).
import { loadInputProfile } from "@iwsdk/xr-input/dist/gamepad/input-profiles.js";
import { describe, expect, it } from "vitest";
import { INPUT_PROFILES_CDN, localInputProfileUrl, MODEL_STANDINS } from "../../src/app/input-profiles";

const SHIPPED = "public/input-profiles";

/** IWSDK's pick for a controller reporting `profiles`: the resolved profile, its layout, and where we serve its model. */
function resolve(profiles: readonly string[], handedness: XRHandedness) {
  const r = loadInputProfile({ profiles, handedness } as unknown as XRInputSource);
  return { ...r, local: localInputProfileUrl(r.assetPath, SHIPPED) };
}

/**
 * What each Quest's controllers report (first id first). Quest 2, Pro and 3: IWER 2.7's configs. The Quest 3S Xbox
 * Edition: the registry's profile for it (meta-quest-touch-plus-v2, added for that headset) and its fallbacks.
 */
const QUESTS: Record<string, readonly string[]> = {
  "Quest 2": ["oculus-touch-v3", "oculus-touch", "generic-trigger-squeeze-thumbstick"],
  "Quest Pro": ["meta-quest-touch-pro", "oculus-touch-v2", "oculus-touch", "generic-trigger-squeeze-thumbstick"],
  "Quest 3 and 3S": ["meta-quest-touch-plus", "oculus-touch-v3", "oculus-touch", "generic-trigger-squeeze-thumbstick"],
  "Quest 3S Xbox Edition": [
    "meta-quest-touch-plus-v2",
    "meta-quest-touch-plus",
    "oculus-touch-v3",
    "oculus-touch",
    "generic-trigger-squeeze-thumbstick",
  ],
};

describe("local input profiles", () => {
  it("maps IWSDK's CDN profile models to our own origin", () => {
    expect(localInputProfileUrl(`${INPUT_PROFILES_CDN}/generic-hand/left.glb`, "./input-profiles")).toBe(
      "./input-profiles/generic-hand/left.glb",
    );
    expect(localInputProfileUrl(`${INPUT_PROFILES_CDN}/meta-quest-touch-plus/right.glb`, "/x/input-profiles/")).toBe(
      "/x/input-profiles/meta-quest-touch-plus/right.glb",
    );
  });

  it("draws the Quest 3S Xbox Edition's controllers with the Touch Plus model we ship", () => {
    for (const hand of ["left", "right"]) {
      expect(localInputProfileUrl(`${INPUT_PROFILES_CDN}/meta-quest-touch-plus-v2/${hand}.glb`, "./input-profiles")).toBe(
        `./input-profiles/meta-quest-touch-plus/${hand}.glb`,
      );
    }
    // Only that folder: a name that merely starts the same is left as it is.
    expect(localInputProfileUrl(`${INPUT_PROFILES_CDN}/meta-quest-touch-plus-v2x/left.glb`, "./input-profiles")).toBe(
      "./input-profiles/meta-quest-touch-plus-v2x/left.glb",
    );
    expect(localInputProfileUrl(`${INPUT_PROFILES_CDN}/meta-quest-touch-plus-v2`, "./input-profiles")).toBe(
      "./input-profiles/meta-quest-touch-plus-v2",
    );
  });

  it("every Quest's controllers resolve, through IWSDK, to a model we ship", () => {
    for (const [quest, profiles] of Object.entries(QUESTS)) {
      for (const hand of ["left", "right"] as const) {
        const r = resolve(profiles, hand);
        // IWSDK takes the first id its registry knows, with no fallback once the model fails: the first, here.
        expect(r.resolvedProfileId, quest).toBe(profiles[0]);
        expect(r.assetPath.startsWith(`${INPUT_PROFILES_CDN}/`), quest).toBe(true);
        expect(fs.existsSync(r.local), `${quest}, ${hand}: ${r.local}`).toBe(true);
      }
    }
  });

  it("a stand-in model has its profile's layout: the same buttons, axes and model nodes", () => {
    for (const [id, standIn] of MODEL_STANDINS) {
      expect(fs.existsSync(path.join(SHIPPED, id)), `${id} ships no folder of its own`).toBe(false);
      for (const hand of ["left", "right"] as const) {
        const own = resolve([id], hand);
        const shipped = resolve([standIn], hand);
        expect(own.resolvedProfileId).toBe(id);
        expect(own.local).toBe(shipped.local);
        expect(own.layout.components).toEqual(shipped.layout.components);
        expect(own.layout.selectComponentId).toBe(shipped.layout.selectComponentId);
        expect(own.layout.gamepadMapping).toBe(shipped.layout.gamepadMapping);
      }
    }
  });

  it("leaves every other URL alone", () => {
    for (const u of ["./ui/home.uikitml", "https://example.com/a.glb", "blob:abc", "data:,x"]) {
      expect(localInputProfileUrl(u, "./input-profiles")).toBe(u);
    }
  });
});
