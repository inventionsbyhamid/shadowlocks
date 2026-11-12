// Every shot, by name (SHOTS=<name>). A shot's name is its file name.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PageShot } from "../lib/page-shot";
import type { Shot } from "../lib/shot";
import demoBox3 from "./demo-box3";
import demoController from "./demo-controller";
import demoDailyHome from "./demo-daily-home";
import demoDailyOpen from "./demo-daily-open";
import demoFinger from "./demo-finger";
import demoLesson from "./demo-lesson";
import demoRoom from "./demo-room";
import demoShare from "./demo-share";
import demo2Depth from "./demo2-depth";
import demo2Hand from "./demo2-hand";
import demo2Handlook from "./demo2-handlook";
import demo2Hook from "./demo2-hook";
import demo2Light from "./demo2-light";
import demo2PlayFinish from "./demo2-play-finish";
import demo2PlayStart from "./demo2-play-start";
import inlineFinger from "./inline-finger";
import inlineLock from "./inline-lock";
import inlineRoom from "./inline-room";
import sample from "./sample";
import slice from "./slice";

export const SHOTS: Record<string, Shot<any>> = {
  sample,
  // The playable slice for the owner: the first minute, lesson 1, box 3's finger lock.
  slice,
  // The store listing's inline media (scripts/store-inline.sh).
  "inline-room": inlineRoom,
  "inline-lock": inlineLock,
  "inline-finger": inlineFinger,
  // The Devpost demo film, in film order (edits.ts "demo").
  "demo-finger": demoFinger,
  "demo-room": demoRoom,
  "demo-lesson": demoLesson,
  "demo-box3": demoBox3,
  "demo-daily-home": demoDailyHome,
  "demo-daily-open": demoDailyOpen,
  "demo-controller": demoController,
  // The film, version 2 (plan/submission/demo-video-script-v2.md): part A and part B on the dark stage.
  "demo2-hook": demo2Hook,
  "demo2-light": demo2Light,
  "demo2-depth": demo2Depth,
  "demo2-hand": demo2Hand,
  // A close look at the stand-in hand (not in an edit).
  "demo2-handlook": demo2Handlook,
  // Part C (play) in the photographic room.
  "demo2-play-start": demo2PlayStart,
  "demo2-play-finish": demo2PlayFinish,
};

// Shots of the game's 2D page in a browser window (lib/page-shot.ts), by name like the others.
export const PAGE_SHOTS: Record<string, PageShot> = {
  "demo-share": demoShare,
};
