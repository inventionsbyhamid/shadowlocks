// Every player-facing string in one place: plain, short and friendly; no em or en dashes, and
// hyphens only where a word needs one (tests/unit/copy.test.ts checks). Panel layouts carry their
// fixed labels in scripts/ui (generated UIKitML); anything painted from code comes from here.

export const COPY = {
  /** The 2D page, under the Enter button. */
  page: {
    enterFailed: "Could not start. Tap Open the box to try again.",
    noXr: "Open this page in the Meta Quest browser to play.",
    startupFailed: "Something went wrong. Reload to try again.",
  },
  /** Notices on the page and the home panel. */
  notice: {
    notSaved: "Progress will not be saved on this device.",
    updated: "Updated to the latest version.",
  },
  settings: {
    on: "On",
    off: "Off",
    music: "Music",
    effects: "Effects",
    boxSize: "Box size",
    captions: "Captions",
    captionsSub: "Text cues",
    motion: "Less motion",
    motionSub: "No bounce",
    dimming: "Dim room",
    dimmingSub: "In play",
    warmth: "Warmth",
    warmthSub: "Glow, hums",
    hand: "Left hand",
    handSub: "Mirrored",
  },
  /** The drawer's menus: Home, Lessons, Collection, the reset confirm and the trial ({names} filled in). */
  menus: {
    home: {
      continueSub: "Box No. {n}",
      startSub: "Start Box No. {n}",
      backToLesson: "Your lesson",
      trialOver: "Trial over",
      dailyLocked: "After Box No. 3",
      dailyNew: "New today",
      dailyDone: "Solved today",
      streak: "Streak {n}",
      lessons: "Watch again",
      collectionEmpty: "Empty so far",
      collectionOne: "1 reward",
      collectionMany: "{n} rewards",
      reset: "Progress reset.",
    },
    lessons: {
      move: "Move the light",
      nearFar: "Near and far",
      rings: "Sight the rings",
      finger: "Lend a hand",
      decoys: "Decoys",
      ringless: "No rings",
      hidden: "Hidden outline",
      drawer: "The drawer",
    },
    collection: {
      none: "No rewards yet",
      one: "1 reward",
      many: "{n} rewards",
      box: "Box No. {n}",
      daily: "Daily Box {day}",
      page: "{from} to {to} of {n}",
    },
    trial: {
      daysLeft: "Your trial: {n} days left",
      dayLeft: "Your trial: 1 day left",
      over: "Your trial has ended.",
      unlock: "Unlock the full game",
      bought: "Thank you. The full game is yours.",
      failed: "The store did not answer. Try again later.",
    },
  },
  /** Sound captions (Settings, Captions), for sounds that carry meaning. */
  captions: {
    notNow: "Not now",
    lockOpen: "Lock opens",
    ringsLine: "Rings line up",
    pieceFormed: "Piece formed",
    boxOpens: "Box opens",
    streak: "Streak",
    hint: "Hint",
  },
  /** The box in play: the plate on the box, the hint lantern's choices, the reward's story line ({names} filled in). */
  game: {
    boxNo: "Box No. {n}",
    daily: "Daily Box",
    next: "Next box",
    hint: "Hint",
    showMe: "Show me",
    /** Under the plate's name for a practice box (the `?box=N` flag: nothing it does is kept). */
    practice: "Practice",
    storyOwner: "Off the desk of {owner}.",
    storyLoot: "Inside: {loot}.",
    short: "One piece short.",
    /** The coach line while a finger lock waits and controllers are in use. */
    controllerFinger: "Or set a controller down and use your finger.",
  },
  /** The demo video's end card (tests/video/edits.ts); the hosted link joins it once there is one. */
  film: {
    title: "Shadow Locks",
    tagline: "Your hands. One light. Every shadow a lock.",
    facts: ["Seated", "Hands only", "Plays offline"],
  },
  /** The landing page (the hosted link only; the installed app goes straight in). */
  landing: {
    open: "Open the box",
    tagline: "A puzzle box of light and shadow.",
    facts: "Seated. Hands only. Plays offline.",
  },
} as const;

/** A copy line with its {names} filled in: `fill(COPY.game.boxNo, { n: 3 })` is "Box No. 3". */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
