// On a phone (AR in Chrome on Android: the screen is the only input) the coach lines that tell the hands what to do say
// it the phone's way: "Drag the lantern." for "Pick up the lantern.", and so on. Lines stay English until the chip
// shows them (localLine finds COPY.phone in every table). The lessons pick their lines as ever; only the chip swaps.
import { COPY } from "../ui/copy";

const PHONE: ReadonlyMap<string, string> = new Map([
  [COPY.lessons.pickUp, COPY.phone.pickUp],
  [COPY.lessons.slide, COPY.phone.slide],
  [COPY.lessons.finger, COPY.phone.finger],
  [COPY.lessons.drawer, COPY.phone.drawer],
  [COPY.lessons.puppets, COPY.phone.puppets],
  [COPY.lessons.turnFinger, COPY.phone.turnFinger],
  [COPY.lessons.growShrink, COPY.phone.growShrink],
  [COPY.lessons.stuck, COPY.phone.stuck],
  [COPY.lessons.letGo, COPY.phone.letGo],
  [COPY.lessons.boxOpen, COPY.phone.boxOpen],
  // A finger lock waiting: the controller player's suggestion, as a phone fills it.
  [COPY.game.controllerFinger, COPY.phone.finger],
]);

/** `en` as a phone says it (in English; the chip translates): the phone's line where there is one, else `en`. */
export function phoneLine(en: string | null): string | null {
  return en === null ? null : (PHONE.get(en) ?? en);
}
