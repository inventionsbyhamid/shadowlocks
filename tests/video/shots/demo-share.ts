// The demo film, shot 10 (plan/submission/demo-video-script.md): sharing, on the game's own 2D page in the headset's
// browser window (lib/page-shot.ts). A player on a 4-day streak plays today's Daily Box in the headset (before the
// first capture: the locks opened through the test hooks, as the e2e share spec does, after a little over three
// minutes of play time) and takes the headset view off: the page shows the result's text and "Share today's
// result"; the button is pressed (this browser has no share sheet, so the game copies the text and says so). Then a
// friend's link for the same Daily Box opens in another window: what was shared and the time the friend says.
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import { boxInPlay, rewardUp, solveBox } from "../../e2e/helpers/solve";
import { definePageShot } from "../lib/page-shot";
import { playedProfile } from "../lib/stage";

const TODAY = DEFAULT_DATE.slice(0, 10);
/** A friend's link for today's Daily Box: 4:12, no hints (the game's own link format, src/core/share.ts). */
const FRIEND_LINK = `/?day=${TODAY}&t=252&h=0&g=4`;
/** Play time before the last lock, virtual ms, in steps of this many ms. */
const PLAY_MS = 190_000;
const STEP_MS = 100;

export default definePageShot({
  name: "demo-share",
  description: "The 2D page after a Daily Box: the result and its share button pressed; then a friend's link landing.",
  viewport: { width: 1280, height: 720 },
  async play({ window: open, boot, hold, until }) {
    const page = await open({ profile: playedProfile(4, 4, DEFAULT_DATE) });
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
    await page.evaluate(() => document.getElementById("share-result")!.scrollIntoView({ block: "center" }));
    await hold(page, 4);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    // A real click (a user gesture) without Playwright's frame-timed checks, which the virtual clock would hold.
    await page.locator("#share-result").click({ force: true, timeout: 15_000 });
    await until(page, () => (document.getElementById("share-note")?.textContent ?? "") !== "", "the share note");
    await hold(page, 2.5);

    const friend = await open({ profile: playedProfile(4, 0, DEFAULT_DATE) });
    await boot(friend, { url: FRIEND_LINK, enterXR: false });
    await until(friend, () => (document.getElementById("shared-says")?.textContent ?? "") !== "", "the friend's time");
    await hold(friend, 4.5);
  },
});
