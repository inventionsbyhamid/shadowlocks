// The landing page in the language shown (the hosted link: box art, the name, "Open the box"; the installed apps
// show only its status). It starts in the headset's language, before the profile is open: the page's lang, the
// button, the tagline, the facts, the meta description and the status. Its one status line is kept as which line it
// is, not as its text: a new language paints it again, and "is the failure still up?" holds in any language.
import { applyLanguage, type Copy, copy, LANG_TAGS, type Lang, localNotice, onLangChange } from "../i18n";

/** A status line: its words in the table given. */
export type StatusLine = (c: Copy) => string;

export const LOADING: StatusLine = (c) => c.landing.loading;
export const ENTER_FAILED: StatusLine = (c) => c.page.enterFailed;
export const NO_XR: StatusLine = (c) => c.page.noXr;

/** A notice raised in English, as a status line (shown in the language up). */
export function noticeLine(text: string): StatusLine {
  return () => localNotice(text);
}

/** The parts of the page the landing reads and paints. */
export interface LandingDoc {
  documentElement: { lang: string };
  getElementById(id: string): { textContent: string | null } | null;
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

/** The headset's language (Language "auto") as the page's: applied, and the page's lang set. Returns it. */
export function startLanguage(doc: LandingDoc, prefs?: readonly string[]): Lang {
  const l = applyLanguage("auto", prefs);
  doc.documentElement.lang = LANG_TAGS[l];
  return l;
}

export class Landing {
  private shown: StatusLine | null = null;

  constructor(private readonly doc: LandingDoc) {
    // index.html says "Loading" until the page takes over.
    if (doc.getElementById("status")?.textContent === "Loading") this.shown = LOADING;
    this.paint();
    onLangChange(() => this.paint());
  }

  /** The status line up now (null: none). */
  get line(): StatusLine | null {
    return this.shown;
  }

  /** Show this status line (null: none). */
  say(line: StatusLine | null): void {
    this.shown = line;
    this.paintStatus();
  }

  /** Take the status away if it is still `line`. */
  clear(line: StatusLine): void {
    if (this.shown === line) this.say(null);
  }

  /** Show `line` for `ms` if nothing else is up, then take it away unless another line came meanwhile. */
  sayBriefly(line: StatusLine, ms = 6000, later: (fn: () => void, ms: number) => unknown = setTimeout): void {
    if (this.shown !== null) return;
    this.say(line);
    later(() => this.clear(line), ms);
  }

  /** Every word of the page in the language shown. */
  paint(): void {
    const c = copy().landing;
    for (const [id, text] of [
      ["enter", c.open],
      ["tagline", c.tagline],
      ["facts", c.facts],
      ["seat", c.seat],
    ] as const) {
      const el = this.doc.getElementById(id);
      if (el) el.textContent = text;
    }
    this.doc.querySelector('meta[name="description"]')?.setAttribute("content", c.description);
    this.paintStatus();
  }

  private paintStatus(): void {
    const el = this.doc.getElementById("status");
    if (el) el.textContent = this.shown ? this.shown(copy()) : "";
  }
}
