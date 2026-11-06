import { describe, expect, it } from "vitest";
import {
  detectEdition,
  installedApp,
  JUDGE_HOSTS,
  paywallFor,
  showLanding,
  STORE_HOSTS,
  testOverrides,
} from "../../src/app/edition";

const at = (url: string): Location => new URL(url) as unknown as Location;

describe("detectEdition", () => {
  it("knows the store and judge hosts", () => {
    expect(STORE_HOSTS).toEqual(["shadowlocks.pages.dev"]);
    expect(JUDGE_HOSTS).toEqual(["shadowlocks-judge.pages.dev"]);
  });

  it.each([
    ["https://shadowlocks.pages.dev/", "store"],
    ["https://shadowlocks.pages.dev/?box=3#x", "store"],
    ["https://SHADOWLOCKS.pages.dev/", "store"],
    ["https://shadowlocks.pages.dev./", "store"],
    ["https://shadowlocks-judge.pages.dev/", "judge"],
    ["http://localhost:8081/", "judge"],
    ["http://127.0.0.1:8082/", "judge"],
    ["https://example.com/", "judge"],
    // Preview deployments and look-alikes are not the store host: unknown, so fully unlocked.
    ["https://abc123.shadowlocks.pages.dev/", "judge"],
    ["https://shadowlocks.pages.dev.evil.example/", "judge"],
    ["https://notshadowlocks.pages.dev/", "judge"],
  ] as const)("%s is the %s edition", (url, ed) => {
    expect(detectEdition(at(url))).toBe(ed);
  });

  it("an empty or missing host is the judge edition", () => {
    expect(detectEdition({ hostname: "" } as Location)).toBe("judge");
    expect(detectEdition({} as Location)).toBe("judge");
  });
});

describe("the installed app and the landing page", () => {
  it("the Digital Goods API means the installed app (no landing page, straight into XR)", () => {
    const app = { getDigitalGoodsService: () => Promise.resolve(null) } as unknown as Window;
    const web = {} as Window;
    expect(installedApp(app)).toBe(true);
    expect(installedApp(web)).toBe(false);
    expect(showLanding(app)).toBe(false);
    expect(showLanding(web)).toBe(true);
  });
});

describe("the paywall switch", () => {
  it("follows PAYWALL_ON unless a test build forces it", () => {
    expect(paywallFor(false, null)).toBe(false);
    expect(paywallFor(true, null)).toBe(true);
    expect(paywallFor(false, { paywall: true })).toBe(true);
    expect(paywallFor(true, { paywall: false })).toBe(false);
  });
});

describe("test build overrides", () => {
  it("are read only in a test build", () => {
    expect(testOverrides("?edition=store&paywall=1&billing=owned", false)).toBeNull();
  });

  it("read the edition, the paywall and fake billing from the address", () => {
    expect(testOverrides("", true)).toEqual({});
    expect(testOverrides("?edition=store&paywall=1", true)).toEqual({ edition: "store", paywall: true });
    expect(testOverrides("?edition=judge&paywall=0", true)).toEqual({ edition: "judge", paywall: false });
    expect(testOverrides("?billing=app", true)).toEqual({ billing: "app" });
    expect(testOverrides("?billing=owned", true)).toEqual({ billing: "owned" });
    expect(testOverrides("?billing=web", true)).toEqual({ billing: "web" });
    // Anything else is ignored.
    expect(testOverrides("?edition=gold&billing=free&paywall=maybe", true)).toEqual({});
  });

  it("an edition override wins over the host", () => {
    expect(detectEdition(at("http://localhost:8081/"), { edition: "store" })).toBe("store");
    expect(detectEdition(at("https://shadowlocks.pages.dev/"), { edition: "judge" })).toBe("judge");
  });
});
