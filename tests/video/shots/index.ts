// Every shot, by name (SHOTS=<name>). A shot's name is its file name.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Shot } from "../lib/shot";
import inlineFinger from "./inline-finger";
import inlineLock from "./inline-lock";
import inlineRoom from "./inline-room";
import sample from "./sample";

export const SHOTS: Record<string, Shot<any>> = {
  sample,
  // The store listing's inline media (scripts/store-inline.sh).
  "inline-room": inlineRoom,
  "inline-lock": inlineLock,
  "inline-finger": inlineFinger,
};
