// IWSDK loads hand and controller models from the WebXR input profiles on a CDN. The game must
// run offline after the first load, so main.ts adds this as a URL rewrite (url-rewrites.ts) that
// sends them to our own origin (public/input-profiles/, precached like the rest of the build).
//
// How IWSDK 1.1 picks a controller's model (@iwsdk/xr-input loadInputProfile): the first id in the
// input source's own `profiles` list that its bundled profile registry knows (every profile of
// @webxr-input-profiles/assets 1.0, so in practice the first), then `<that id>/<hand>.glb` from the CDN.
// A model that fails to load is not looked for further down the list: the controller is tracked
// without one (a console warning). So each controller's first profile ships here:
//   - meta-quest-touch-plus: Quest 3 (and 3S, whose Touch Plus controllers IWER and the review take to report it);
//   - meta-quest-touch-pro: Quest Pro;
//   - oculus-touch-v3: Quest 2;
//   - generic-hand: every tracked hand.
// Anything else has no model, only its ray: an older or another maker's controller, or one whose first profile is
// newer than these (the assets' meta-quest-touch-plus-v2, which no IWER headset reports).

/** IWSDK's DEFAULT_PROFILES_PATH (@iwsdk/xr-input). */
export const INPUT_PROFILES_CDN = "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles";

export function localInputProfileUrl(url: string, base: string): string {
  if (!url.startsWith(`${INPUT_PROFILES_CDN}/`)) return url;
  return `${base.replace(/\/+$/, "")}/${url.slice(INPUT_PROFILES_CDN.length + 1)}`;
}
