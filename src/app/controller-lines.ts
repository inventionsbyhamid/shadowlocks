// With controllers in hand (and no phone) the coach lines that ask for a free hand or a pointed finger say it the
// controllers' way: "Set a controller down and put that hand inside the box." for "Now put your free hand inside the
// box.", and so on. A controller pokes keys and lifts the lantern and the reward as a hand does, so every other line
// stands. Lines stay English until the chip shows them (localLine finds COPY.controller in every table), as a phone's
// do (phone-lines.ts).
import { copyAt } from "./phone-lines";

/** By copy path: the line the chip shows with controllers in hand in place of each lessons line. */
export const CONTROLLER_KEYS: Readonly<Record<string, string>> = {
  "lessons.puppets": "controller.puppets",
  "lessons.turnFinger": "controller.turnFinger",
};

const CONTROLLER: ReadonlyMap<string, string> = new Map(Object.entries(CONTROLLER_KEYS).map(([from, to]) => [copyAt(from)!, copyAt(to)!]));

/** `en` as a controller player is told it (in English; the chip translates): its wording where there is one, else `en`. */
export function controllerLine(en: string | null): string | null {
  return en === null ? null : (CONTROLLER.get(en) ?? en);
}
