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
  /** The demo video's end card (tests/video/edits.ts); the hosted link joins it once there is one. */
  film: {
    title: "Shadow Locks",
    tagline: "Your hands. One light. Every shadow a lock.",
    facts: ["Seated", "Hands only", "Plays offline"],
  },
} as const;
