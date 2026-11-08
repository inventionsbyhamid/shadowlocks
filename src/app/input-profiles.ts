// IWSDK loads hand and controller models from the WebXR input profiles on a CDN. The game must
// run offline after the first load, so main.ts adds this as a URL rewrite (url-rewrites.ts) that
// sends them to our own origin (public/input-profiles/, precached like the rest of the build).
//
// How IWSDK 1.1 picks a controller's model (@iwsdk/xr-input loadInputProfile): the first id in the
// input source's own `profiles` list that its bundled profile registry knows (every profile of
// @webxr-input-profiles/assets 1.0, so in practice the first), then `<that id>/<hand>.glb` from the CDN.
// A model that fails to load is not looked for further down the list: the controller is tracked
// without one (a console warning). So each controller's first profile ships here, or is drawn with one that does:
//   - meta-quest-touch-plus: Quest 3 and 3S, whose Touch Plus controllers report it first (as IWER's Quest 3 does);
//   - meta-quest-touch-plus-v2: the Quest 3S Xbox Edition's controllers, drawn with meta-quest-touch-plus's model
//     (MODEL_STANDINS);
//   - meta-quest-touch-pro: Quest Pro;
//   - oculus-touch-v3: Quest 2;
//   - generic-hand: every tracked hand.
// Anything else has no model, only its ray: an older or another maker's controller.

/** IWSDK's DEFAULT_PROFILES_PATH (@iwsdk/xr-input). */
export const INPUT_PROFILES_CDN = "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles";

/**
 * Profiles drawn with another's model, by folder: the same controller in another finish, whose own model is too big
 * to ship. meta-quest-touch-plus-v2 is the Quest 3S Xbox Edition's Touch Plus (the registry's note on the profile):
 * the same layout as meta-quest-touch-plus (its buttons, axes and their nodes; the registry names that profile its
 * first fallback), but its model is 1.6 MB of textures, which took code and art to 5,185,044 bytes Brotli, over the
 * 5 MB budget (Task 29).
 */
export const MODEL_STANDINS: ReadonlyMap<string, string> = new Map([["meta-quest-touch-plus-v2", "meta-quest-touch-plus"]]);

export function localInputProfileUrl(url: string, base: string): string {
  if (!url.startsWith(`${INPUT_PROFILES_CDN}/`)) return url;
  const path = url.slice(INPUT_PROFILES_CDN.length + 1);
  const slash = path.indexOf("/");
  const standIn = slash > 0 ? MODEL_STANDINS.get(path.slice(0, slash)) : undefined;
  return `${base.replace(/\/+$/, "")}/${standIn ? standIn + path.slice(slash) : path}`;
}
