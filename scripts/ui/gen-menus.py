#!/usr/bin/env python3
"""Writes public/ui/*.uikitml for the menus: python3 scripts/ui/gen-menus.py public/ui

Shared classes and keycap helpers live in ui_common.py. Edit the generators, not the generated
files; tests/unit/ui-generated.test.ts checks they are in sync. The words here are the English
defaults: every text has an id, and the menus paint each one in the language shown (fixed labels
through src/ui/menus/labels.ts, the rest from the panels' views; tests/unit/ui-labels.test.ts checks
none is left out). The words themselves live in src/ui/copy.ts and its tables.

Every panel stands on the box's drawer, so they grow upward (anchor bottom). Keys are at least
40 mm and at least 12 mm apart (comfort envelope)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ui_common import CREST, HEADER, back_key, cta_key, head, key, label_key, sub_key

OUT = pathlib.Path(sys.argv[1])

# ---------------- home ----------------
# Continue (gold foil) on the left, two rows of two on the right, the trial row under them (only
# in the store edition's paywall update), the storage notice above.
home = HEADER + head("""
  #home-root { width: 420; }
  #home-notice { display: none; flex-direction: column; justify-content: center; padding-left: 16; padding-right: 8; height: 22; background-color: #121016; border-radius: 6; border-width: 0.6; border-color: #3A3236; }
  .notice-dot { position-type: absolute; position-left: 7; position-top: 8.5; background-color: #FFD36A; }
  .notice-text { font-size: 10; font-weight: medium; color: #F3D9A0; }
  .home-body { flex-direction: row; gap: 12; }
  .home-cta { width: 140; height: 108; }
  .home-grid { flex-grow: 1; flex-direction: column; gap: 12; }
  .home-cta-cap { justify-content: flex-end; padding-bottom: 12; gap: 4; }
  .home-cta-label { font-size: 15; font-weight: extra-bold; }
  .home-cta-no { position-type: absolute; position-left: 12; position-top: 6; font-size: 46; font-weight: extra-bold; color: #1C191D; }
  #home-trial-row { display: none; }
""") + f"""<div id="home-root" class="root">
  {CREST}
  <div class="head">
    <div class="title">Shadow Locks</div>
    <div class="meta-row">
      <div class="led"></div>
      <div id="home-tagline" class="meta">A puzzle box of light</div>
    </div>
  </div>
  <div id="home-notice">
    <div class="dot notice-dot"></div>
    <div id="home-notice-text" class="notice-text">Progress will not be saved on this device.</div>
  </div>
  <div class="home-body">
    {key("home-continue", "putty", '''<div id="home-continue-no" class="label home-cta-no">1</div>
          <div id="home-continue-label" class="label-cta home-cta-label">Continue</div>
          <div id="home-continue-sub" class="sub ink-soft">Box No. 1</div>''', "slot-fixed home-cta", "home-cta-cap")}
    <div class="home-grid">
      <div class="row">
        {sub_key("home-daily", "graphite", "Daily Box", "After Box No. 3", "slot slot-sm")}
        {sub_key("home-lessons", "graphite", "Lessons", "Watch again", "slot slot-sm", dot=True)}
      </div>
      <div class="row">
        {sub_key("home-collection", "graphite", "Collection", "Empty so far", "slot slot-sm")}
        {sub_key("home-settings", "graphite", "Settings", "Sound and size", "slot slot-sm")}
      </div>
    </div>
  </div>
  <div id="home-trial-row" class="row">
    {cta_key("home-trial", "graphite", "Your trial: 7 days left", "Unlock the full game", "slot slot-sm")}
  </div>
</div>
"""

# ---------------- lessons ----------------
# One key per example (always there) and one per tip seen so far (slots painted from code).
EXAMPLES = [("lesson-move", "Move the light"), ("lesson-near-far", "Near and far"), ("lesson-rings", "Sight the rings"), ("lesson-finger", "Lend a hand")]

def wrap_key(id, label, dot=False):
    mark = '<div class="ghost-dot"></div>\n          ' if dot else ""
    return key(id, "graphite", f"""{mark}<div id="{id}-label" class="label-wrap">{label}</div>""", "slot slot-md", "cap-center")

lessons = HEADER + head("""
  #lessons-root { width: 420; }
  #lessons-none { display: none; height: 52; justify-content: center; }
""") + f"""<div id="lessons-root" class="root">
  {CREST}
  <div class="head-tall">
    <div id="lessons-title" class="title">Lessons</div>
    {back_key("lessons-back")}
  </div>
  <div id="lessons-examples-head" class="section">Examples: poke one to watch it again</div>
  <div class="row">
    {"".join(wrap_key(i, l, dot=True) for i, l in EXAMPLES)}
  </div>
  <div id="lessons-tips-head" class="section">Tips</div>
  <div id="lessons-tips" class="row">
    {"".join(wrap_key(f"tip-{i}", "Tip") for i in range(4))}
  </div>
  <div id="lessons-none" class="row">
    <div id="lessons-none-line" class="line-dim">Tips you meet in the boxes show up here.</div>
  </div>
</div>
"""

# ---------------- collection ----------------
def card(i):
    return f"""<div id="coll-card-{i}" class="card plate">
      <div id="coll-card-{i}-title" class="card-title">Box No. 1</div>
      <div id="coll-card-{i}-owner" class="card-line">Off the desk of the Clockmaker.</div>
      <div id="coll-card-{i}-loot" class="card-line card-loot">Inside: the harbour ledger.</div>
    </div>"""

collection = HEADER + head("""
  #collection-root { width: 420; }
  .cards { flex-direction: row; gap: 12; }
  .card { flex-grow: 1; flex-basis: 0; flex-direction: column; gap: 5; padding-top: 10; padding-bottom: 11; padding-left: 9; padding-right: 9; }
  .card-title { font-size: 12; font-weight: extra-bold; color: #FFD36A; }
  .card-line { font-size: 9.5; font-weight: medium; color: #EFE6D2; }
  .card-loot { color: #CDB27A; }
  #coll-empty { display: none; height: 60; justify-content: center; align-items: center; }
  .coll-page { flex-grow: 1; justify-content: center; align-items: center; }
  .slot-pager { width: 100; height: 44; }
""") + f"""<div id="collection-root" class="root">
  {CREST}
  <div class="head-tall">
    <div class="meta-row">
      <div id="coll-title" class="title">Collection</div>
      <div id="coll-count" class="meta">No rewards yet</div>
    </div>
    {back_key("collection-back")}
  </div>
  <div id="coll-cards" class="cards">
    {"".join(card(i) for i in range(3))}
  </div>
  <div id="coll-empty" class="row">
    <div id="coll-empty-line" class="line-dim">Open a box to find its first reward.</div>
  </div>
  <div id="coll-pager" class="row">
    {label_key("coll-newer", "graphite", "Newer", "slot-fixed slot-pager")}
    <div class="coll-page"><div id="coll-page" class="line-dim">1 to 3 of 3</div></div>
    {label_key("coll-older", "graphite", "Older", "slot-fixed slot-pager")}
  </div>
</div>
"""

# ---------------- settings ----------------
def slider(prefix, label, value):
    segs = "".join(f'<div id="{prefix}-seg-{i}" class="seg"></div>' for i in range(10))
    minus = key(f"{prefix}-down", "graphite", f'<div class="cap-row"><div id="{prefix}-down-bar" class="bar-h"></div></div>', "slot-fixed slot-square")
    plus = key(f"{prefix}-up", "graphite", f'<div class="cap-row"><div class="plus"><div id="{prefix}-up-bar" class="bar-h"></div><div id="{prefix}-up-bar-v" class="bar-v"></div></div></div>', "slot-fixed slot-square")
    return f"""<div class="cell">
        {minus}
        <div class="readout plate">
          <div class="readout-top">
            <div id="{prefix}-label" class="readout-label">{label}</div>
            <div id="{prefix}-value" class="readout-value">{value}</div>
          </div>
          <div class="meter">{segs}</div>
        </div>
        {plus}
      </div>"""

def toggle(id, label, sub):
    # Latching key: lit gold cap, a gold LED and "On" when on; black glass and "Off" when off.
    return key(id, "graphite", f"""<div id="{id}-label" class="label-sm">{label}</div>
          <div class="toggle-row"><div id="{id}-led" class="toggle-led"></div><div id="{id}-state" class="toggle-state">Off</div><div id="{id}-sub" class="sub ink-dim toggle-sub">{sub}</div></div>""", "slot slot-sm", "toggle-cap")

def language_row():
    # One key: poke it for the next language (Automatic, then each language in its own name, and round). The
    # value and the language Automatic picked are drawn in the font that has every language's letters.
    return f"""<div class="row">
    {key("settings-language", "graphite", '''<div id="settings-language-label" class="label-sm">Language</div>
          <div class="lang-values"><div id="settings-language-value" class="lang-value">Automatic</div><div id="settings-language-sub" class="sub ink-dim lang-name">English</div></div>''', "slot slot-sm", "lang-cap")}
  </div>"""

settings = HEADER + head("""
  #settings-root { width: 456; }
  .cells { flex-direction: row; gap: 12; }
  .cell { flex-grow: 1; flex-basis: 0; flex-direction: row; align-items: center; gap: 8; height: 44; }
  .readout { flex-grow: 1; flex-basis: 0; height: 44; flex-direction: column; justify-content: center; gap: 5; padding-left: 8; padding-right: 8; }
  .readout-top { flex-direction: row; justify-content: space-between; align-items: center; gap: 3; }
  .readout-label { font-size: 10; font-weight: bold; color: #CDB27A; }
  .readout-value { font-size: 11.5; font-weight: bold; color: #FFD36A; flex-shrink: 0; }
  .meter { flex-direction: row; gap: 1.2; }
  .seg { flex-grow: 1; height: 4; border-radius: 0.6; background-color: #3A3236; }
  .keys2 { flex-grow: 1; flex-basis: 0; flex-direction: row; gap: 12; }
  .toggle-cap { padding-left: 9; padding-right: 9; }
  .toggle-row { flex-direction: row; align-items: center; gap: 4; }
  .toggle-led { width: 6; height: 6; border-radius: 3; background-color: #3A3236; }
  .toggle-state { font-size: 10.5; font-weight: bold; flex-shrink: 0; }
  .toggle-sub { flex-shrink: 0; }
  .lang-cap { flex-direction: row; align-items: center; justify-content: space-between; }
  .lang-values { flex-direction: row; align-items: center; gap: 8; }
  .lang-value { font-size: 11.5; font-weight: bold; color: #FFD36A; }
""") + f"""<div id="settings-root" class="root">
  {CREST}
  <div class="head">
    <div id="settings-title" class="title">Settings</div>
    <div id="settings-note" class="meta">Changes apply right away</div>
  </div>
  {language_row()}
  <div class="cells">
    {slider("music", "Music", "70%")}
    {slider("effects", "Effects", "90%")}
  </div>
  <div class="cells">
    {slider("box", "Box size", "24 cm")}
    <div class="keys2">
      {label_key("settings-recenter", "graphite", "Recenter")}
      {sub_key("settings-reset", "graphite", "Reset", "All progress")}
    </div>
  </div>
  <div class="row">
    {toggle("toggle-warmth", "Warmth", "Glow, hums")}
    {toggle("toggle-captions", "Captions", "Text cues")}
    {toggle("toggle-motion", "Less motion", "No bounce")}
  </div>
  <div class="row">
    {toggle("toggle-dimming", "Dim room", "In play")}
    {toggle("toggle-hand", "Left hand", "Mirrored")}
    {key("settings-done", "putty", '<div id="settings-done-label" class="label-sm">Done</div>', "slot slot-sm", "cap-center")}
  </div>
</div>
"""

# ---------------- reset (confirm) ----------------
reset = HEADER + head("""
  #reset-root { width: 360; }
  .reset-lines { flex-direction: column; gap: 4; }
""") + f"""<div id="reset-root" class="root">
  {CREST}
  <div class="head">
    <div id="reset-title" class="title">Reset progress?</div>
  </div>
  <div class="reset-lines">
    <div id="reset-body" class="line">Boxes, lessons, the collection and the streak start over.</div>
    <div id="reset-keeps" class="line-dim">Your settings stay.</div>
  </div>
  <div class="row">
    {label_key("reset-keep", "graphite", "Keep it")}
    {label_key("reset-confirm", "danger", "Reset")}
  </div>
</div>
"""

# ---------------- trial ----------------
# The store edition's paywall update only: the days left, Buy in the installed app, the store link
# on the web. Which of Buy and the store link shows is painted from code.
trial = HEADER + head("""
  #trial-root { width: 400; }
  .trial-lines { flex-direction: column; gap: 4; }
  #trial-keeps { display: none; }
  #trial-status { display: none; font-size: 10.5; font-weight: medium; color: #FFD36A; }
""") + f"""<div id="trial-root" class="root">
  {CREST}
  <div class="head-tall">
    <div id="trial-title" class="title">Unlock the full game</div>
    {back_key("trial-back")}
  </div>
  <div class="trial-lines">
    <div id="trial-days" class="line">Your trial: 7 days left</div>
    <div id="trial-keeps" class="line-dim">The Daily Box and the lessons stay open.</div>
  </div>
  {cta_key("trial-buy", "putty", "Buy", "One time, yours to keep")}
  {cta_key("trial-store", "putty", "Get it on the Meta Horizon Store", "Opens the store page")}
  <div id="trial-status">Thank you. The full game is yours.</div>
</div>
"""

for name, src in [("home", home), ("lessons", lessons), ("collection", collection), ("settings", settings), ("reset", reset), ("trial", trial)]:
    (OUT / f"{name}.uikitml").write_text(src)
    print(name, len(src))
