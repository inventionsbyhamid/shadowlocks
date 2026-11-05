// Every shot, by name (SHOTS=<name>). A shot's name is its file name.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Shot } from "../lib/shot";
import sample from "./sample";

export const SHOTS: Record<string, Shot<any>> = {
  sample,
};
