// Every player-facing string in one place: plain, short and friendly; no em or en dashes, and
// hyphens only where a word needs one (tests/unit/copy.test.ts checks). This is the English source:
// each other language is a table of exactly these keys in src/i18n/ (the compiler checks), and
// code reads the active one through `copy()` from src/i18n. {names} are filled in by `fill`; a
// { one, other } pair is a count's plural forms (`plural` in src/i18n picks one). Panel labels the
// generated UIKitML carries are here too (`panels`), so they can be painted in any language.

export const COPY = {
  /** The 2D page, under the Open the box button. */
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
  /** Settings rows: a toggle's label and the short note under it; slider labels; values. */
  settings: {
    on: "On",
    off: "Off",
    /** A volume slider at zero. */
    muted: "Off",
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
    language: "Language",
    /** The Language row set to follow the headset. */
    languageAuto: "Automatic",
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
      rewards: { one: "{n} reward", other: "{n} rewards" },
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
      rewards: { one: "{n} reward", other: "{n} rewards" },
      box: "Box No. {n}",
      daily: "Daily Box {day}",
      page: "{from} to {to} of {n}",
    },
    trial: {
      daysLeft: { one: "Your trial: {n} day left", other: "Your trial: {n} days left" },
      over: "Your trial has ended.",
      unlock: "Unlock the full game",
      bought: "Thank you. The full game is yours.",
      failed: "The store did not answer. Try again later.",
    },
  },
  /** Fixed panel text (the generated UIKitML's labels), painted again when the language changes. */
  panels: {
    back: "Back",
    home: {
      /** The game's name, the same in every language (Japanese writes its space as a no-break space). */
      title: "Shadow Locks",
      tagline: "A puzzle box of light",
      continue: "Continue",
      lessons: "Lessons",
      collection: "Collection",
      settings: "Settings",
      settingsSub: "Sound and size",
    },
    lessons: {
      title: "Lessons",
      examples: "Examples: poke one to watch it again",
      tips: "Tips",
      tip: "Tip",
      none: "Tips you meet in the boxes show up here.",
    },
    collection: {
      title: "Collection",
      empty: "Open a box to find its first reward.",
      newer: "Newer",
      older: "Older",
    },
    settings: {
      title: "Settings",
      note: "Changes apply right away",
      recenter: "Recenter",
      reset: "Reset",
      resetSub: "All progress",
      done: "Done",
    },
    reset: {
      title: "Reset progress?",
      body: "Boxes, lessons, the collection and the streak start over.",
      keeps: "Your settings stay.",
      keep: "Keep it",
      confirm: "Reset",
    },
    trial: {
      title: "Unlock the full game",
      keeps: "The Daily Box and the lessons stay open.",
      buy: "Buy",
      buySub: "One time, yours to keep",
      store: "Get it on the Meta Horizon Store",
      storeSub: "Opens the store page",
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
  /**
   * Each box's dossier: whose desk it came off and what was inside, picked by the box's seed (src/core/story.ts;
   * the order is part of the generator). A saved reward keeps its English words; a table translates them by
   * place. Each language writes an owner in the form its {owner} line needs ("del Relojero", "des Uhrmachers").
   */
  story: {
    owners: [
      "the Clockmaker",
      "the Archivist",
      "Madame Rook",
      "the Harbour Master",
      "Professor Vane",
      "the Twins",
      "Old Saffron",
      "the Cartographer",
      "the Night Clerk",
      "Baron Ashgrove",
      "the Lamplighter",
      "Mother Quill",
      "the Bookbinder",
      "Captain Ilse Marr",
      "the Locksmith",
      "Doctor Halloran",
      "the Ferryman",
      "Lady Penhallow",
      "the Glassblower",
      "the Stationmaster",
      "Aunt Marguerite",
      "the Puppeteer",
      "Inspector Moreau",
      "the Organ Tuner",
    ],
    loot: [
      "the harbour ledger",
      "a ruby the size of a thumbnail",
      "the second key",
      "a roll of bearer bonds",
      "the vault schedule",
      "a photograph of the guard rota",
      "a brass cipher disc",
      "the Ashgrove seal",
      "a night train ticket to Lisbon",
      "the deposit box number",
      "a wax cylinder recording",
      "the blueprints for the east wing",
      "a pocket watch that runs backwards",
      "the lighthouse keeper's log",
      "a sealed letter to the mayor",
      "the combination to the west safe",
      "a silver thimble",
      "the missing chess queen",
      "a map of the old canals",
      "an opera ticket for Friday",
      "a jar of foreign coins",
      "the stationmaster's whistle",
    ],
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
    /**
     * True on every device the page opens on: a headset (hands or Touch controllers) and a phone (touch, AR), so it
     * names no input.
     */
    facts: "Seated. Plays offline.",
    loading: "Loading",
    /** The page's meta description (index.html has it in English; the page sets it in the language shown). */
    description: "A puzzle box of light and shadow for Meta Quest. Seated, hands or controllers, plays offline.",
  },
  /** The lessons: the coach line, the lessons' and examples' names, and the tips. */
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
  /**
   * The coach lines that say how to use your hands, as a phone says them (AR on an Android phone: the screen is the
   * only input). Shown in place of the line each is named after (src/app/phone-lines.ts).
   */
  phone: {
    pickUp: "Drag the lantern.",
    slide: "Hold the lantern and move the phone nearer or farther.",
    finger: "One piece is missing. Touch the gap and hold still.",
    drawer: "Tap the drawer to find these lessons again.",
    puppets: "Touch the box to put a finger in the light.",
  },
} as const;

/** A copy line with its {names} filled in: `fill(COPY.game.boxNo, { n: 3 })` is "Box No. 3". */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
