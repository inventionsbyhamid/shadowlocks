// ?record=60: record the head, hands and controllers of a real Quest session (IWER's ActionRecorder
// format) for its first 60 seconds (at most 120), and save the file when the player leaves XR; a
// "Save hand recording" button on the page saves it again if the browser held the download back. In
// the emulator that file replays the real motion (IWER_DEVICE.createActionPlayer), so tests and video
// can use a real person's hand movement. Off unless named in the address; the recorder code only
// loads then.
import type { World } from "@iwsdk/core";

export const RECORD_MIN_S = 5;
export const RECORD_MAX_S = 120;

/** Seconds to record from the address (`?record` alone means 60), 0 when off. */
export function recordSeconds(search: string): number {
  const q = new URLSearchParams(search);
  if (!q.has("record")) return 0;
  const raw = q.get("record") ?? "";
  if (raw === "" || raw === "1" || raw === "on") return 60;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(RECORD_MAX_S, Math.max(RECORD_MIN_S, Math.round(n)));
}

/** File name for a recording made at `date`. */
export function recordingName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `shadow-locks-hands-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.json`;
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The page button that saves the last recording again (the download needs no XR session). */
function saveButton(): HTMLButtonElement {
  const existing = document.getElementById("save-hands") as HTMLButtonElement | null;
  if (existing) return existing;
  const b = document.createElement("button");
  b.id = "save-hands";
  b.type = "button";
  b.textContent = "Save hand recording";
  b.style.cssText =
    "position:fixed;left:50%;top:6vh;transform:translateX(-50%);font:600 20px system-ui,sans-serif;padding:12px 32px;" +
    "border-radius:999px;border:0;background:#f4f1ea;color:#101318;cursor:pointer;z-index:1000;";
  b.hidden = true;
  document.body.appendChild(b);
  return b;
}

/**
 * Record every XR session (up to `seconds` each) and download it when the session ends. `say` shows
 * a line on the page (the player sees it after leaving XR), and the save button stays up for the
 * last recording.
 */
export async function recordHands(world: World, seconds: number, say: (text: string) => void): Promise<void> {
  const { ActionRecorder } = await import("iwer/lib/action/ActionRecorder.js");
  const xr = world.renderer.xr;
  let rec: InstanceType<typeof ActionRecorder> | null = null;
  xr.addEventListener("sessionstart", () => {
    const session = xr.getSession();
    const space = xr.getReferenceSpace();
    rec = session && space ? new ActionRecorder(session, space, { maxDurationMs: seconds * 1000, capPolicy: "stop" }) : null;
  });
  const button = saveButton();
  let last: { text: string; name: string } | null = null;
  button.addEventListener("click", () => {
    if (last) download(last.text, last.name);
  });
  xr.addEventListener("sessionend", () => {
    const r = rec;
    rec = null;
    if (!r || r.frameCount < 2) return;
    last = { text: r.toJSON(), name: recordingName(new Date()) };
    download(last.text, last.name);
    button.hidden = false;
    say(`Hand recording saved to Downloads (${Math.round(r.durationMs / 1000)} s). If it is not there, press Save hand recording.`);
  });
  const update = world.update.bind(world);
  world.update = (delta: number, time: number) => {
    update(delta, time);
    const frame = rec ? xr.getFrame() : null;
    if (rec && frame) rec.recordFrame(frame);
  };
}
