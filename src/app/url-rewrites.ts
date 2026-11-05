// One place to send asset URLs elsewhere (self-hosted input-profile models, KTX2/DRACO decoders...).
// IWSDK loads glTF, textures and decoders through AssetManager.loadingManager, which takes a single
// URL modifier; main.ts installs this registry as that modifier, and features add their rewrites:
//   import { addUrlRewrite } from "./url-rewrites";
//   addUrlRewrite((url) => url.startsWith(CDN) ? LOCAL + url.slice(CDN.length) : url);
// Rewrites run in the order added; each gets the previous one's result and returns the URL unchanged
// when it does not apply. Do not call setURLModifier on the loading manager anywhere else.

export type UrlRewrite = (url: string) => string;

export interface UrlModifierTarget {
  setURLModifier(fn?: (url: string) => string): unknown;
}

export function createUrlRewrites() {
  let list: UrlRewrite[] = [];
  const rewrite = (url: string): string => {
    let u = url;
    for (const fn of list) u = fn(u);
    return u;
  };
  return {
    rewrite,
    /** Add a rewrite; returns a function that removes it. */
    add(fn: UrlRewrite): () => void {
      list = [...list, fn];
      return () => {
        list = list.filter((x) => x !== fn);
      };
    },
    /** Make this registry the target's URL modifier (rewrites added later apply too). */
    install(target: UrlModifierTarget): void {
      target.setURLModifier(rewrite);
    },
  };
}

const app = createUrlRewrites();
export const addUrlRewrite = app.add;
export const rewriteUrl = app.rewrite;
export const installUrlRewrites = app.install;
