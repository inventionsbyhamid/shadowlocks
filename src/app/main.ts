// Entry point: create the IWSDK world, open the profile, wire the shell, show the Enter button.
// Boot order: a waiting update takes over first; test hooks (test builds) start logging before
// anything can emit; the world; asset URL rewrites; field flags; profile and settings; the shell
// and its systems; sound; the game (and a box at once with ?box=N); then Enter (or straight into XR
// in the installed Quest app); offline last.
import { AssetManager, World } from "@iwsdk/core";
import projectOptions from "virtual:iwsdk-project";
import { attachInput } from "../input/grab-system";
import { installOffline, showBriefly, takeOverAtBoot } from "../platform/offline";
import { openStore } from "../platform/store";
import { APP_VERSION } from "../platform/version";
import { COPY } from "../ui/copy";
import { MenuSystem, useMenus } from "../ui/menu-system";
import { styleRayCursors } from "../ui/ray-cursor";
import { emit, on } from "./bus";
import { disableMultiview, readFieldFlags, showPerfPanel, startBox } from "./field-flags";
import { attachGame } from "./game";
import { recordHands, recordSeconds } from "./hand-recorder";
import { attachHands } from "./hand-system";
import { localInputProfileUrl } from "./input-profiles";
import { attachLantern } from "./lantern-system";
import { ProfileStore } from "./profile-store";
import { SettingsStore } from "./settings";
import { Shell } from "./shell";
import { ShellSystem, useShell } from "./shell-system";
import { Sound, SoundSystem, useSound } from "./sound";
import { registerAppSystem } from "./systems";
import { addUrlRewrite, installUrlRewrites } from "./url-rewrites";

const TEST_HOOKS = import.meta.env.VITE_TEST_HOOKS === "1";
/** Demo video renders only (tests/video): the see-through system hand, progress in memory. Never for production builds. */
const VIDEO = import.meta.env.VITE_VIDEO === "1";

async function main(): Promise<void> {
  // A newer version installed during an earlier visit takes over now, before anything starts.
  if (!import.meta.env.DEV && (await takeOverAtBoot())) return;
  const status = document.getElementById("status");
  const enter = document.getElementById("enter") as HTMLButtonElement | null;
  const say = (text: string) => {
    if (status) status.textContent = text;
  };

  const hooks = TEST_HOOKS ? await import("./test-hooks") : null;
  const video = VIDEO ? await import("../video/video-mode") : null;
  hooks?.startEventLog();
  on("notice", (e) => {
    console.info(`notice: ${e.text}`);
    say(e.text);
  });

  const world = await World.create(document.getElementById("scene-container") as HTMLDivElement, projectOptions);
  // Asset URL rewrites (src/app/url-rewrites.ts). Hand and controller models come from our own
  // origin, never the CDN (offline after the first load).
  installUrlRewrites(AssetManager.loadingManager);
  const profiles = `${import.meta.env.BASE_URL}input-profiles`;
  addUrlRewrite((url) => localInputProfileUrl(url, profiles));
  // Real-Quest test switches (?perf=1, ?multiview=0, ?record=60); off unless named in the address.
  const flags = readFieldFlags(location.search);
  if (!flags.multiview) disableMultiview(world.renderer);
  if (flags.perf) showPerfPanel(world);
  const recordFor = recordSeconds(location.search);
  if (recordFor) recordHands(world, recordFor, say).catch((err) => console.error("hand recording unavailable", err));
  // The wall clock enters the profile here only (first launch, latest time seen): core code takes times as arguments.
  const store = await ProfileStore.open(video ? video.videoStore() : await openStore(), emit, { now: () => Date.now(), build: APP_VERSION });
  const settings = new SettingsStore(store);
  const shell = new Shell(world, store, settings);
  useShell(shell);
  // Register app systems through registerAppSystem so the test hooks time them all.
  const system = registerAppSystem(world, ShellSystem, { name: "shell" });
  useMenus(shell.panels);
  registerAppSystem(world, MenuSystem, { name: "menus" });
  // Hands (priority -3.2): pinch state for the lantern grab, rays off for a busy hand.
  attachInput(world);
  // The lantern (priority -3, right after the hands): held, carried, let go, settled on a spot.
  const lantern = attachLantern(world, shell.box);
  // The hands in the box (priority -2.9): the real hand in front of the box, the hands' shadows, the finger's shadow
  // for the finger locks (the game measures them).
  const hands = attachHands(world, {
    scene: shell.box,
    lantern,
    passthrough: () => shell.sessionMode === "immersive-ar",
    rays: world.player.raySpaces,
  });
  // The rays' cursor in the game's look (rays press keys too).
  styleRayCursors(world);
  // Sound hears every bus event after everyone else; the box tells it where the locks are.
  const sound = new Sound({ world, settings, lifecycle: shell.lifecycle, menuButtons: (screen) => shell.panels.buttons(screen), box: shell.box });
  useSound(sound);
  registerAppSystem(world, SoundSystem, { name: "sound" });
  // The game (priority -2.8, after the hands): the box session (its finger locks fed by the hands), its
  // celebrations, the plate and the hint lantern.
  const play = attachGame({ world, shell, lantern, sound, hands });
  hooks?.installTestHooks(world, shell, system, { sound, lantern, hands, play });
  shell.start();
  const box = startBox(location.search);
  if (box) play.game.playBox(box);
  sound.loadMusicLater();
  video?.installVideoMode(world);

  if (navigator.xr && world.xrEnabled) {
    const failed = COPY.page.enterFailed;
    // Test builds may shorten the wait (?enterTimeoutMs=500) to check the retry path.
    const testTimeout = TEST_HOOKS ? Number(new URLSearchParams(location.search).get("enterTimeoutMs")) : 0;
    const tryEnter = async () => {
      if (enter) enter.disabled = true;
      const ok = await shell.enterXR(testTimeout > 0 ? testTimeout : undefined).catch(() => false);
      if (enter) {
        enter.disabled = false;
        enter.hidden = false;
      }
      if (!ok) say(failed);
      else if (status?.textContent === failed) say("");
    };
    enter?.addEventListener("click", () => {
      sound.unlock();
      void tryEnter();
    });
    world.renderer.xr.addEventListener("sessionstart", () => {
      if (status?.textContent === failed) say("");
    });
    if (status && status.textContent === "Loading") say("");
    // Installed Quest app (the TWA exposes the Digital Goods API): go straight into XR with no
    // gesture; Enter shows if that fails. Audio then starts on the first pinch (startAudio retries).
    if ("getDigitalGoodsService" in window) void tryEnter();
    else if (enter) enter.hidden = false;
  } else {
    say(COPY.page.noXr);
  }
  // Production builds precache everything for offline play, after the first screen is up.
  if (!import.meta.env.DEV) {
    installOffline(import.meta.url, (text) => {
      console.info(`notice: ${text}`);
      showBriefly(status, text);
    });
  }
}

main().catch((err) => {
  console.error("startup failed", err);
  const status = document.getElementById("status");
  if (status) status.textContent = COPY.page.startupFailed;
});
