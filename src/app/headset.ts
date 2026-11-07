// Which kind of Quest this is, for the one thing the older headsets get differently: the frame rate a session asks
// for. Quest 2 and Quest Pro run the Snapdragon XR2 Gen 1 (an Adreno 650 GPU); Quest 3 and 3S the XR2 Gen 2 (Adreno
// 740), with about a third more CPU and over twice the GPU. Quest Browser runs WebXR at 90 Hz by default on Quest 2,
// so on the older chip the session asks for 72 Hz (Meta's minimum for interactive apps and Quest 2's own default for
// native apps): a frame then has 13.9 ms instead of 11.1. Everything the game draws stays the same on every headset.
//
// The GPU's name (WebGL's renderer string, "Adreno (TM) 650") decides when the browser gives it: it is the chip itself,
// whatever an app's compatibility mode reports. Without it, Quest Browser's device token in the user agent does
// ("Quest 2", "Quest Pro"; Quest 3 and 3S both say "Quest 3": Meta's browser-specs page). Anything that is not a Quest
// browser (a phone, a desktop emulator, another headset) keeps the standard path.

export type HeadsetClass = "xr2-gen1" | "standard";

export interface Headset {
  class: HeadsetClass;
  /** The GPU as WebGL names it (null when the browser does not say). */
  gpu: string | null;
}

/** The Adreno series in a GPU name ("Adreno (TM) 650" -> 650), or null for any other GPU or none. */
export function adrenoSeries(gpu: string | null): number | null {
  const m = gpu ? /Adreno\D{0,12}(\d{3})/i.exec(gpu) : null;
  return m ? Number(m[1]) : null;
}

/** True for Quest Browser on a headset (its user agent names the Quest, or the browser). */
export function questBrowser(ua: string): boolean {
  return /\bOculusBrowser\b|\bQuest\b/.test(ua);
}

/** True for the device tokens of the XR2 Gen 1 headsets and older: "Quest 2", "Quest Pro", and the first "Quest". */
export function olderQuestToken(ua: string): boolean {
  return /\bQuest(?: (?:2|Pro|1))?[;)]/.test(ua);
}

/** The headset class from the user agent and the GPU's name (see the top of this file). */
export function headsetClass(ua: string, gpu: string | null): HeadsetClass {
  if (!questBrowser(ua)) return "standard";
  const series = adrenoSeries(gpu);
  if (series !== null) return series < 700 ? "xr2-gen1" : "standard";
  return olderQuestToken(ua) ? "xr2-gen1" : "standard";
}

/** The GPU's name from a WebGL context: the unmasked renderer where the browser gives it, else its plain one. */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const v: unknown = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/** This headset, from the browser's user agent and the renderer's GL context. */
export function detectHeadset(ua: string, gl: WebGLRenderingContext | WebGL2RenderingContext | null): Headset {
  const gpu = gl ? gpuName(gl) : null;
  return { class: headsetClass(ua, gpu), gpu };
}

/**
 * The frame rate to ask a session for, when the session offers it: 90 Hz on the standard path (Quest 3 and 3S), 72 Hz
 * on the XR2 Gen 1 headsets, or `wanted` when given (the `?hz=` field switch). Null: leave the browser's rate alone (a
 * phone's session offers no rates).
 */
export function targetFrameRate(cls: HeadsetClass, supported: ArrayLike<number> | null | undefined, wanted: number | null = null): number | null {
  const want = wanted ?? (cls === "xr2-gen1" ? 72 : 90);
  return supported && Array.from(supported).includes(want) ? want : null;
}
