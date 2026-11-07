import { describe, expect, it } from "vitest";
import { adrenoSeries, detectHeadset, gpuName, headsetClass, olderQuestToken, questBrowser, targetFrameRate } from "../../src/app/headset";

/** Quest Browser's user agent with a device token (Meta's browser-specs page; IWER's headset profiles use the same). */
const ua = (device: string) =>
  `Mozilla/5.0 (X11; Linux x86_64; ${device}) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/39.2.0.0.56.754450099 Chrome/136.0.7103.177 VR Safari/537.36`;
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36";

describe("headset class", () => {
  it("reads the Adreno series from a GPU name, and nothing from any other", () => {
    expect(adrenoSeries("Adreno (TM) 650")).toBe(650);
    expect(adrenoSeries("ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)")).toBe(740);
    expect(adrenoSeries("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBeNull();
    expect(adrenoSeries("WebKit WebGL")).toBeNull();
    expect(adrenoSeries(null)).toBeNull();
  });

  it("knows Quest Browser and the older headsets' device tokens", () => {
    for (const d of ["Quest 2", "Quest Pro", "Quest 3", "Quest"]) expect(questBrowser(ua(d))).toBe(true);
    expect(questBrowser(DESKTOP)).toBe(false);
    expect(questBrowser(PHONE)).toBe(false);
    expect([ua("Quest 2"), ua("Quest Pro"), ua("Quest"), ua("Quest 1")].map(olderQuestToken)).toEqual([true, true, true, true]);
    expect([ua("Quest 3"), ua("Quest 3S"), DESKTOP, PHONE].map(olderQuestToken)).toEqual([false, false, false, false]);
  });

  it("puts Quest 2 and Quest Pro on the XR2 Gen 1 path by their device token when the GPU is not named", () => {
    expect(headsetClass(ua("Quest 2"), null)).toBe("xr2-gen1");
    expect(headsetClass(ua("Quest Pro"), null)).toBe("xr2-gen1");
    expect(headsetClass(ua("Quest 3"), null)).toBe("standard");
    // The emulator's software GPU names no Adreno: the token decides.
    expect(headsetClass(ua("Quest 2"), "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("xr2-gen1");
  });

  it("lets the GPU's name decide on a Quest, whatever the token says (an app in compatibility mode)", () => {
    expect(headsetClass(ua("Quest 2"), "Adreno (TM) 740")).toBe("standard");
    expect(headsetClass(ua("Quest 3"), "Adreno (TM) 650")).toBe("xr2-gen1");
    expect(headsetClass(ua("Quest Pro"), "Adreno (TM) 650")).toBe("xr2-gen1");
  });

  it("keeps everything that is not a Quest browser on the standard path, phones with an Adreno too", () => {
    expect(headsetClass(DESKTOP, null)).toBe("standard");
    expect(headsetClass(PHONE, "Adreno (TM) 650")).toBe("standard");
  });
});

describe("the GPU's name and the frame rate", () => {
  /** A WebGL context that answers getParameter from a table, with or without the debug renderer extension. */
  const gl = (o: { ext: boolean; unmasked?: unknown; plain?: unknown; throws?: boolean }) =>
    ({
      RENDERER: 0x1f01,
      getExtension: (name: string) => (o.ext && name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
      getParameter: (p: number) => {
        if (o.throws) throw new Error("lost");
        return p === 0x9246 ? o.unmasked : o.plain;
      },
    }) as unknown as WebGL2RenderingContext;

  it("reads the unmasked renderer where the browser gives it, else the plain one, else nothing", () => {
    expect(gpuName(gl({ ext: true, unmasked: "Adreno (TM) 650", plain: "WebKit WebGL" }))).toBe("Adreno (TM) 650");
    expect(gpuName(gl({ ext: false, plain: "Adreno (TM) 740" }))).toBe("Adreno (TM) 740");
    expect(gpuName(gl({ ext: true, unmasked: "" }))).toBeNull();
    expect(gpuName(gl({ ext: true, throws: true }))).toBeNull();
    expect(detectHeadset(ua("Quest 3"), gl({ ext: true, unmasked: "Adreno (TM) 650" }))).toEqual({ class: "xr2-gen1", gpu: "Adreno (TM) 650" });
    expect(detectHeadset(ua("Quest 2"), null)).toEqual({ class: "xr2-gen1", gpu: null });
  });

  it("asks 90 Hz on the standard path and 72 Hz on the XR2 Gen 1 headsets, only when the session offers it", () => {
    const quest = new Float32Array([72, 80, 90, 120]);
    expect(targetFrameRate("standard", quest)).toBe(90);
    expect(targetFrameRate("xr2-gen1", quest)).toBe(72);
    expect(targetFrameRate("xr2-gen1", [72, 90])).toBe(72);
    expect(targetFrameRate("standard", [60])).toBeNull();
    expect(targetFrameRate("xr2-gen1", undefined)).toBeNull();
    expect(targetFrameRate("standard", null)).toBeNull();
  });

  it("asks the ?hz= rate instead on any headset that offers it, and nothing on a phone", () => {
    const quest = [72, 80, 90, 120];
    expect(targetFrameRate("xr2-gen1", quest, 90)).toBe(90);
    expect(targetFrameRate("standard", quest, 72)).toBe(72);
    expect(targetFrameRate("xr2-gen1", [72, 90], 120)).toBeNull();
    // A phone's AR session (Chrome on ARCore) offers no rates: nothing is asked, whatever the address says.
    expect(targetFrameRate("standard", undefined, 90)).toBeNull();
  });
});
