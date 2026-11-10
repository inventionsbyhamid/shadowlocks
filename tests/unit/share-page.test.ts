// The 2D page's sharing parts: the landing for a shared link (what was shared, what the friend says, what Open the box
// does), Meta's Web Launch "Open on my Meta Quest" and "Copy link" on a computer or phone (never on a headset), and
// after a session the result's text with its share button (the system share sheet where there is one, else the
// clipboard, else a plain word to take a screenshot or copy the text). Words with textContent only, in the language
// shown.
import { afterEach, describe, expect, it } from "vitest";
import { type PageEl, type ShareEnv, SharePage } from "../../src/app/share-page";
import type { SharedLink } from "../../src/core/share";
import { formatDay, setLang, tableFor } from "../../src/i18n";
import { COPY } from "../../src/ui/copy";

afterEach(() => setLang("en"));

const IDS = ["shared", "shared-line", "shared-says", "shared-note", "share-ways", "quest-launch", "copy-link", "result", "result-text", "share-result", "share-note"];

function fakeDoc() {
  const els: Record<string, PageEl & { attrs: Record<string, string>; click(): Promise<void> }> = {};
  for (const id of IDS) {
    let fn: (() => unknown) | null = null;
    els[id] = {
      textContent: "",
      hidden: true,
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      addEventListener(_t, f) {
        fn = f;
      },
      async click() {
        await fn?.();
      },
    };
  }
  return { getElementById: (id: string) => els[id] ?? null, els };
}

const daily: SharedLink = { target: { kind: "daily", day: "2026-11-10" }, t: 252, h: 1, g: 4 };
const LINK = "https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4";
const launch = (u: string) => `https://www.oculus.com/open_url/?url=${encodeURIComponent(u)}`;

function page(env: Partial<ShareEnv> = {}) {
  const d = fakeDoc();
  const p = new SharePage(d, { quest: false, ...env });
  return { d, els: d.els, p };
}

describe("the landing for a shared link", () => {
  it("a plain visit on a computer: no shared line, Open on my Meta Quest sends the game's address, no Copy link", () => {
    const { els, p } = page();
    p.landed(null, null);
    expect(els.shared!.hidden).toBe(true);
    expect([els["share-ways"]!.hidden, els["quest-launch"]!.hidden, els["copy-link"]!.hidden]).toEqual([false, false, true]);
    expect(els["quest-launch"]!.attrs.href).toBe(launch("https://shadowlocks.pages.dev/"));
    expect(els["quest-launch"]!.textContent).toBe(COPY.share.openQuest);
    expect(els.result!.hidden).toBe(true);
  });

  it("on a headset: neither Open on my Meta Quest nor Copy link", () => {
    const { els, p } = page({ quest: true });
    p.landed(daily, "today");
    expect(els.shared!.hidden).toBe(false);
    expect([els["share-ways"]!.hidden, els["quest-launch"]!.hidden, els["copy-link"]!.hidden]).toEqual([true, true, true]);
  });

  it("says what was shared, what the friend says they did and what Open the box does", () => {
    const { els, p } = page();
    p.landed(daily, "today");
    expect(els["shared-line"]!.textContent).toBe("A friend sent you the Daily Box for Nov 10.");
    expect(els["shared-says"]!.textContent).toBe("Your friend says 4:12, 1 hint.");
    expect(els["shared-note"]!.textContent).toBe(COPY.share.todayTurn);
    expect(els["quest-launch"]!.attrs.href).toBe(launch(LINK));
    expect(els["copy-link"]!.hidden).toBe(false);
    // No hints, a numbered box, another day; no time at all; no hint count.
    p.landed({ target: { kind: "box", n: 12 }, t: 222, h: 0, g: 4 }, "practice");
    expect([els["shared-line"]!.textContent, els["shared-says"]!.textContent, els["shared-note"]!.textContent]).toEqual([
      "A friend sent you Box No. 12.",
      "Your friend says 3:42, no hints.",
      COPY.share.practiceTurn,
    ]);
    p.landed({ ...daily, t: 3723, h: 3 }, "otherDay");
    expect([els["shared-says"]!.textContent, els["shared-note"]!.textContent]).toEqual(["Your friend says 1:02:03, 3 hints.", COPY.share.otherDay]);
    p.landed({ ...daily, h: null }, "today");
    expect(els["shared-says"]!.textContent).toBe("Your friend says 4:12.");
    p.landed({ ...daily, t: null }, "today");
    expect([els["shared-says"]!.textContent, els["shared-says"]!.hidden]).toEqual(["", true]);
    p.landed(daily, "lessonFirst");
    expect(els["shared-note"]!.textContent).toBe(COPY.share.lessonFirst);
  });

  it("follows the language", () => {
    const { els, p } = page();
    p.landed(daily, "today");
    setLang("fr");
    const fr = tableFor("fr").share;
    expect(els["shared-line"]!.textContent).toBe(fr.sentDaily.replace("{day}", formatDay("2026-11-10", "fr")));
    expect(els["shared-note"]!.textContent).toBe(fr.todayTurn);
    expect(els["quest-launch"]!.textContent).toBe(fr.openQuest);
  });

  it("Copy link copies the shared address, or says to copy it from the address bar", async () => {
    const copied: string[] = [];
    const ok = page({ copy: async (t) => void copied.push(t) });
    ok.p.landed(daily, "today");
    await ok.els["copy-link"]!.click();
    expect(copied).toEqual([LINK]);
    expect(ok.els["share-note"]!.textContent).toBe(COPY.share.copied);
    const no = page({ copy: () => Promise.reject(new Error("denied")) });
    no.p.landed(daily, "today");
    await no.els["copy-link"]!.click();
    expect(no.els["share-note"]!.textContent).toBe(COPY.share.copyFailed);
    const none = page();
    none.p.landed(daily, "today");
    await none.els["copy-link"]!.click();
    expect(none.els["share-note"]!.textContent).toBe(COPY.share.copyFailed);
  });
});

