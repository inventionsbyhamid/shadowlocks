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

export const EDITS: Record<string, Edit> = {
  /** Proves the cut step: the sample twice, a half-second crossfade, one music bed, -14 LUFS. */
  "concat-check": { shots: ["sample", "sample"], crossfadeMs: 500 },
  /**
   * Proves the end card: the sample, then the card over a blurred hold of its last frame. The game's
   * own levels (no loudness target), so it cuts while the repo has no sound pack (silence cannot be
   * brought to -14 LUFS).
   */
  "card-check": { shots: ["sample"], crossfadeMs: 0, loudness: null, endCard: END_CARD },
  /** Proves the voice-over mix: needs video-assets/narration-check.wav (any speech or test tone). */
  "narration-check": { shots: ["sample"], crossfadeMs: 0, narration: { file: "video-assets/narration-check.wav", startSec: 1, duckDb: 8 } },
};
