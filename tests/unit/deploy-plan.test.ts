// scripts/deploy-pages.sh --print-plan: what each combination of options would publish, and what it refuses, without
// building, reading a secret or touching the network. NS_DEPLOY_NOW stands in for the clock (with --print-plan only).
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const DEADLINE = 1795032000; // 2026-11-18 20:00 UTC

function plan(args: string[], now?: number): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (now !== undefined) env.NS_DEPLOY_NOW = String(now);
  else delete env.NS_DEPLOY_NOW;
  const r = spawnSync("bash", ["scripts/deploy-pages.sh", "--print-plan", ...args], { encoding: "utf8", env });
  return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}

const ok = (args: string[], now?: number) => {
  const r = plan(args, now);
  expect(r.status, r.out).toBe(0);
  return r.out;
};

describe("deploy-pages.sh plans", () => {
  it("--both: one build to the public and the judge host", () => {
    expect(ok(["--both"])).toBe("plan: mode=game projects=shadowlocks,shadowlocks-judge branch=main dry-run=no");
  });

  it("--preview: the public project's preview branch only", () => {
    expect(ok(["--preview"])).toBe("plan: mode=preview projects=shadowlocks branch=preview dry-run=no");
  });

  it("--placeholder: the public project's live site only", () => {
    expect(ok(["--placeholder"])).toBe("plan: mode=placeholder projects=shadowlocks branch=main dry-run=no");
  });

  it("--project: each project once, in order, on any branch", () => {
    expect(ok(["--project", "shadowlocks", "--project", "shadowlocks"])).toBe("plan: mode=game projects=shadowlocks branch=main dry-run=no");
    expect(ok(["--project", "shadowlocks-judge", "--project", "shadowlocks"])).toContain("projects=shadowlocks-judge,shadowlocks");
    expect(ok(["--project", "shadowlocks", "--branch", "try-1"])).toBe("plan: mode=preview projects=shadowlocks branch=try-1 dry-run=no");
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
