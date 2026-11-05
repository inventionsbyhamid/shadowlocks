import { describe, expect, it } from "vitest";
import { createUrlRewrites } from "../../src/app/url-rewrites";

describe("url rewrites", () => {
  it("applies every rewrite in order and leaves other URLs alone", () => {
    const r = createUrlRewrites();
    r.add((u) => u.replace("https://cdn.example/", "./local/"));
    r.add((u) => (u.endsWith(".ktx2") ? `${u}?v=1` : u));
    expect(r.rewrite("https://cdn.example/a.ktx2")).toBe("./local/a.ktx2?v=1");
    expect(r.rewrite("./ui/home.uikitml")).toBe("./ui/home.uikitml");
  });

  it("removes a rewrite", () => {
    const r = createUrlRewrites();
    const off = r.add((u) => `${u}!`);
    off();
    expect(r.rewrite("x")).toBe("x");
  });

  it("owns the loading manager's URL modifier and picks up rewrites added later", () => {
    const r = createUrlRewrites();
    let modifier: ((u: string) => string) | undefined;
    r.install({ setURLModifier: (fn?: (u: string) => string) => (modifier = fn) });
    r.add((u) => u.toUpperCase());
    expect(modifier?.("abc")).toBe("ABC");
  });
});
