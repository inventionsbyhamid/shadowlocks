import { describe, expect, it, vi } from "vitest";
import {
  BUILD_KEY,
  holdRunningLock,
  launchNotice,
  RUNNING_LOCK,
  showBriefly,
  startOffline,
  SW_FILE,
  TAKEOVER_KEY,
  TAKEOVER_WAIT_MS,
  takeOverWaitingUpdate,
  UPDATED_NOTICE,
  type OfflineDeps,
  type TakeoverDeps,
} from "../../src/platform/offline";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

/** A service worker container with an update already waiting, to check nothing asks it to take over. */
function fakeContainer() {
  const waiting = { postMessage: vi.fn(), state: "installed" };
  const registration = { waiting, active: { state: "activated" }, update: vi.fn() };
  const container = {
    register: vi.fn(async () => registration),
    addEventListener: vi.fn(),
  };
  return { container, registration, waiting };
}

function deps(o: Partial<OfflineDeps> = {}): OfflineDeps {
  return {
    serviceWorker: fakeContainer().container as unknown as ServiceWorkerContainer,
    base: "./",
    build: "https://game.example/assets/index-AAAA1111.js",
    storage: memoryStorage(),
    notify: vi.fn(),
    log: vi.fn(),
    ...o,
  };
}

describe("launch notice", () => {
  it("says nothing on the first launch", () => {
    expect(launchNotice(null, "b1")).toBeNull();
  });

  it("says nothing when the build is the one from last time", () => {
    expect(launchNotice("b1", "b1")).toBeNull();
  });

  it("says Updated once the build changed since last time", () => {
    expect(launchNotice("b1", "b2")).toBe(UPDATED_NOTICE);
  });

  it("is short and has no em or en dashes", () => {
    expect(UPDATED_NOTICE).not.toMatch(/[–—]/);
    expect(UPDATED_NOTICE.length).toBeLessThanOrEqual(40);
  });
});

