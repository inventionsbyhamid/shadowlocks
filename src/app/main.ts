// Entry point: create the IWSDK world, open the profile, wire the shell, show the Enter button.
// Boot order: a waiting update takes over first; test hooks (test builds) start logging before
// anything can emit; the world; asset URL rewrites; field flags; profile and settings; the shell
// and its systems; sound; the game (and a box at once with ?box=N, or a shared link's: its landing line too); then
// Enter (or straight into XR in the installed Quest app); offline last.
import { AssetManager, World } from "@iwsdk/core";
import projectOptions from "virtual:iwsdk-project";
import { todayKey } from "../core/daily";
import { PAYWALL_ON } from "../core/entitlement";
import type { BoxResult } from "../core/result";
import { parseSharedLink } from "../core/share";
import { attachInput } from "../input/grab-system";
import { installOffline, takeOverAtBoot } from "../platform/offline";
import { openStore } from "../platform/store";
import { APP_VERSION } from "../platform/version";
import { copy } from "../i18n";
import { shareOffer, todayOffer } from "../ui/share-text";
import { MenuSystem, useMenus } from "../ui/menu-system";
import { styleRayCursors } from "../ui/ray-cursor";
import { Access, billingFor } from "./access";
import { emit, on } from "./bus";
import { attachDrawer } from "./drawer-system";
import { detectEdition, installedApp, paywallFor, servedOrigin, showLanding, testOverrides } from "./edition";
import { disableMultiview, readFieldFlags, showPerfPanel, startBox, startLesson } from "./field-flags";
import { attachGame } from "./game";
import { recordHands, recordSeconds } from "./hand-recorder";
import { attachHands } from "./hand-system";
import { questBrowser } from "./headset";
import { localInputProfileUrl } from "./input-profiles";
import { followLanguage } from "./language";
import { ENTER_FAILED, Landing, LOADING, NO_XR, noticeLine, startLanguage } from "./landing";
import { attachLantern } from "./lantern-system";
import { attachLessons } from "./lessons";
import { GameMenus } from "./menu-game";
import { ProfileStore } from "./profile-store";
import { go } from "./screens";
import { SettingsStore } from "./settings";
import { browserEnv, SharePage } from "./share-page";
import { ShareFlow } from "./share-flow";
import { Shell } from "./shell";
import { ShellSystem, useShell } from "./shell-system";
import { Sound, SoundSystem, useSound } from "./sound";
import { registerAppSystem } from "./systems";
import { attachTouch } from "./touch-system";
import { addUrlRewrite, installUrlRewrites } from "./url-rewrites";

const TEST_HOOKS = import.meta.env.VITE_TEST_HOOKS === "1";
/** Demo video renders only (tests/video): the see-through system hand, progress in memory. Never for production builds. */
const VIDEO = import.meta.env.VITE_VIDEO === "1";

