// Every player-facing string in one place: plain, short and friendly; no em or en dashes, and
// hyphens only where a word needs one (tests/unit/copy.test.ts checks). Panel layouts carry their
// fixed labels in scripts/ui (generated UIKitML); anything painted from code comes from here.

export const COPY = {
  /** The 2D page, under the Enter button. */
  page: {
    enterFailed: "Could not start. Tap Enter to try again.",
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
  /** The lessons: the coach line under the box, the lessons' and examples' names (the Lessons menu), and the tips. */
  lessons: {
    pickUp: "Pick up the lantern.",
    watchMove: "Watch the shadows move.",
    nearSwing: "Near pieces swing more.",
    watch: "Watch.",
    yourTurn: "Your turn.",
    lineUp: "Line up the two rings.",
    slide: "Now slide nearer or farther until it fills.",
    finger: "One piece is missing. Your finger can cast it.",
    drawer: "Pull the drawer to find these lessons again.",
    puppets: "Put a hand in the light.",
    titles: { l1: "Catch the light", l2: "Lend a hand" },
    examples: { move: "Move the light", "near-far": "Near and far", rings: "Sight the rings", finger: "Lend a hand" },
    tips: {
      decoys: "Each lock has its own spot. Some scraps belong to none.",
      ringless: "No rings here. Read the shadows.",
      hidden: "This outline is hidden. What shape do the shadows make?",
    },
  },
} as const;

/** A copy line with its {names} filled in: `fill(COPY.game.boxNo, { n: 3 })` is "Box No. 3". */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