describe("startOffline", () => {
  it("registers sw.js once, for the app's own folder", async () => {
    const f = fakeContainer();
    const reg = await startOffline(deps({ serviceWorker: f.container as unknown as ServiceWorkerContainer }));
    expect(reg).toBe(f.registration);
    expect(f.container.register).toHaveBeenCalledTimes(1);
    expect(f.container.register).toHaveBeenCalledWith(`./${SW_FILE}`, { scope: "./" });
  });

  it("once the game runs, never asks a waiting update to take over and never reloads", async () => {
    const f = fakeContainer();
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    try {
      await startOffline(deps({ serviceWorker: f.container as unknown as ServiceWorkerContainer }));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(f.waiting.postMessage).not.toHaveBeenCalled();
    expect(f.registration.update).not.toHaveBeenCalled();
    expect(f.container.addEventListener).not.toHaveBeenCalled(); // no controllerchange reload
    expect(reload).not.toHaveBeenCalled();
  });

  it("remembers the build and tells the player once when a new one launched", async () => {
    const storage = memoryStorage({ [BUILD_KEY]: "https://game.example/assets/index-OLD00000.js" });
    const notify = vi.fn();
    await startOffline(deps({ storage, notify }));
    expect(notify).toHaveBeenCalledWith(UPDATED_NOTICE);
    expect(storage.data.get(BUILD_KEY)).toBe("https://game.example/assets/index-AAAA1111.js");
    const again = vi.fn();
    await startOffline(deps({ storage, notify: again }));
    expect(again).not.toHaveBeenCalled();
  });

  it("stays quiet on the very first launch", async () => {
    const notify = vi.fn();
    await startOffline(deps({ notify }));
    expect(notify).not.toHaveBeenCalled();
  });

  it("plays on without a service worker (old browser, http page)", async () => {
    const notify = vi.fn();
    expect(await startOffline(deps({ serviceWorker: undefined, notify }))).toBeNull();
  });

  it("plays on when registration fails, and logs it", async () => {
    const log = vi.fn();
    const container = { register: vi.fn(async () => Promise.reject(new Error("blocked"))), addEventListener: vi.fn() };
    const reg = await startOffline(deps({ serviceWorker: container as unknown as ServiceWorkerContainer, log }));
    expect(reg).toBeNull();
    expect(log).toHaveBeenCalledWith("offline: could not register the service worker", expect.any(Error));
  });

  it("plays on when storage throws (private mode) or is missing", async () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const notify = vi.fn();
    const f = fakeContainer();
    await expect(
      startOffline(deps({ storage: throwing, notify, serviceWorker: f.container as unknown as ServiceWorkerContainer })),
    ).resolves.toBe(f.registration);
    await expect(startOffline(deps({ storage: null, notify }))).resolves.not.toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("startOffline also asks to keep storage", () => {
  it("requests persistent storage after registering", async () => {
    const order: string[] = [];
    const f = fakeContainer();
    f.container.register.mockImplementation(async () => {
      order.push("register");
      return f.registration;
    });
    const persist = vi.fn(async () => {
      order.push("persist");
      return true;
    });
    await startOffline(deps({ serviceWorker: f.container as unknown as ServiceWorkerContainer, persist }));
    expect(order).toEqual(["register", "persist"]);
  });

  it("plays on when the request is refused or throws", async () => {
    const persist = vi.fn(async () => Promise.reject(new Error("no")));
    await expect(startOffline(deps({ persist }))).resolves.not.toBeNull();
    expect(persist).toHaveBeenCalled();
  });
});

/** A container whose page is controlled, with a new version waiting; skip waiting fires controllerchange. */
function waitingUpdate(o: { answers?: boolean } = {}) {
  const listeners: Array<() => void> = [];
  const waiting = {
    postMessage: vi.fn((msg: unknown) => {
      if (o.answers !== false && (msg as { type?: string }).type === "SKIP_WAITING") queueMicrotask(() => listeners.forEach((l) => l()));
    }),
  };
  const registration = { waiting };
  const container = {
    controller: {},
    getRegistration: vi.fn(async () => registration),
    addEventListener: vi.fn((type: string, l: () => void) => {
      if (type === "controllerchange") listeners.push(l);
    }),
  };
  return { container, waiting, registration };
}

/** navigator.locks with the given answers to query(), one per call (the last one repeats). */
function locksHeld(...answers: boolean[]) {
  let i = 0;
  return {
    query: vi.fn(async () => {
      const held = answers[Math.min(i++, answers.length - 1)];
      return { held: held ? [{ name: RUNNING_LOCK, mode: "shared" as LockMode, clientId: "other" }] : [], pending: [] };
    }),
  };
}

function takeoverDeps(o: Partial<TakeoverDeps> = {}): TakeoverDeps {
  return {
    serviceWorker: waitingUpdate().container as unknown as ServiceWorkerContainer,
    session: memoryStorage(),
    locks: locksHeld(false),
    now: () => 1_000_000,
    reload: vi.fn(),
    sleep: async () => {},
    timeoutMs: 50,
    queryTimeoutMs: 50,
    ...o,
  };
}

describe("takeOverWaitingUpdate (at boot, before anything starts)", () => {
  it("lets a waiting new version take over and reloads once", async () => {
    const u = waitingUpdate();
    const reload = vi.fn();
    const session = memoryStorage();
    const d = takeoverDeps({ serviceWorker: u.container as unknown as ServiceWorkerContainer, reload, session });
    expect(await takeOverWaitingUpdate(d)).toBe(true);
    expect(u.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(session.data.get(TAKEOVER_KEY)).toBe("1000000");
  });

  it("does nothing on a first visit (no controller) or with no update waiting", async () => {
    const reload = vi.fn();
    const first = { ...waitingUpdate().container, controller: null };
    expect(await takeOverWaitingUpdate(takeoverDeps({ serviceWorker: first as unknown as ServiceWorkerContainer, reload }))).toBe(false);
    const none = waitingUpdate();
    none.registration.waiting = null as never;
    expect(await takeOverWaitingUpdate(takeoverDeps({ serviceWorker: none.container as unknown as ServiceWorkerContainer, reload }))).toBe(false);
    expect(await takeOverWaitingUpdate(takeoverDeps({ serviceWorker: undefined, reload }))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads at most once a minute in a tab, so it can never loop", async () => {
    const u = waitingUpdate();
    const reload = vi.fn();
    const session = memoryStorage({ [TAKEOVER_KEY]: String(1_000_000 - 30_000) });
    const d = takeoverDeps({ serviceWorker: u.container as unknown as ServiceWorkerContainer, reload, session });
    expect(await takeOverWaitingUpdate(d)).toBe(false);
    expect(u.waiting.postMessage).not.toHaveBeenCalled();
    session.data.set(TAKEOVER_KEY, String(1_000_000 - 61_000));
    expect(await takeOverWaitingUpdate(d)).toBe(true);
  });

  it("still reloads when the new version is slow to take control (skip waiting cannot be called back)", async () => {
    const u = waitingUpdate({ answers: false });
    const reload = vi.fn();
    const d = takeoverDeps({ serviceWorker: u.container as unknown as ServiceWorkerContainer, reload });
    expect(await takeOverWaitingUpdate(d)).toBe(true);
    expect(u.waiting.postMessage).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits up to 10 s for the new version by default", () => {
    expect(TAKEOVER_WAIT_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("never takes over while another window holds the running lock (a game may be on there)", async () => {
    const u = waitingUpdate();
    const reload = vi.fn();
    const locks = locksHeld(true);
    const d = takeoverDeps({ serviceWorker: u.container as unknown as ServiceWorkerContainer, reload, locks });
    expect(await takeOverWaitingUpdate(d)).toBe(false);
    expect(u.waiting.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(locks.query.mock.calls.length).toBeGreaterThan(1); // asked again before giving up
  });

  it("gives a reloading page's old document a moment to let go of the lock", async () => {
    const u = waitingUpdate();
    const sleep = vi.fn(async () => {});
    const d = takeoverDeps({ serviceWorker: u.container as unknown as ServiceWorkerContainer, locks: locksHeld(true, false), sleep });
    expect(await takeOverWaitingUpdate(d)).toBe(true);
    expect(sleep).toHaveBeenCalled();
  });

  it("takes over without Web Locks (nothing to ask)", async () => {
    expect(await takeOverWaitingUpdate(takeoverDeps({ locks: undefined }))).toBe(true);
  });

  it("boots on, never hangs, when getRegistration or the lock query never answers", async () => {
    const hang = { ...waitingUpdate().container, getRegistration: vi.fn(() => new Promise<never>(() => {})) };
    expect(await takeOverWaitingUpdate(takeoverDeps({ serviceWorker: hang as unknown as ServiceWorkerContainer }))).toBe(false);
    const u = waitingUpdate();
    const silent = { query: vi.fn(() => new Promise<never>(() => {})) };
    const reload = vi.fn();
    const d = takeoverDeps({ serviceWorker: u.container as unknown as ServiceWorkerContainer, locks: silent, reload });
    expect(await takeOverWaitingUpdate(d)).toBe(false);
    expect(u.waiting.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("never throws, whatever the browser does", async () => {
    const weird = {
      get controller(): never {
        throw new Error("boom");
      },
    };
    expect(await takeOverWaitingUpdate(takeoverDeps({ serviceWorker: weird as unknown as ServiceWorkerContainer }))).toBe(false);
  });

  it("boots on when the registration cannot be read or storage throws", async () => {
    const broken = { ...waitingUpdate().container, getRegistration: vi.fn(async () => Promise.reject(new Error("x"))) };
    expect(await takeOverWaitingUpdate(takeoverDeps({ serviceWorker: broken as unknown as ServiceWorkerContainer }))).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const reload = vi.fn();
    expect(await takeOverWaitingUpdate(takeoverDeps({ session: throwing, reload }))).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("showBriefly", () => {
  it("shows the note only over an empty status, then clears it", () => {
    const el = { textContent: "" as string | null };
    let fire: (() => void) | undefined;
    const later = vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(6000);
      fire = fn;
      return 0;
    });
    showBriefly(el, UPDATED_NOTICE, 6000, later);
    expect(el.textContent).toBe(UPDATED_NOTICE);
    fire!();
    expect(el.textContent).toBe("");
  });

  it("never covers a more useful message, and leaves a newer one alone", () => {
    const busy = { textContent: "Could not start. Tap Enter to try again." as string | null };
    showBriefly(busy, UPDATED_NOTICE, 6000, vi.fn());
    expect(busy.textContent).toBe("Could not start. Tap Enter to try again.");
    const el = { textContent: "" as string | null };
    let fire: (() => void) | undefined;
    showBriefly(el, UPDATED_NOTICE, 6000, (fn: () => void) => {
      fire = fn;
      return 0;
    });
    el.textContent = "Something newer";
    fire!();
    expect(el.textContent).toBe("Something newer");
  });
});

describe("holdRunningLock", () => {
  it("holds a shared lock for as long as the page lives", async () => {
    let held: Promise<unknown> | undefined;
    const locks = {
      request: vi.fn((name: string, opts: LockOptions, cb: () => Promise<unknown>) => {
        held = cb();
        return held;
      }),
    };
    holdRunningLock(locks as unknown as LockManager);
    expect(locks.request).toHaveBeenCalledWith(RUNNING_LOCK, { mode: "shared" }, expect.any(Function));
    const settled = await Promise.race([held!.then(() => "released"), new Promise((r) => setTimeout(() => r("held"), 20))]);
    expect(settled).toBe("held");
  });

  it("never throws without Web Locks or when the request fails", () => {
    expect(() => holdRunningLock(undefined)).not.toThrow();
    const failing = { request: vi.fn(() => Promise.reject(new Error("no"))) };
    expect(() => holdRunningLock(failing as unknown as LockManager)).not.toThrow();
    const throwing = {
      request: vi.fn(() => {
        throw new Error("no");
      }),
    };
    expect(() => holdRunningLock(throwing as unknown as LockManager)).not.toThrow();
  });
});

