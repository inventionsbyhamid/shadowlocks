// Offline play: a service worker (generated at build time, see pwa-config.ts) precaches the whole
// build, so after the first load the game needs no network at all.
//
// Update policy: a new version installs in the background while the game runs and never takes over
// mid-game. At the next boot (launch, reload or a restored tab), before anything starts, a waiting
// version is told to take over and the page reloads once: Quest Browser restores tabs, so "wait
// until every tab is closed" might never happen. Taking over switches every window of the game, so
// each running window holds a shared Web Lock and a boot never takes over while another window
// holds it. A game in progress resumes from its saved snapshot (Continue). On the launch that
// brings a new build the player gets one short note.
import { COPY } from "../ui/copy";

/** The generated service worker, next to index.html. */
export const SW_FILE = "sw.js";
/** localStorage key holding the build that ran last time. */
export const BUILD_KEY = "shadowlocks.build";
export const UPDATED_NOTICE = COPY.notice.updated;
/** sessionStorage key: when this tab last reloaded for an update (so it never loops). */
export const TAKEOVER_KEY = "shadowlocks.swTakeover";
/** At most one takeover reload per tab in this many ms. */
const TAKEOVER_GAP_MS = 60_000;
/** How long a boot waits for the new version to take control before it reloads anyway. */
export const TAKEOVER_WAIT_MS = 10_000;
/** Held (shared) by every running window of the game. */
export const RUNNING_LOCK = "shadowlocks-running";

/** The note for this launch, if any: only when a different build ran last time. */
export function launchNotice(previous: string | null, current: string): string | null {
  return previous !== null && previous !== current ? UPDATED_NOTICE : null;
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;

export interface OfflineDeps {
  /** navigator.serviceWorker (undefined without support or outside a secure context). */
  serviceWorker: ServiceWorkerContainer | undefined;
  /** import.meta.env.BASE_URL: the folder holding index.html and sw.js. */
  base: string;
  /** Names this build: the main bundle's URL (import.meta.url), whose file name carries its hash. */
  build: string;
  storage: KeyValue | null;
  notify(text: string): void;
  /** navigator.storage.persist: keeps the precache and the profile from being evicted. */
  persist?: () => Promise<boolean>;
  log?: (message: string, err?: unknown) => void;
}

function read(storage: KeyValue | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: KeyValue | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the note is just skipped next time.
  }
}

/** Notes a new build, then registers the service worker. Never throws. */
export async function startOffline(d: OfflineDeps): Promise<ServiceWorkerRegistration | null> {
  const note = launchNotice(read(d.storage, BUILD_KEY), d.build);
  write(d.storage, BUILD_KEY, d.build);
  if (note) d.notify(note);
  if (!d.serviceWorker) return null;
  let reg: ServiceWorkerRegistration;
  try {
    reg = await d.serviceWorker.register(`${d.base}${SW_FILE}`, { scope: d.base });
  } catch (err) {
    (d.log ?? console.warn)("offline: could not register the service worker", err);
    return null;
  }
  try {
    await d.persist?.();
  } catch {
    // Best effort: without it the browser may evict the cache under storage pressure.
  }
  return reg;
}

export interface TakeoverDeps {
  serviceWorker: ServiceWorkerContainer | undefined;
  /** sessionStorage (per tab). */
  session: KeyValue | null;
  /** navigator.locks (undefined without Web Locks). */
  locks?: Pick<LockManager, "query">;
  now(): number;
  reload(): void;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the new version to take control (default TAKEOVER_WAIT_MS). */
  timeoutMs?: number;
  /** How long getRegistration() and the lock query may take (default 2 s). */
  queryTimeoutMs?: number;
}

const TIMED_OUT = Symbol("timed out");

function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([p, new Promise<typeof TIMED_OUT>((r) => setTimeout(() => r(TIMED_OUT), ms))]);
}

/**
 * True when another window holds the running lock, or when that cannot be told. A reloading page's
 * old document lets go of its lock a moment after the new one starts, so ask a few times.
 */
