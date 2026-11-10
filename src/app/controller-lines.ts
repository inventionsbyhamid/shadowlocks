// With controllers in hand (and no phone) the coach lines that ask for a free hand or a pointed finger say it the
// controllers' way: "Set a controller down and put that hand inside the box." for "Now put your free hand inside the
// box.", and so on. A controller pokes keys and lifts the lantern and the reward as a hand does, so every other line
// stands. Lines stay English until the chip shows them (localLine finds COPY.controller in every table), as a phone's
// do (phone-lines.ts).
import { COPY } from "../ui/copy";

const CONTROLLER: ReadonlyMap<string, string> = new Map([
  [COPY.lessons.puppets, COPY.controller.puppets],
  [COPY.lessons.turnFinger, COPY.controller.turnFinger],
]);

/** `en` as a controller player is told it (in English; the chip translates): its wording where there is one, else `en`. */
export function controllerLine(en: string | null): string | null {
  return en === null ? null : (CONTROLLER.get(en) ?? en);
}
