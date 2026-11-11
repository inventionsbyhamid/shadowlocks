// The menus' fixed text (titles, key legends, section heads, notes the generated UIKitML carries in English) and
// the words each shows, by element id and screen. The menus paint them with the rest of a screen, so a panel shows
// the language chosen whenever it is painted (on opening, and when the language changes); PanelView writes only
// what changed. Text a screen's view paints from its state (counts, names, values) is not here.
// tests/unit/ui-labels.test.ts checks every text in public/ui is here or painted by its view.
import type { Screen } from "../../app/screens";
import type { Copy } from "../../i18n";
import type { PanelUi } from "./types";

type Label = readonly [id: string, words: (c: Copy) => string];

export const PANEL_LABELS: Readonly<Partial<Record<Screen, readonly Label[]>>> = {
  home: [
    // The name too: on a Japanese panel PanelView keeps its space from being a zero-width place to break.
    ["home-title", (c) => c.panels.home.title],
    ["home-tagline", (c) => c.panels.home.tagline],
    ["home-continue-label", (c) => c.panels.home.continue],
    ["home-daily-label", (c) => c.game.daily],
    ["home-lessons-label", (c) => c.panels.home.lessons],
    ["home-collection-label", (c) => c.panels.home.collection],
    ["home-settings-label", (c) => c.panels.home.settings],
    ["home-settings-sub", (c) => c.panels.home.settingsSub],
  ],
  lessons: [
    ["lessons-title", (c) => c.panels.lessons.title],
    ["lessons-back-label", (c) => c.panels.back],
    ["lessons-examples-head", (c) => c.panels.lessons.examples],
    ["lessons-tips-head", (c) => c.panels.lessons.tips],
    ["lessons-none-line", (c) => c.panels.lessons.none],
  ],
  collection: [
    ["coll-title", (c) => c.panels.collection.title],
    ["collection-back-label", (c) => c.panels.back],
    ["coll-empty-line", (c) => c.panels.collection.empty],
    ["coll-newer-label", (c) => c.panels.collection.newer],
    ["coll-older-label", (c) => c.panels.collection.older],
  ],
  settings: [
    ["settings-title", (c) => c.panels.settings.title],
    ["settings-note", (c) => c.panels.settings.note],
    ["settings-language-label", (c) => c.settings.language],
    ["music-label", (c) => c.settings.music],
    ["effects-label", (c) => c.settings.effects],
    ["box-label", (c) => c.settings.boxSize],
    ["settings-recenter-label", (c) => c.panels.settings.recenter],
    ["settings-reset-label", (c) => c.panels.settings.reset],
    ["settings-reset-sub", (c) => c.panels.settings.resetSub],
    ["toggle-warmth-label", (c) => c.settings.warmth],
    ["toggle-warmth-sub", (c) => c.settings.warmthSub],
    ["toggle-captions-label", (c) => c.settings.captions],
    ["toggle-captions-sub", (c) => c.settings.captionsSub],
    ["toggle-motion-label", (c) => c.settings.motion],
    ["toggle-motion-sub", (c) => c.settings.motionSub],
    ["toggle-dimming-label", (c) => c.settings.dimming],
    ["toggle-dimming-sub", (c) => c.settings.dimmingSub],
    ["toggle-hand-label", (c) => c.settings.hand],
    ["toggle-hand-sub", (c) => c.settings.handSub],
    ["toggle-voice-label", (c) => c.settings.voice],
    ["toggle-voice-sub", (c) => c.settings.voiceSub],
    ["settings-done-label", (c) => c.panels.settings.done],
  ],
  reset: [
    ["reset-title", (c) => c.panels.reset.title],
    ["reset-body", (c) => c.panels.reset.body],
    ["reset-keeps", (c) => c.panels.reset.keeps],
    ["reset-keep-label", (c) => c.panels.reset.keep],
    ["reset-confirm-label", (c) => c.panels.reset.confirm],
  ],
  trial: [
    ["trial-title", (c) => c.panels.trial.title],
    ["trial-back-label", (c) => c.panels.back],
    ["trial-keeps", (c) => c.panels.trial.keeps],
    ["trial-buy-label", (c) => c.panels.trial.buy],
    ["trial-buy-sub", (c) => c.panels.trial.buySub],
    ["trial-store-label", (c) => c.panels.trial.store],
    ["trial-store-sub", (c) => c.panels.trial.storeSub],
  ],
};

/** Paint `screen`'s fixed text in the words of table `c`. */
export function paintLabels(ui: PanelUi, screen: Screen, c: Copy): void {
  for (const [id, words] of PANEL_LABELS[screen] ?? []) ui.text(id, words(c));
}