async function main(): Promise<void> {
  // A newer version installed during an earlier visit takes over now, before anything starts.
  if (!import.meta.env.DEV && (await takeOverAtBoot())) return;
  const enter = document.getElementById("enter") as HTMLButtonElement | null;
  // The landing page (box art, the name, "Open the box") is for the hosted link: the installed
  // Quest apps skip it and go straight into XR. Its words, the page's lang and its meta description are in the
  // headset's language from the start, and follow the Language setting once the profile is open.
  // No landing art in the installed apps (it would flash by as a splash before XR): only the status, and the
  // button should going into XR fail.
  document.body.classList.toggle("installed", !showLanding(window));
  startLanguage(document);
  const page = new Landing(document);
  // Sharing on the 2D page: Web Launch away from a headset, a shared link's landing line (`?day=...`, `?box=N&t=...`:
  // shown at once, so a computer that cannot play still says what was shared), the result's share button.
  const shared = parseSharedLink(location.search, todayKey(Date.now()));
  const sharing = new SharePage(document, browserEnv(navigator, questBrowser(navigator.userAgent), servedOrigin(location)));
  sharing.landed(shared, null);

  const hooks = TEST_HOOKS ? await import("./test-hooks") : null;
  const video = VIDEO ? await import("../video/video-mode") : null;
  hooks?.startEventLog();
  on("notice", (e) => {
    console.info(`notice: ${e.text}`);
    page.say(noticeLine(e.text));
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
  // The recorder (a field tool) writes its own English progress lines.
  if (recordFor) recordHands(world, recordFor, (text) => page.say(() => text)).catch((err) => console.error("hand recording unavailable", err));
  // The wall clock enters the profile here only (first launch, latest time seen): core code takes times as arguments.
  const store = await ProfileStore.open(video ? video.videoStore() : await openStore(), emit, { now: () => Date.now(), build: APP_VERSION });
  const settings = new SettingsStore(store);
  // The language before anything paints text: the saved one, or the headset's.
  followLanguage(settings);
  // The edition from the host (a test build may force the store edition, the paywall and fake
  // billing from the address); with the paywall off, as in all of v1, billing is never asked.
  const over = testOverrides(location.search, TEST_HOOKS);
  const bill = billingFor(over?.billing);
  const access = new Access(detectEdition(location, over), paywallFor(PAYWALL_ON, over), bill.billing, () => store.profile, () => Date.now());
  const shell = new Shell(world, store, settings, access);
  useShell(shell);
  // Register app systems through registerAppSystem so the test hooks time them all.
  const system = registerAppSystem(world, ShellSystem, { name: "shell" });
  useMenus(shell.panels);
  registerAppSystem(world, MenuSystem, { name: "menus" });
  // Hands (priority -3.2): pinch state for the lantern grab, rays off for a busy hand.
  attachInput(world);
  // The lantern (priority -3, right after the hands): held, carried, let go, settled on a spot.
  const lantern = attachLantern(world, shell.box);
  // A lost box is never moved (nor its arrow shown) while the lantern is held; no hand takes the lantern while the box
  // waits, hidden, for its first placement.
  shell.lanternHeld = () => lantern.grab.holder !== null;
  shell.onPlacing = (on) => lantern.setUnplaced(on, performance.now());
  // A phone's touches in AR (priority -3.3, before the hands; off on a headset): the lantern dragged, keys tapped, a
  // finger cast in the light.
  const touch = attachTouch(world, { scene: shell.box, lantern });
  // The hands in the box (priority -2.9): the real hand in front of the box, the hands' shadows, the finger's shadow
  // for the finger locks (the game measures them).
  const hands = attachHands(world, {
    scene: shell.box,
    lantern,
    passthrough: () => shell.sessionMode === "immersive-ar",
    rays: world.player.raySpaces,
    touch,
  });
  // The rays' cursor in the game's look (rays press keys too).
  styleRayCursors(world);
  // Sound hears every bus event after everyone else; the box tells it where the locks are.
  const sound = new Sound({ world, settings, lifecycle: shell.lifecycle, menuButtons: (screen) => shell.panels.buttons(screen), box: shell.box });
  useSound(sound);
  registerAppSystem(world, SoundSystem, { name: "sound" });
  // The theatre lights' own sounds: the room going down for a box in play, coming up when the box opens (none when
  // room dimming is off, or for a menu's half light: menus have their own sounds).
  shell.onRoomLight = (_from, to) => {
    if (settings.get().dimming && (to === "play" || to === "up")) sound.game.theatre(to === "up");
  };
  // The game (priority -2.8, after the hands): the box session (its finger locks fed by the hands), its
  // celebrations, the plate and the hint lantern.
  // Endless boxes ask the entitlement (pending until it is worked out; a trial over keeps the Daily Box and lessons).
  const play = attachGame({ world, shell, lantern, sound, hands, canPlayBox: () => access.canPlayBox, boxRefused: () => go("trial") });
  // Where the player starts: a field flag's box or lesson (practice), else a first launch's lesson, else Home. Test
  // builds can keep Home (the e2e boot does, unless a test asks for the lessons).
  // A shared link names the box to play; else the field flags may.
  const box = shared ? null : startBox(location.search), lesson = shared ? null : startLesson(location.search);
  let flow: ShareFlow | null = null;
  /** The shared link's landing line as the flow stands: Lesson 1 first, else what its box is, none once played. */
  const landShared = () => {
    if (flow) sharing.landed(flow.link, flow.note());
  };
  const skipLessons = TEST_HOOKS && !!(window as { __slSkipLessons?: boolean }).__slSkipLessons;
  // The lessons (priority -2.7, after the game): the director, the ghost, the coach line; "Show me" on the hint
  // lantern; the menus' lesson rows.
  const lessons = attachLessons({
    world,
    scene: shell.box,
    profiles: shell.profiles,
    settings: shell.settings,
    lantern,
    hands,
    sound,
    play,
    // In XR, seen and placed: a hidden headset (or page), or a box still waiting for its first placement, holds the
    // lesson's clock, as the lifecycle holds the box's.
    presenting: () => shell.sessionMode !== null && shell.lifecycle.active && !shell.placing,
    autoStart: () => !box && !lesson && !shared && !skipLessons,
    // A new player's shared link: Lesson 1 first, then the friend's box in place of lesson 2 (the landing then says
    // what that box is).
    afterFirst: () => {
      const took = flow?.afterLesson() ?? false;
      if (took) landShared();
      return took;
    },
    phone: () => touch.phone,
    // The voice says the chip's lines; it stops while the headset is off or the page hidden.
    voice: sound.voice,
    visible: () => shell.lifecycle.active,
    inXr: () => shell.sessionMode !== null,
  });
  // What the menus play through: the box session and the lessons. A progress reset lets a lesson or replay in the
  // lap go as well as the box.
  const menuGame = new GameMenus({
    game: play.game,
    session: play.session,
    lessons,
    canPlayBox: () => access.canPlayBox,
    toTrial: () => go("trial"),
    toPlay: () => go("play"),
    clearBox: () => {
      lessons.stop();
      shell.box.setBox(null);
    },
  });
  shell.useMenuGame(menuGame);
  // Left hand on or off: the box behind the menus is rebuilt the other way round from its own save.
  settings.subscribe(() => {
    menuGame.rehand().catch((err) => console.error("the box could not be mirrored", err));
  });
  // The menu drawer in the box's plinth (priority -2.7, after the lantern: the hand holding it never pulls). Not
  // while the box is opening or its reward is up, nor while a lesson's example plays, nor before the box is placed; a
  // menu over play holds the box (its clock stops, it saves).
  const drawer = attachDrawer(world, {
    root: shell.box.root,
    busy: (side) => lantern.grab.holding(side),
    allowed: () => play.session.stage !== "opening" && play.session.stage !== "reward" && lessons.drawerAllowed && !shell.placing,
    reducedMotion: () => settings.get().reducedMotion,
    pulled: (at, hand) => sound.game.drawerPull(at, hand),
    menuOpen: (open) => {
      sound.game.menuOpen(open);
      shell.lifecycle.setHeld(open, performance.now());
    },
    away: (away) => {
      lantern.setAway(away, performance.now());
      // Hidden, its light kept (dark) in the scene: the box's shaders stay the ones compiled ahead (LanternView).
      shell.box.lantern.setShown(!away);
    },
  });
  touch.connect({ keys: [shell.panels, play.view], reward: play.view, drawer });
  hooks?.installTestHooks(world, shell, system, { sound, lantern, hands, play, drawer, access, fakeBilling: bill.fake, menuGame, lessons, touch });
  // The entitlement from the start (a first launch goes into a lesson, never through Home, which also asks it).
  void access.refresh();
  // A first launch goes straight into its lesson (the shell asks the lessons); a field flag's box or lesson after.
  shell.start();
  // The 2D page offers the latest box opened (today's Daily Box played for real), else today's from the collection.
  let latest: BoxResult | null = null;
  const offer = () =>
    (latest ? shareOffer(latest, shell.profiles.profile, todayKey(Date.now()), flow?.key ?? null) : null) ?? todayOffer(shell.profiles.profile, todayKey(Date.now()));
  play.view.onResult = (r) => {
    latest = r;
    if (flow?.played(r.key)) landShared();
    sharing.offer(offer);
  };
  sharing.offer(offer);
  if (shared) {
    const f = (flow = new ShareFlow({
      link: shared,
      profiles: shell.profiles,
      game: play.game,
      now: () => Date.now(),
      lessons,
      lessonsFirst: () => !skipLessons,
      // The friend's box done: lesson 2 for a new player who came by the link, else Home.
      after: () => {
        if (!shell.profiles.profile.lessons.l2) lessons.start("l2");
        else go("home");
      },
    }));
    play.view.friendFor = (key) => f.friendFor(key);
    play.session.nextHook = () => f.next(play.session);
    f.start();
    landShared();
  } else if (box) play.game.playBox(box);
  else if (lesson) lessons.start(lesson, { practice: true });
  // The voice guide's clips first (small, and lesson 1 may need them in 2 s), then the music.
  sound.loadVoiceLater();
  sound.loadMusicLater();
  video?.installVideoMode(world);

  if (navigator.xr && world.xrEnabled) {
    // Test builds may shorten the wait (?enterTimeoutMs=500) to check the retry path.
    const testTimeout = TEST_HOOKS ? Number(new URLSearchParams(location.search).get("enterTimeoutMs")) : 0;
    const tryEnter = async () => {
      if (enter) enter.disabled = true;
      const ok = await shell.enterXR(testTimeout > 0 ? testTimeout : undefined).catch(() => false);
      if (enter) {
        enter.disabled = false;
        enter.hidden = false;
      }
      // By which line is up, not its words: the language may have changed since the failure showed.
      if (!ok) page.say(ENTER_FAILED);
      else page.clear(ENTER_FAILED);
    };
    enter?.addEventListener("click", () => {
      sound.unlock();
      void tryEnter();
    });
    world.renderer.xr.addEventListener("sessionstart", () => {
      page.clear(ENTER_FAILED);
      document.body.classList.add("in-xr");
    });
    world.renderer.xr.addEventListener("sessionend", () => document.body.classList.remove("in-xr"));
    page.clear(LOADING);
    // Installed Quest app (the TWA exposes the Digital Goods API): go straight into XR with no
    // gesture; Enter shows if that fails. Audio then starts on the first pinch (startAudio retries).
    if (installedApp(window)) void tryEnter();
    else if (enter) enter.hidden = false;
  } else {
    page.say(NO_XR);
  }
  // Production builds precache everything for offline play, after the first screen is up.
  if (!import.meta.env.DEV) {
    installOffline(import.meta.url, (text) => {
      console.info(`notice: ${text}`);
      page.sayBriefly(noticeLine(text));
    });
  }
}

main().catch((err) => {
  console.error("startup failed", err);
  const status = document.getElementById("status");
  if (status) status.textContent = copy().page.startupFailed;
});
