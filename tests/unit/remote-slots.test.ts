// The shared e2e slots a run gets from scripts/remote.sh: the lock it sends the server (a stand-in ssh and rsync
// record it; nothing reaches a network), and remote-run.sh's shared hold (lock_shared, lifted out of the script) run
// against a scratch locks folder.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "remote-slots-"));
  dirs.push(d);
  return d;
}

/** A remote.sh constant, as written (NAME=value on a line of its own). */
function constant(name: string): string {
  const v = fs.readFileSync("scripts/remote.sh", "utf8").match(new RegExp(`^${name}=(\\S+)$`, "m"))?.[1];
  expect(v, name).toBeDefined();
  return v!;
}

/** printf %q's escapes, as they matter here: "\," and "\ ". */
const unq = (s: string) => (s === "''" ? "" : s.replace(/\\([, ])/g, "$1"));

/** What remote.sh sends the server for a run with these options: its docker run options and the lock it holds. */
function sent(opts: string[]): { docker: string; lock: string } {
  const bin = tmp();
  const calls = tmp();
  // ssh answers the gate (load 1.5, 300 GB free) and records every call; rsync does nothing.
  const ssh = 'n=$(ls "$CALLS" | wc -l)\nprintf \'%s\\n\' "$@" >"$CALLS/$n"\ncase "$*" in *loadavg*) printf \'1.5\\n300\\n\' ;; esac';
  fs.writeFileSync(path.join(bin, "ssh"), `#!/usr/bin/env bash\n${ssh}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "rsync"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, CALLS: calls, PATH: `${bin}:${process.env.PATH}` };
  for (const k of ["NS_MAX_LOAD", "NS_MIN_FREE_GB", "NS_LOCK_WAIT", "NS_MAX_RUN"]) delete env[k];
  const r = spawnSync("bash", ["scripts/remote.sh", "slot-test", ...opts, "--", "true"], { encoding: "utf8", env, input: "" });
  expect(r.status, r.stderr).toBe(0);
  const run = fs
    .readdirSync(calls)
    .map((f) => fs.readFileSync(path.join(calls, f), "utf8"))
    .find((c) => c.includes(" remote-run "));
  expect(run, "the run's ssh call").toBeDefined();
  const docker = run!.match(/ docker run (--rm --name shadowlocks-slot-test-.*?) -v /)?.[1];
  const lock = run!.match(/ remote-run shadowlocks-slot-test-\S+ slot-test (\S+) /)?.[1];
  expect(docker, "docker run options").toBeDefined();
  expect(lock, "lock").toBeDefined();
  return { docker: ` ${unq(docker!)} `, lock: unq(lock!) };
}

describe("remote.sh: the shared slots", () => {
  it("holds a functional e2e run (--lock-shared e2e) in one of two slots of two slot files each", () => {
    expect(sent(["--lock-shared", "e2e"]).lock).toBe("e2e:2:2");
    expect(sent(["--lock", "e2e"]).lock).toBe("e2e");
    expect(sent([]).lock).toBe("");
  });

  it("uses the same four slot files older scripts take one of each", () => {
    expect(Number(constant("SHARED_SLOTS")) * Number(constant("SHARED_SLOT_FILES"))).toBe(4);
  });
});

/** A function of remote-run.sh, lifted out of the script. */
function fn(name: string): string {
  const text = fs.readFileSync("scripts/remote-run.sh", "utf8").match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m"))?.[0];
  expect(text, `${name} in remote-run.sh`).toBeDefined();
  return text!;
}

/** remote-run.sh's lock_shared, run with LOCKS in a scratch folder: `before` sets up holders, `after` reports. */
function lockShared(before: string, call: string, after: string): string[] {
  const locks = tmp();
  // held <file>: whether another open of the file can take it (flock locks belong to the open file).
  const script = [
    `LOCKS=${locks} WAIT=0`,
    fn("lock_shared"),
    'held() { if flock -n "$LOCKS/$1" true; then echo "$1 free"; else echo "$1 held"; fi; }',
    before,
    `if ${call}; then echo took; else echo gave up; fi`,
    after,
  ].join("\n");
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim().split("\n");
}

const slotFiles = "held e2e.slot1.lock; held e2e.slot2.lock; held e2e.slot3.lock; held e2e.slot4.lock";
const hold = (n: number, fd: number) => `exec ${fd}>"$LOCKS/e2e.slot${n}.lock"; flock -n ${fd}`;

describe("remote-run.sh: a shared hold takes a pair of slot files", () => {
  it("takes the first free pair, then the e2e lock shared", () => {
    const after = `${slotFiles}; flock -n -s "$LOCKS/e2e.lock" true && echo shared ok; flock -n "$LOCKS/e2e.lock" true || echo exclusive kept out`;
    expect(lockShared("", "lock_shared e2e 2 2", after)).toEqual([
      "took",
      "e2e.slot1.lock held",
      "e2e.slot2.lock held",
      "e2e.slot3.lock free",
      "e2e.slot4.lock free",
      "shared ok",
      "exclusive kept out",
    ]);
  });

  it("takes the second pair when an older run holds one file of the first, and lets go of the half it took", () => {
    expect(lockShared(hold(2, 3), "lock_shared e2e 2 2", slotFiles)).toEqual([
      "took",
      "e2e.slot1.lock free",
      "e2e.slot2.lock held",
      "e2e.slot3.lock held",
      "e2e.slot4.lock held",
    ]);
  });

  it("gives up with no half pair kept when every pair has a file held", () => {
    expect(lockShared(`${hold(2, 3)}; ${hold(3, 4)}`, "lock_shared e2e 2 2", `${slotFiles}; held e2e.lock`)).toEqual([
      "gave up",
      "e2e.slot1.lock free",
      "e2e.slot2.lock held",
      "e2e.slot3.lock held",
      "e2e.slot4.lock free",
      "e2e.lock free",
    ]);
  });

  it("still takes one file a run when asked for one (the older scripts' way)", () => {
    expect(lockShared(hold(1, 3), "lock_shared e2e 4 1", slotFiles)).toEqual([
      "took",
      "e2e.slot1.lock held",
      "e2e.slot2.lock held",
      "e2e.slot3.lock free",
      "e2e.slot4.lock free",
    ]);
  });
});
