// The film's part D, share: the game's own 2D page in a browser window (lib/page-shot.ts), a window small enough that
// its words read in the film's frame (640x360 CSS px, drawn at the render size). The player of the records shots opens
// today's Daily Box in the headset (before the first capture: the locks opened through the test hooks after two and a
// half minutes of play, as the e2e share spec does, so the page says the 2:32 the headset shots show) and takes the
// headset off: the page shows the result's text, its tiles and time, and "Share today's result". Then a friend's link
// for the same Daily Box lands in another window: "Your friend says 4:12."
import { boxInPlay, rewardUp, solveBox } from "../../e2e/helpers/solve";
import { definePageShot } from "../lib/page-shot";
import { dailyProfile, TODAY } from "./demo2-d-kit";

/** A friend's link for today's Daily Box: 4:12, no hints (the game's own link format, src/core/share.ts). */
const FRIEND_LINK = `/?day=${TODAY}&t=252&h=0&g=4`;
/** Play time before the last lock, virtual ms, in steps of this many ms. */
const PLAY_MS = 150_000;
const STEP_MS = 100;

export default definePageShot({
  name: "demo2-d-share",
  description: "Share: the 2D page's result text and its share button; a friend's link landing with their time.",
  viewport: { width: 640, height: 360 },
  async play({ window: open, boot, hold, until }) {
    const page = await open({ profile: dailyProfile(12, [241_000, 213_000, 226_000, 252_000]) });
    const app = await boot(page, { mode: "logic" });
    await page.evaluate((day) => window.__sl!.session.play({ kind: "daily", day }), TODAY);
    const s = await boxInPlay(app, "today's Daily Box");
    await app.step(Math.round(PLAY_MS / STEP_MS), STEP_MS);
    await solveBox(app, s);
    await rewardUp(app, STEP_MS);
    // The headset view ends: back on the 2D page.
    await page.evaluate(() => (window.__ns!.world as unknown as { session?: XRSession }).session?.end());
    await app.stepUntil((ns) => !ns.state().xr.presenting, { maxMs: 5_000, label: "out of XR" });
    await until(page, () => !document.getElementById("result")!.hidden, "the result on the page");
    await page.evaluate(() => document.getElementById("result")!.scrollIntoView({ block: "center" }));
    await hold(page, 2.4);

    const friend = await open({ profile: dailyProfile(4, []) });
    await boot(friend, { url: FRIEND_LINK, enterXR: false });
    await until(friend, () => (document.getElementById("shared-says")?.textContent ?? "") !== "", "the friend's time");
    await friend.evaluate(() => document.getElementById("shared-says")!.scrollIntoView({ block: "center" }));
    await hold(friend, 2.4);
  },
});
