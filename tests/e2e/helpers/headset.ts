// The emulated headset for a test. IWER's profile comes from iwsdk.config.json (Quest 3 for every spec), baked into the
// page's injected emulator module (/@iwer-injection-runtime) as its start configuration; a test that needs another
// headset rewrites that one value as the page loads it. The profile brings the headset's user agent ("Quest 2"), its
// frame rates and features; IWER draws every profile with the same software renderer at the page's size.
import type { Page } from "@playwright/test";

/**
 * IWER's profiles used here. `oculusQuest1` is no target of the game: frame-rate.spec.ts uses it as a session that offers
 * 72, 80 and 90 Hz but not 120 (the others offer all four).
 */
export type IwerHeadset = "metaQuest2" | "metaQuestPro" | "metaQuest3" | "oculusQuest1";

/** Load the page with IWER's `device` profile instead of the project's. Call before boot(). */
export async function emulateHeadset(page: Page, device: IwerHeadset): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith("/@iwer-injection-runtime"),
    async (route) => {
      const res = await route.fetch();
      const src = await res.text();
      const body = src.replace(/"device":\s*"\w+"/, `"device": "${device}"`);
      if (body === src) throw new Error("the emulator module carries no device setting to change");
      await route.fulfill({ response: res, body });
    },
  );
}

/**
 * Quest 2's eye buffer in Quest Browser (per eye, at the default framebuffer scale 1.0: Meta's WebXR foveation page
 * shows a 2880 x 1584 stereo surface; its render-scale table gives 1440 x 1540 for native apps), and an eye's view
 * as half angles in degrees (assumed: Meta publishes no per-eye angles for Quest 2; these keep the buffer's aspect with
 * square pixels; a wider real view only spreads the box over fewer pixels).
 */
export const QUEST2_EYE = {
  width: 1440,
  height: 1584,
  fov: { left: 46, right: 46, up: 48.5, down: 48.5 },
} as const;
