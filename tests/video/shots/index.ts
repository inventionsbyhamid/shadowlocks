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
import demo2DBest from "./demo2-d-best";
import demo2DBox1 from "./demo2-d-box1";
import demo2DBox7 from "./demo2-d-box7";
import demo2DBox22 from "./demo2-d-box22";
import demo2DBox80 from "./demo2-d-box80";
import demo2DBox500 from "./demo2-d-box500";
import demo2DCollection from "./demo2-d-collection";
import demo2DController from "./demo2-d-controller";
import demo2DDailyCard from "./demo2-d-daily-card";
import demo2DDailyHome from "./demo2-d-daily-home";
import demo2DHand from "./demo2-d-hand";
import demo2DLetgo from "./demo2-d-letgo";
import demo2DShare from "./demo2-d-share";
import demo2EOpen from "./demo2-e-open";
import demo2Depth from "./demo2-depth";
import demo2Hand from "./demo2-hand";
import demo2Hook from "./demo2-hook";
import demo2Light from "./demo2-light";
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
  // The film, version 2: part D (more: endless boxes, records, the Daily Box, controllers and letting go) and part E's
  // held frame, on the dark stage (edits.ts "demo2-more").
  "demo2-d-box1": demo2DBox1,
  "demo2-d-box7": demo2DBox7,
  "demo2-d-box22": demo2DBox22,
  "demo2-d-box80": demo2DBox80,
  "demo2-d-box500": demo2DBox500,
  "demo2-d-best": demo2DBest,
  "demo2-d-collection": demo2DCollection,
  "demo2-d-daily-home": demo2DDailyHome,
  "demo2-d-daily-card": demo2DDailyCard,
  "demo2-d-hand": demo2DHand,
  "demo2-d-controller": demo2DController,
  "demo2-d-letgo": demo2DLetgo,
  "demo2-e-open": demo2EOpen,
};

// Shots of the game's 2D page in a browser window (lib/page-shot.ts), by name like the others.
export const PAGE_SHOTS: Record<string, PageShot> = {
  "demo-share": demoShare,
  "demo2-d-share": demo2DShare,
};
