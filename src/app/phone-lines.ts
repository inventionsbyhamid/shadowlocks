// On a phone (AR in Chrome on Android: the screen is the only input) the coach lines that tell the hands what to do say
// it the phone's way: "Drag the lantern." for "Pick up the lantern.", and so on. Lines stay English until the chip
// shows them (localLine finds COPY.phone in every table). The lessons pick their lines as ever; only the chip swaps.
import { COPY } from "../ui/copy";

/** By copy path: the line the chip shows on a phone in place of each lessons line (the voice guide's clip keys too). */
export const PHONE_KEYS: Readonly<Record<string, string>> = {
  "lessons.pickUp": "phone.pickUp",
  "lessons.slide": "phone.slide",
  "lessons.finger": "phone.finger",
  "lessons.drawer": "phone.drawer",
  "lessons.puppets": "phone.puppets",
  "lessons.turnFinger": "phone.turnFinger",
  "lessons.growShrink": "phone.growShrink",
  "lessons.stuck": "phone.stuck",
  "lessons.letGo": "phone.letGo",
  "lessons.boxOpen": "phone.boxOpen",
  // A finger lock waiting: the controller player's suggestion, as a phone fills it.
  "game.controllerFinger": "phone.finger",
};

/** The English words at copy path `path` ("lessons.goal", "phone.finger"), or undefined. */
export function copyAt(path: string): string | undefined {
  let v: unknown = COPY;
  for (const part of path.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[part] : undefined;
  return typeof v === "string" ? v : undefined;
}

const PHONE: ReadonlyMap<string, string> = new Map(Object.entries(PHONE_KEYS).map(([from, to]) => [copyAt(from)!, copyAt(to)!]));

/** `en` as a phone says it (in English; the chip translates): the phone's line where there is one, else `en`. */
export function phoneLine(en: string | null): string | null {
  return en === null ? null : (PHONE.get(en) ?? en);
}
