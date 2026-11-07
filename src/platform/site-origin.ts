// Build-time only (vite.config.ts): the origin index.html's absolute link card image URLs name. Scrapers need an
// absolute og:image that answers on the host that was shared, so scripts/deploy-pages.sh builds with VITE_SITE_ORIGIN
// set to the one host it publishes to (the preview names itself); any other build names the public host. The
// canonical URL and og:url are always the public host, written in index.html itself.

/** The public host: the canonical URL, and the default origin of the link card image. */
export const PUBLIC_ORIGIN = "https://shadowlocks.pages.dev";

/** VITE_SITE_ORIGIN when given (https://<host>, nothing after it), else the public host. */
export function siteOrigin(value: string | undefined): string {
  if (!value) return PUBLIC_ORIGIN;
  if (!/^https:\/\/[a-z0-9.-]+$/.test(value)) throw new Error(`VITE_SITE_ORIGIN must be https://<host>, nothing after it: ${value}`);
  return value;
}
