/**
 * Functions that run inside the page. Each one is serialized by Playwright, so it must be
 * self-contained: no imports, no outer variables.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * IWER's remote control has real-time watchdogs (10 s per queued command, 28 s per sequence,
 * 30 s capture release) that software rendering on the virtual clock can exceed. Lift them, and
 * hide the emulator's DevUI overlay (blue vignette, "Remote Control Active" pill).
 */
export function relaxIwer(): void {
  const d = (window as any).IWER_DEVICE;
  if (!d) return;
  const r = d.remote;
  r.ACTION_TIMEOUT_MS = 1e9;
  r.RELEASE_TIMEOUT_MS = 1e9;
  r.SEQUENCE_DEADLINE_MS = 1e9;
  const ui = d.devui;
  if (ui) {
    ui.render = () => {};
    try {
      ui.devUIContainer.style.display = "none";
    } catch {
      // not created yet
    }
  }
  document.querySelectorAll('[class*="devui" i], [id*="devui" i]').forEach((e) => {
    (e as HTMLElement).style.display = "none";
  });
}

/** Logic mode: stop drawing the synthetic room (planes and meshes are still reported). */
export function stopRoomRender(): void {
  const sem = (window as any).IWER_DEVICE?.sem;
  (window as any).__nsNoRoom = true;
  if (!sem) return;
  sem.render = () => {};
  if (sem.environmentCanvas) sem.environmentCanvas.style.display = "none";
}

/**
 * Visual mode: draw the synthetic room only in frames a capture asks for (`window.__nsRoomFrame`, set by
 * XrApp.capture around its frame step). The room is only ever seen in captures, and drawing it every frame made a
 * 1280x720 frame cost 0.5 to 2 s on the build server's software GL, against about 20 ms without it. IWER still calls
 * the real render first thing in the captured frame, with that frame's time and head pose, so captures are the same
 * images as before; game logic never reads the room's pixels (logic mode never draws it at all). Video renders
 * (VITE_VIDEO builds, which set `window.__nsVideo` before `window.__ns` is ready) capture every frame and keep the
 * room drawn in each.
 */
export function roomOnCaptureOnly(): void {
  const w = window as any;
  const sem = w.IWER_DEVICE?.sem;
  if (!sem || w.__nsVideo || w.__nsRoomOnCapture) return;
  const render = sem.render.bind(sem);
  sem.render = (now: number) => {
    if (w.__nsRoomFrame) render(now);
  };
  w.__nsRoomOnCapture = true;
}

/** Load one of IWER's synthetic rooms (before entering XR). */
export function loadRoom(room: string): Promise<void> {
  return (window as any).IWER_DEVICE.sem.loadDefaultEnvironment(room);
}

/** Put the emulated headset at `position`, looking at `lookAt` (yaw then pitch, no roll). */
export function setHeadset(p: { position: XYZ; lookAt: XYZ }): void {
  const d = (window as any).IWER_DEVICE;
  const { x, y, z } = p.position;
  d.position.set(x, y, z);
  const dx = p.lookAt.x - x;
  const dy = p.lookAt.y - y;
  const dz = p.lookAt.z - z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
}

/**
 * From the next frame on, the head sways side to side by up to 5 mm a frame (a seated player is
 * never still), so the audio listener moves on almost every frame.
 */
export function swayHead(): void {
  const w = window as any;
  const d = w.IWER_DEVICE;
  const world = w.__ns.world;
  const x0 = d.position.x as number;
  let f = 0;
  const update = world.update.bind(world);
  world.update = (dt: number, t: number) => {
    f++;
    d.position.x = x0 + 0.04 * Math.sin(f * 0.12);
    update(dt, t);
  };
}

/**
 * Installs `window.__nsCapture()`: draws the room canvas (unless the room is off) and the app canvas
 * into one 2D canvas and returns a data URL. Call it in the same task as the frame step that rendered,
 * so no preserveDrawingBuffer is needed, and set `window.__nsRoomFrame` around that step (roomOnCaptureOnly).
 */
export function installCapture(): void {
  const w = window as any;
  w.__nsCapture = (type = "image/png", quality = 0.92): string => {
    const app = w.__ns.world.renderer.domElement as HTMLCanvasElement;
    const env = w.__nsNoRoom ? null : (w.IWER_DEVICE?.sem?.environmentCanvas as HTMLCanvasElement | undefined);
    const width = app.width;
    const height = app.height;
    const c: HTMLCanvasElement = (w.__nsCaptureCanvas ||= document.createElement("canvas"));
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
    }
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if (env && env.width) ctx.drawImage(env, 0, 0, width, height);
    ctx.drawImage(app, 0, 0, width, height);
    return c.toDataURL(type, quality);
  };
}

/** The room's horizontal planes as IWER reports them (label, centre). */
export function roomPlanes(): Array<{ label: string; position: [number, number, number] }> {
  const sem = (window as any).IWER_DEVICE?.sem;
  if (!sem) return [];
  return [...sem.trackedPlanes].map((p: any) => {
    const pos = p.transform.position;
    return { label: String(p.semanticLabel), position: [pos.x, pos.y, pos.z] as [number, number, number] };
  });
}

/**
 * The progress stored in IndexedDB right now: the next box, the box in progress (`current`) and the collection's
 * keys; null with no profile stored. As storedInProgress, it never creates the database.
 */
export function storedProgress(): Promise<{ nextBox: number; current: unknown; collection: string[] } | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("shadow-locks");
    let missing = false;
    req.onupgradeneeded = () => {
      missing = true;
      req.transaction?.abort();
    };
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    req.onerror = () => (missing ? resolve(null) : reject(req.error ?? new Error("IndexedDB open failed")));
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains("profile")) {
          db.close();
          resolve(null);
          return;
        }
        const get = db.transaction("profile", "readonly").objectStore("profile").get("me");
        get.onsuccess = () => {
          db.close();
          const p = get.result as { nextBox: number; current?: unknown; collection: { key: string }[] } | undefined;
          resolve(p ? { nextBox: p.nextBox, current: p.current ?? null, collection: p.collection.map((c) => c.key) } : null);
        };
        get.onerror = () => {
          db.close();
          reject(get.error ?? new Error("IndexedDB read failed"));
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

/**
 * The numbered box in progress as stored in IndexedDB right now (the profile's `current`; null when
 * there is none). Never creates the database: if it does not exist yet the open is aborted. Rejects on
 * real IndexedDB errors.
 */
export function storedInProgress(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("shadow-locks");
    let missing = false;
    req.onupgradeneeded = () => {
      missing = true;
      req.transaction?.abort();
    };
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    req.onerror = () => (missing ? resolve(null) : reject(req.error ?? new Error("IndexedDB open failed")));
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains("profile")) {
          db.close();
          resolve(null);
          return;
        }
        const get = db.transaction("profile", "readonly").objectStore("profile").get("me");
        get.onsuccess = () => {
          db.close();
          resolve((get.result as { current?: unknown } | undefined)?.current ?? null);
        };
        get.onerror = () => {
          db.close();
          reject(get.error ?? new Error("IndexedDB read failed"));
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}
