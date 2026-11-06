// Which edition this copy of the game is, from the host that serves it, and how the host behaves.
// The store link and the store app are the "store" edition; the judges' host, unknown hosts and
// localhost are the "judge" edition, which is always fully unlocked. The installed Quest apps (store
// and competition) carry the Digital Goods API: they skip the landing page and enter XR at once.
// The paywall is off in every v1 release (PAYWALL_ON); only a test build may force it on, with
// fake billing, through the address (`?edition=store&paywall=1&billing=app`).
import type { Edition } from "../core/entitlement";

/** The store edition's hosts (Cloudflare Pages, ship steps section 1). */
export const STORE_HOSTS: readonly string[] = ["shadowlocks.pages.dev"];
/** The judges' hosts. Every host not listed in STORE_HOSTS is the judge edition anyway. */
export const JUDGE_HOSTS: readonly string[] = ["shadowlocks-judge.pages.dev"];

/**
 * Where "Get it on the Meta Horizon Store" goes (a browser's trial screen, paywall update only): the
 * store's web listing. The paywall update replaces it with the game's own page once it has one.
 */
export const STORE_PAGE_URL = "https://www.meta.com/experiences/";

/**
 * Fake billing a test build can ask for: `app` the installed app with billing that sells,
 * `owned` the installed app where the full game is already bought, `web` a browser without billing.
 */
export type TestBilling = "app" | "owned" | "web";

/** What a test build's address may set. Absent fields follow the real rules. */
export interface TestOverrides {
  edition?: Edition;
  paywall?: boolean;
  billing?: TestBilling;
}

/** A host name as compared: lower case, without a trailing dot. */
function host(loc: Partial<Pick<Location, "hostname">>): string {
  return (loc.hostname ?? "").toLowerCase().replace(/\.$/, "");
}

/** The edition for the page at `loc`: a STORE_HOSTS host is the store; anything else is the judge. */
export function detectEdition(loc: Partial<Pick<Location, "hostname">>, over: TestOverrides | null = null): Edition {
  if (over?.edition) return over.edition;
  return STORE_HOSTS.includes(host(loc)) ? "store" : "judge";
}

/** The installed Quest app (a TWA exposes the Digital Goods API); a plain browser is not. */
export function installedApp(win: Window): boolean {
  return "getDigitalGoodsService" in win;
}

/** The landing page shows on the hosted link only: the installed apps go straight into XR. */
export function showLanding(win: Window): boolean {
  return !installedApp(win);
}

/** The paywall for this run: `paywallOn` (PAYWALL_ON), unless a test build forces it. */
export function paywallFor(paywallOn: boolean, over: TestOverrides | null): boolean {
  return over?.paywall ?? paywallOn;
}

/**
 * A test build's overrides from the address (`?edition=store|judge`, `?paywall=1|0`,
 * `?billing=app|owned|web`); null in any other build, so production never reads them.
 */
export function testOverrides(search: string, testBuild: boolean): TestOverrides | null {
  if (!testBuild) return null;
  const q = new URLSearchParams(search);
  const out: TestOverrides = {};
  const ed = q.get("edition");
  if (ed === "store" || ed === "judge") out.edition = ed;
  const pw = q.get("paywall");
  if (pw === "1") out.paywall = true;
  else if (pw === "0") out.paywall = false;
  const b = q.get("billing");
  if (b === "app" || b === "owned" || b === "web") out.billing = b;
  return out;
}