async function anotherWindowRuns(d: TakeoverDeps, ms: number): Promise<boolean> {
  if (!d.locks) return false;
  const sleep = d.sleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t)));
  for (let i = 0; i < 5; i++) {
    const q = await within(d.locks.query(), ms);
    if (q === TIMED_OUT) return true;
    if (!q.held?.some((l) => l.name === RUNNING_LOCK)) return false;
    await sleep(300);
  }
  return true;
}

/**
 * Call at boot before anything starts. When this page is controlled by an older version, a new one
 * is waiting and no other window of the game runs, tells it to take over (workbox's SKIP_WAITING
 * message), waits for it to take control and reloads once. Returns true when the page is
 * reloading (stop booting). Never throws, never hangs.
 */
export async function takeOverWaitingUpdate(d: TakeoverDeps): Promise<boolean> {
  try {
    const sw = d.serviceWorker;
    if (!sw?.controller) return false;
    const last = Number(read(d.session, TAKEOVER_KEY) ?? NaN);
    if (Number.isFinite(last) && d.now() - last < TAKEOVER_GAP_MS) return false;
    const ms = d.queryTimeoutMs ?? 2000;
    const reg = await within(sw.getRegistration().catch(() => undefined), ms);
    const waiting = reg === TIMED_OUT ? null : reg?.waiting;
    if (!waiting) return false;
    if (await anotherWindowRuns(d, ms)) return false;
    const tookOver = new Promise<void>((resolve) => {
      sw.addEventListener("controllerchange", () => resolve(), { once: true });
      setTimeout(resolve, d.timeoutMs ?? TAKEOVER_WAIT_MS);
    });
    write(d.session, TAKEOVER_KEY, String(d.now()));
    waiting.postMessage({ type: "SKIP_WAITING" });
    // Skip waiting cannot be called back: reload even if the switch is slow, so this page never
    // starts a game that the new version would then take over.
    await tookOver;
    d.reload();
    return true;
  } catch {
    return false;
  }
}

/** Holds the running lock (shared) for as long as this page lives. Never throws. */
export function holdRunningLock(locks: Pick<LockManager, "request"> | undefined): void {
  try {
    void locks?.request(RUNNING_LOCK, { mode: "shared" }, () => new Promise<never>(() => {})).catch(() => {});
  } catch {
    // No lock: a waiting update may then take over while this window runs.
  }
}

/** Shows `text` in `el` for `ms`, only if `el` is empty, and clears it unless something replaced it. */
export function showBriefly(
  el: { textContent: string | null } | null,
  text: string,
  ms = 6000,
  later: (fn: () => void, ms: number) => unknown = setTimeout,
): void {
  if (!el || el.textContent) return;
  el.textContent = text;
  later(() => {
    if (el.textContent === text) el.textContent = "";
  }, ms);
}

/**
 * Production entry: starts once the page has loaded, so the first screen never waits for the
 * precache (music included) to download.
 */
export function installOffline(build: string, notify: (text: string) => void): void {
  const start = () => {
    let storage: KeyValue | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    void startOffline({
      serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
      base: import.meta.env.BASE_URL,
      build,
      storage,
      notify,
      persist: navigator.storage?.persist ? () => navigator.storage.persist() : undefined,
    });
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

/**
 * Production boot: true when a waiting update is taking over and the page reloads (stop booting).
 * Otherwise this window holds the running lock from now on. Never throws.
 */
export async function takeOverAtBoot(): Promise<boolean> {
  try {
    let session: KeyValue | null = null;
    try {
      session = window.sessionStorage;
    } catch {
      session = null;
    }
    const locks = "locks" in navigator ? navigator.locks : undefined;
    const reloading = await takeOverWaitingUpdate({
      serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
      session,
      locks,
      now: () => Date.now(),
      reload: () => location.reload(),
    });
    if (!reloading) holdRunningLock(locks);
    return reloading;
  } catch {
    return false;
  }
}