describe("sharing a result from the 2D page", () => {
  const offer = { kind: "today" as const, text: `Shadow Locks · Daily Box Nov 10\n🟨 4:12\nStreak 1\n${LINK}`, url: LINK };

  it("shows the text to select by hand and its button; nothing to share hides it", () => {
    const { els, p } = page({ quest: true });
    p.offer(() => offer);
    expect([els.result!.hidden, els["result-text"]!.textContent, els["share-result"]!.textContent]).toEqual([false, offer.text, COPY.share.shareToday]);
    p.offer(() => ({ ...offer, kind: "challenge" }));
    expect(els["share-result"]!.textContent).toBe(COPY.share.challenge);
    p.offer(() => ({ ...offer, kind: "reply" }));
    expect(els["share-result"]!.textContent).toBe(COPY.share.sendBack);
    p.offer(() => null);
    expect(els.result!.hidden).toBe(true);
  });

  it("uses the system share sheet where there is one, else the clipboard, else says to take a screenshot", async () => {
    const sent: string[] = [];
    const sheet = page({ share: async (d) => void sent.push(d.text), copy: () => Promise.reject(new Error("unused")) });
    sheet.p.offer(() => offer);
    await sheet.els["share-result"]!.click();
    expect(sent).toEqual([offer.text]);
    expect(sheet.els["share-note"]!.textContent).toBe("");
    // The sheet closed without sharing: nothing more.
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const cancelled = page({ share: () => Promise.reject(abort), copy: () => Promise.reject(new Error("unused")) });
    cancelled.p.offer(() => offer);
    await cancelled.els["share-result"]!.click();
    expect(cancelled.els["share-note"]!.textContent).toBe("");
    // No sheet (or it failed): the clipboard.
    const copied: string[] = [];
    const clip = page({ share: () => Promise.reject(new Error("NotAllowedError")), copy: async (t) => void copied.push(t) });
    clip.p.offer(() => offer);
    await clip.els["share-result"]!.click();
    expect(copied).toEqual([offer.text]);
    expect(clip.els["share-note"]!.textContent).toBe(COPY.share.copied);
    // Neither: a screenshot, or copy the text by hand.
    const neither = page();
    neither.p.offer(() => offer);
    await neither.els["share-result"]!.click();
    expect(neither.els["share-note"]!.textContent).toBe(COPY.share.manual);
    setLang("es");
    expect(neither.els["share-note"]!.textContent).toBe(tableFor("es").share.manual);
    expect(neither.els["share-result"]!.textContent).toBe(tableFor("es").share.shareToday);
  });
});
