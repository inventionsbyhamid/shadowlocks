// The 2D page's sharing parts (index.html), in the language shown:
// - the landing for a shared link: what was shared, what the friend says they did ("your friend says": a link's time
//   can be edited, and that is fine), and what Open the box does with it;
// - on a computer or a phone (never on a headset), Meta's Web Launch "Open on my Meta Quest" (the shared link, else
//   the game's address) and, for a shared link, "Copy link";
// - after a session, the result's text (selectable by hand) with its share button: the system share sheet where there
//   is one, else the clipboard, else a plain word to take a screenshot or copy the text. The 2D page only: a click
//   there is a real user gesture, which a poke inside XR is not.
// Every word goes in with textContent. Nothing leaves the device but what the player chooses to share.
import { clockText } from "../core/result";
import { type SharedLink, sharedLinkUrl, webLaunchUrl } from "../core/share";
import { copy, count, formatDay, onLangChange } from "../i18n";
import { PUBLIC_ORIGIN } from "../platform/site-origin";
import { fill } from "../ui/copy";
import type { ShareOffer } from "../ui/share-text";

/** The parts of an element the page sets. */
export interface PageEl {
  textContent: string | null;
  hidden: boolean;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "click", fn: () => unknown): void;
}

export interface SharePageDoc {
  getElementById(id: string): PageEl | null;
}

/** What the device offers. */
export interface ShareEnv {
  /** A Meta Quest browser (the headset): no Web Launch, no Copy link. */
  quest: boolean;
  /** The system share sheet (navigator.share), where there is one. */
  share?: (data: { text: string }) => Promise<void>;
  /** The clipboard (navigator.clipboard.writeText), where there is one. */
  copy?: (text: string) => Promise<void>;
}

/** What Open the box does with the shared link (the landing's last line). */
export type LandingNote = "today" | "practice" | "otherDay";

/** The share note's line, kept as which line it is so a new language paints it again. */
type Note = "copied" | "copyFailed" | "manual" | null;

/** The env of this browser: the Quest browser by its user agent; the share sheet and clipboard where they exist. */
export function browserEnv(nav: Navigator, quest: boolean): ShareEnv {
  const env: ShareEnv = { quest };
  if (typeof nav.share === "function") env.share = (d) => nav.share(d);
  if (nav.clipboard && typeof nav.clipboard.writeText === "function") env.copy = (t) => nav.clipboard.writeText(t);
  return env;
}

export class SharePage {
  private link: SharedLink | null = null;
  private landing: LandingNote | null = null;
  private source: (() => ShareOffer | null) | null = null;
  private offered: ShareOffer | null = null;
  private note: Note = null;

  constructor(
    private readonly doc: SharePageDoc,
    private readonly env: ShareEnv,
  ) {
    this.el("copy-link")?.addEventListener("click", () => this.copyLink());
    this.el("share-result")?.addEventListener("click", () => this.shareResult());
    onLangChange(() => this.paint());
  }

  /** The page opened with `link` (null: a plain visit), and what Open the box does with it. */
  landed(link: SharedLink | null, note: LandingNote | null): void {
    this.link = link;
    this.landing = note;
    this.paint();
  }

  /** The result to share now, built in the language shown each time the page paints (null from it: none). */
  offer(source: (() => ShareOffer | null) | null): void {
    this.source = source;
    this.note = null;
    this.paint();
  }

  /** Share the result's text: the share sheet, else the clipboard, else say to take a screenshot or copy it. */
  async shareResult(): Promise<void> {
    const o = this.offered;
    if (!o) return;
    if (this.env.share) {
      try {
        await this.env.share({ text: o.text });
        this.say(null);
        return;
      } catch (err) {
        // Closed without sharing: nothing to say.
        if ((err as { name?: string } | null)?.name === "AbortError") {
          this.say(null);
          return;
        }
      }
    }
    this.say((await this.copied(o.text)) ? "copied" : "manual");
  }

  /** Copy the shared link (or say to copy it from the address bar). */
  async copyLink(): Promise<void> {
    if (!this.link) return;
    this.say((await this.copied(sharedLinkUrl(this.link))) ? "copied" : "copyFailed");
  }

  /** Every word in the language shown. */
  paint(): void {
    const c = copy().share, l = this.link;
    const set = (id: string, text: string) => {
      const e = this.el(id);
      if (!e) return;
      e.textContent = text;
      e.hidden = text === "";
    };
    // The landing for a shared link.
    this.show("shared", l !== null);
    if (l) {
      set("shared-line", l.target.kind === "daily" ? fill(c.sentDaily, { day: formatDay(l.target.day) }) : fill(c.sentBox, { n: l.target.n }));
      const time = l.t === null ? "" : clockText(l.t);
      const hints = l.h === null ? "" : l.h === 0 ? c.noHints : count(l.h, c.hints);
      set("shared-says", l.t === null ? "" : l.h === null ? fill(c.says, { time }) : fill(c.saysHints, { time, hints }));
      const note = this.landing;
      set("shared-note", note === "today" ? c.todayTurn : note === "practice" ? c.practiceTurn : note === "otherDay" ? c.otherDay : "");
    }
    // Web Launch and Copy link: a computer or phone only.
    const away = !this.env.quest;
    this.show("share-ways", away);
    this.show("quest-launch", away);
    this.show("copy-link", away && l !== null);
    const launch = this.el("quest-launch");
    if (launch) {
      launch.textContent = c.openQuest;
      launch.setAttribute("href", webLaunchUrl(l ? sharedLinkUrl(l) : `${PUBLIC_ORIGIN}/`));
    }
    const copyKey = this.el("copy-link");
    if (copyKey) copyKey.textContent = c.copyLink;
    // The result to share.
    const o = (this.offered = this.source?.() ?? null);
    this.show("result", o !== null);
    if (o) {
      const text = this.el("result-text");
      if (text) text.textContent = o.text;
      const key = this.el("share-result");
      if (key) key.textContent = c.shareToday;
    }
    const n = this.note;
    const noteEl = this.el("share-note");
    if (noteEl) noteEl.textContent = n === null ? "" : c[n];
  }

  private say(note: Note): void {
    this.note = note;
    const e = this.el("share-note");
    if (e) e.textContent = note === null ? "" : copy().share[note];
  }

  private async copied(text: string): Promise<boolean> {
    if (!this.env.copy) return false;
    try {
      await this.env.copy(text);
      return true;
    } catch {
      return false;
    }
  }

  private show(id: string, on: boolean): void {
    const e = this.el(id);
    if (e) e.hidden = !on;
  }

  private el(id: string): PageEl | null {
    return this.doc.getElementById(id);
  }
}
