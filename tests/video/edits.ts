// Edits cut from rendered shots (EDIT=<name>): test-results/video/<width>x<height>-<fps>/<name>.mp4.
// An edit's name must not be a shot's name (both write <name>.mp4). Loudness defaults to -14 LUFS,
// -1 dBTP. A voice-over: `narration: { file: "video-assets/<name>.wav", startSec, gainDb, duckDb }`
// (the video-assets/ folder is not committed; the runner uploads it with the rest of the worktree).
import { COPY } from "../../src/ui/copy";
import type { Edit } from "./lib/deliver";
import type { EndCard } from "./lib/endcard";

/** The film's closing card (its words live with the game's copy). The hosted link goes in `link` once there is one. */
export const END_CARD: EndCard = {
  title: COPY.film.title,
  tagline: COPY.film.tagline,
  facts: [...COPY.film.facts],
  holdSec: 3,
  fadeMs: 600,
};

/** The Devpost demo film from the render harness alone, in the order of plan/submission/demo-video-script.md. */
const DEMO_SHOTS = ["demo-finger", "demo-room", "demo-lesson", "demo-box3", "demo-daily-home", "demo-daily-open", "demo-share", "demo-controller"];

/** The film, version 2, its opening (parts A and B): the hook and the three beats on the dark stage. */
const DEMO2_OPEN = ["demo2-hook", "demo2-light", "demo2-depth", "demo2-hand"];

/**
 * The film, version 2, parts D and E: endless boxes (Box No. 382, then 1, 7, 22 and 630), records (New best, the
 * Collection), the Daily Box and its streak, sharing on the 2D page, hands, a controller and letting go; then Box No.
 * 12 opening, held under the end card.
 */
const DEMO2_MORE = [
  "demo2-d-box382",
  "demo2-d-box1",
  "demo2-d-box7",
  "demo2-d-box22",
  "demo2-d-box630",
  "demo2-d-best",
  "demo2-d-collection",
  "demo2-d-daily-home",
  "demo2-d-daily-card",
  "demo2-d-share",
  "demo2-d-hand",
  "demo2-d-controller",
  "demo2-d-letgo",
  "demo2-e-open",
];

/**
 * The end card over part E's held frame: Box No. 12 just opened, sharp, left of centre; the title large in the display
 * face in the dark to its right, the facts, and the site's name (as the result card prints it).
 */
const DEMO2_END: EndCard = { ...END_CARD, link: "shadowlocks.pages.dev", layout: "side", blurSigma: 0, holdSec: 4.5, fadeMs: 500 };

export const EDITS: Record<string, Edit> = {
  /**
   * Parts D and E of the film, version 2, cut to the narration (take 1 of lines 7 to 12, laid at their beats in
   * video-assets/demo2-more-narration.wav, not committed: plan/sdd/sl-v1/task-49-report.md says how it is made). Straight
   * cuts, the music bed under all of it, dipped under the voice; no captions and no corner label (the dark stage shows
   * no room).
   */
  "demo2-more": {
    shots: DEMO2_MORE,
    crossfadeMs: 0,
    endCard: DEMO2_END,
    narration: { file: "video-assets/demo2-more-narration.wav", startSec: 0, gainDb: 2, duckDb: 8 },
  },
  /** The same cut without the voice, at the game's own levels (as demo2-open: the sparse mix misses -14 LUFS). */
  "demo2-more-silent": { shots: DEMO2_MORE, crossfadeMs: 0, endCard: DEMO2_END, loudness: null },
  /**
   * The opening 25 seconds of the film, version 2 (plan/submission/demo-video-script-v2.md, parts A and B): straight
   * cuts on the sounds, the game's sound and the music bed, no narration yet, and no corner label (the dark stage shows
   * no room; the label returns with the room in part C). Two captions, in the game's serif.
   */
  "demo2-open": {
    shots: DEMO2_OPEN,
    crossfadeMs: 0,
    // The game's own levels for now: on this sparse mix (chimes over the music bed, no voice) the two-pass loudness
    // step lands 0.8 LU short of its target every time (-14.8 for -14, -15.8 for -15). The narration fixes the level.
    loudness: null,
    captions: [
      { text: "Near pieces swing wide. Far pieces barely move.", shot: "demo2-depth", atSec: 2.2, sec: 4.6 },
      { text: "Your hand casts shadows too.", shot: "demo2-hand", atSec: 0.6, sec: 3.6 },
    ],
  },
  /**
   * The film: the cold open, the room, lesson 1, Box No. 3's finger lock and opening, the Daily Box, sharing on the 2D
   * page, a Touch controller, the end card. Game sound and music only (its voice-over is made later from
   * plan/submission/demo-narration-cues.md); every shot is emulator footage, and says so in the corner.
   */
  demo: {
    shots: DEMO_SHOTS,
    crossfadeMs: 500,
    endCard: { ...END_CARD, holdSec: 5 },
    label: { text: "Emulator footage", shots: DEMO_SHOTS },
  },
  /** Proves the cut step: the sample twice, a half-second crossfade, one music bed, -14 LUFS. */
  "concat-check": { shots: ["sample", "sample"], crossfadeMs: 500 },
  /** Proves the end card: the sample, then the card over a blurred hold of its last frame. */
  "card-check": { shots: ["sample"], crossfadeMs: 0, endCard: END_CARD },
  /** Proves the voice-over mix: needs video-assets/narration-check.wav (any speech or test tone). */
  "narration-check": { shots: ["sample"], crossfadeMs: 0, narration: { file: "video-assets/narration-check.wav", startSec: 1, duckDb: 8 } },
};
