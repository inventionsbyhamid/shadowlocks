// IWSDK loads hand and controller models from the WebXR input profiles on a CDN. The game must
// run offline after the first load, so main.ts adds this as a URL rewrite (url-rewrites.ts) that
// sends them to our own origin (public/input-profiles/: generic hand, Quest 3 controllers).
// Profiles we do not ship fail locally and render without a model.

/** IWSDK's DEFAULT_PROFILES_PATH (@iwsdk/xr-input). */
export const INPUT_PROFILES_CDN = "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles";

export function localInputProfileUrl(url: string, base: string): string {
  if (!url.startsWith(`${INPUT_PROFILES_CDN}/`)) return url;
  return `${base.replace(/\/+$/, "")}/${url.slice(INPUT_PROFILES_CDN.length + 1)}`;
}
