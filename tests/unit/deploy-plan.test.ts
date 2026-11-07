// scripts/deploy-pages.sh --print-plan: what each combination of options would publish, and what it refuses, without
// building, reading a secret or touching the network. NS_DEPLOY_NOW stands in for the clock (with --print-plan only),
// and every call sets it: a test without a time runs a second before the deadline, so no plan depends on the date.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const DEADLINE = 1795032000; // 2026-11-18 20:00 UTC

function plan(args: string[], now: number = DEADLINE - 1): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NS_DEPLOY_NOW: String(now) };
  const r = spawnSync("bash", ["scripts/deploy-pages.sh", "--print-plan", ...args], { encoding: "utf8", env });
  return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}

const ok = (args: string[], now: number = DEADLINE - 1) => {
  const r = plan(args, now);
  expect(r.status, r.out).toBe(0);
  return r.out;
};

describe("deploy-pages.sh plans", () => {
  it("--both: one build to the public and the judge host", () => {
    // Both hosts get the same files in one run, so the public host's card image works on both.
    expect(ok(["--both"])).toBe(
      "plan: mode=game projects=shadowlocks,shadowlocks-judge branch=main dry-run=no card-image=https://shadowlocks.pages.dev/og-image.jpg",
    );
  });

  it("--preview: the public project's preview branch only", () => {
    // The preview names its own card image, so its card works before production has the image.
    expect(ok(["--preview"])).toBe(
      "plan: mode=preview projects=shadowlocks branch=preview dry-run=no card-image=https://preview.shadowlocks.pages.dev/og-image.jpg",
    );
  });

  it("--placeholder: the public project's live site only", () => {
    expect(ok(["--placeholder"])).toBe("plan: mode=placeholder projects=shadowlocks branch=main dry-run=no");
  });

  it("--project: each project once, in order, on any branch", () => {
    expect(ok(["--project", "shadowlocks", "--project", "shadowlocks"])).toBe(
      "plan: mode=game projects=shadowlocks branch=main dry-run=no card-image=https://shadowlocks.pages.dev/og-image.jpg",
    );
    expect(ok(["--project", "shadowlocks-judge", "--project", "shadowlocks"])).toContain("projects=shadowlocks-judge,shadowlocks");
    expect(ok(["--project", "shadowlocks", "--branch", "try-1"])).toBe(
      "plan: mode=preview projects=shadowlocks branch=try-1 dry-run=no card-image=https://try-1.shadowlocks.pages.dev/og-image.jpg",
    );
    // One host: the card image is on it (Pages lowercases a branch and turns _ into -).
    expect(ok(["--project", "shadowlocks-judge"])).toContain(" card-image=https://shadowlocks-judge.pages.dev/og-image.jpg");
    expect(ok(["--project", "shadowlocks", "--branch", "Try_2"])).toContain(" card-image=https://try-2.shadowlocks.pages.dev/og-image.jpg");
    expect(ok(["--project", "shadowlocks-judge", "--project", "shadowlocks"])).toContain(" card-image=https://shadowlocks.pages.dev/og-image.jpg");
    expect(ok(["--both", "--dry-run"])).toContain("dry-run=yes");
  });

  it("refuses combinations that could touch a host they should not", () => {
    for (const args of [
      ["--preview", "--both"],
      ["--preview", "--project", "shadowlocks-judge"],
      ["--preview", "--branch", "main2"],
      ["--placeholder", "--both"],
      ["--placeholder", "--project", "shadowlocks-judge"],
      ["--placeholder", "--preview"],
      ["--placeholder", "--branch", "x"],
      ["--project", "Bad_Name"],
      ["--project", "shadowlocks", "--branch", "bad/branch"],
      [],
    ]) {
      expect(plan(args).status, args.join(" ")).toBe(2);
    }
    expect(plan(["--verify", "shadowlocks.pages.dev"]).out).toMatch(/not --verify or --check-token/);
    expect(plan(["--check-token"]).status).toBe(2);
  });

  it("freezes the judge host after the deadline, unless told otherwise; the public host and dry runs go on", () => {
    expect(ok(["--both"], DEADLINE - 1)).toContain("shadowlocks-judge");
    const late = plan(["--both"], DEADLINE);
    expect(late.status).toBe(2);
    expect(late.out).toMatch(/deadline has passed; shadowlocks-judge stays as the judges saw it/);
    expect(plan(["--project", "shadowlocks-judge", "--branch", "preview"], DEADLINE + 3600).status).toBe(2);
    expect(ok(["--both", "--judge-after-deadline"], DEADLINE + 3600)).toContain("shadowlocks-judge");
    expect(ok(["--project", "shadowlocks"], DEADLINE + 3600)).toContain("projects=shadowlocks ");
    expect(ok(["--preview"], DEADLINE + 3600)).toContain("mode=preview");
    expect(ok(["--both", "--dry-run"], DEADLINE + 3600)).toContain("dry-run=yes");
  });

  it("rejects a malformed stand-in clock", () => {
    expect(plan(["--both"], Number.NaN).status).toBe(2);
  });
});
