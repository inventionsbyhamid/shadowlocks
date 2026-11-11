// Every word on the menu panels is painted in the language shown: each text in the generated UIKitML is either a
// fixed label the menus paint from the label map (the game's name too), or painted by its screen's view from its
// state. A new text in the generator without either fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Screen } from "../../src/app/screens";
import { tableFor } from "../../src/i18n";
import { PANEL_LABELS, paintLabels } from "../../src/ui/menus/labels";
import { recorder } from "./helpers/ui";

const SCREENS = ["home", "lessons", "collection", "settings", "reset", "trial"] as const satisfies readonly Screen[];

const each = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

/** Texts a screen's view paints from its state (counts, names, values, notices). */
const PAINTED: Record<(typeof SCREENS)[number], readonly string[]> = {
  home: ["home-notice-text", "home-continue-no", "home-continue-sub", "home-daily-sub", "home-lessons-sub", "home-collection-sub", "home-trial-label", "home-trial-sub"],
  lessons: [...["move", "near-far", "rings", "finger"].map((e) => `lesson-${e}-label`), ...each(4, (i) => `tip-${i}-label`)],
  collection: ["coll-count", "coll-page", ...["title", "owner", "loot"].flatMap((part) => each(3, (i) => `coll-card-${i}-${part}`))],
  settings: ["music-value", "effects-value", "box-value", "settings-language-value", "settings-language-sub", ...["warmth", "captions", "motion", "dimming", "hand", "voice"].map((t) => `toggle-${t}-state`)],
  reset: [],
  trial: ["trial-days", "trial-status"],
};

/** Each text in a UIKitML file: its element's id (or null) and its words. */
function texts(screen: string): { id: string | null; words: string }[] {
  const src = readFileSync(`public/ui/${screen}.uikitml`, "utf8");
  const out: { id: string | null; words: string }[] = [];
  for (const m of src.matchAll(/<div((?:\s+[a-z-]+="[^"]*")*)\s*>([^<]+)<\/div>/g)) {
    const words = (m[2] ?? "").trim();
    if (!words) continue;
    out.push({ id: /\sid="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? null, words });
  }
  return out;
}

describe("menu labels", () => {
  it.each(SCREENS)("every text on the %s panel is painted in the language shown", (screen) => {
    const known = new Set([...(PANEL_LABELS[screen] ?? []).map(([id]) => id), ...PAINTED[screen]]);
    // No exemptions: even the game's name goes through PanelView (a Japanese panel draws a plain space as nothing).
    const left = texts(screen).filter((t) => !(t.id && known.has(t.id)));
    expect(left.map((t) => `${t.id ?? "(no id)"}: ${t.words}`)).toEqual([]);
  });

  it.each(SCREENS)("every label of the %s panel names an element that is there", (screen) => {
    const ids = new Set(texts(screen).map((t) => t.id));
    for (const [id] of PANEL_LABELS[screen] ?? []) expect(ids.has(id), id).toBe(true);
  });

  it("paints the fixed labels in the language asked for, and English as the generator wrote it", () => {
    const de = recorder();
    paintLabels(de.ui, "home", tableFor("de"));
    expect(de.calls).toContain("text home-continue-label Weiter");
    expect(de.calls).toContain("text home-daily-label Tagesbox");
    const en = recorder();
    paintLabels(en.ui, "settings", tableFor("en"));
    // English painted over the generated English changes nothing.
    const generated = new Map(texts("settings").map((t) => [t.id, t.words]));
    for (const call of en.calls) {
      const [, id, ...words] = call.split(" ");
      expect(words.join(" "), id).toBe(generated.get(id ?? ""));
    }
  });
});
