#!/usr/bin/env python3
"""Writes public/ui/*.uikitml for the menus: python3 scripts/ui/gen-menus.py public/ui

Shared classes and keycap helpers live in ui_common.py. Edit the generators, not the generated
files; tests/unit/ui-generated.test.ts checks they are in sync. Labels here are fixed panel text;
text painted from code lives in src/ui/copy.ts."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ui_common import HEADER, head, key, label_key

OUT = pathlib.Path(sys.argv[1])

# ---------------- home ----------------
home = HEADER + head("""
  #home-root { width: 360; }
  #home-notice { display: none; flex-direction: column; justify-content: center; padding-left: 16; padding-right: 8; height: 22; background-color: #3B2A1C; border-radius: 6; }
  .notice-dot { position-type: absolute; position-left: 7; position-top: 8.5; background-color: #FFB347; }
  .notice-text { font-size: 10; font-weight: medium; color: #FFD9A8; }
""") + f"""<div id="home-root" class="root">
  <div class="head">
    <div class="title">Shadow Locks</div>
    <div class="meta-row">
      <div class="led"></div>
      <div class="meta">Seated puzzle box</div>
    </div>
  </div>
  <div id="home-notice">
    <div class="dot notice-dot"></div>
    <div id="home-notice-text" class="notice-text">Progress will not be saved on this device.</div>
  </div>
  <div class="row">
    {label_key("home-recenter", "graphite", "Recenter")}
    {label_key("home-settings", "putty", "Settings")}
  </div>
</div>
"""

# ---------------- settings ----------------
def slider(prefix, label, value):
    segs = "".join(f'<div id="{prefix}-seg-{i}" class="seg"></div>' for i in range(10))
    minus = key(f"{prefix}-down", "graphite", f'<div class="cap-row"><div id="{prefix}-down-bar" class="bar-h"></div></div>', "slot-fixed slot-square")
    plus = key(f"{prefix}-up", "graphite", f'<div class="cap-row"><div class="plus"><div id="{prefix}-up-bar" class="bar-h"></div><div id="{prefix}-up-bar-v" class="bar-v"></div></div></div>', "slot-fixed slot-square")
    return f"""<div class="cell">
      <div class="cell-label">{label}</div>
      <div class="cell-row">
        {minus}
        <div class="readout">
          <div id="{prefix}-value" class="readout-value">{value}</div>
          <div class="meter">{segs}</div>
        </div>
        {plus}
      </div>
    </div>"""

def toggle(id, label, sub):
    # Latching key: lit brass cap, amber LED and "On" when on; walnut and "Off" when off.
    return key(id, "graphite", f"""<div class="label-sm">{label}</div>
          <div class="toggle-row"><div id="{id}-led" class="toggle-led"></div><div id="{id}-state" class="toggle-state">Off</div><div id="{id}-sub" class="sub ink-dim toggle-sub">{sub}</div></div>""", "slot slot-sm toggle-slot", "toggle-cap")

settings = HEADER + head("""
  #settings-root { width: 456; }
  .cells { flex-direction: row; gap: 14; }
  .cell { flex-grow: 1; flex-basis: 0; flex-direction: column; gap: 4; }
  .cell-label { font-size: 10.5; font-weight: bold; color: #F1E6D2; height: 14; }
  .cell-row { flex-direction: row; align-items: center; gap: 10; height: 44; }
  .readout { flex-grow: 1; flex-basis: 0; height: 40; flex-direction: column; align-items: center; justify-content: center; gap: 4; background-color: #1F1711; border-radius: 6; border-width: 1; border-color: #17110D; }
  .readout-value { font-size: 11.5; font-weight: bold; color: #FFB347; }
  .meter { flex-direction: row; gap: 0.9; }
  .seg { width: 2.4; height: 4; border-radius: 0.6; background-color: #3B2A1C; }
  .settings-done { width: 62; }
  .toggle-slot { flex-grow: 1; }
  .toggle-cap { padding-left: 9; padding-right: 9; }
  .toggle-row { flex-direction: row; align-items: center; gap: 4; }
  .toggle-led { width: 6; height: 6; border-radius: 3; background-color: #3B2A1C; }
  .toggle-state { font-size: 10.5; font-weight: bold; flex-shrink: 0; }
  .toggle-sub { flex-shrink: 0; }
""") + f"""<div id="settings-root" class="root">
  <div class="head">
    <div class="title">Settings</div>
    <div class="meta">Changes apply right away</div>
  </div>
  <div class="cells">
    {slider("music", "Music", "70%")}
    {slider("effects", "Effects", "90%")}
  </div>
  <div class="cells">
    {slider("box", "Box size", "24 cm")}
    <div class="cell">
      <div class="cell-label">Box placement</div>
      <div class="cell-row">
        {label_key("settings-recenter", "graphite", "Recenter")}
      </div>
    </div>
  </div>
  <div class="row">
    {toggle("toggle-captions", "Captions", "Text cues")}
    {toggle("toggle-motion", "Less motion", "No bounce")}
    {toggle("toggle-dimming", "Dim room", "In play")}
    {key("settings-done", "putty", '<div class="label-sm">Done</div>', "slot-fixed slot-sm settings-done", "cap-center")}
  </div>
</div>
"""

for name, src in [("home", home), ("settings", settings)]:
    (OUT / f"{name}.uikitml").write_text(src)
    print(name, len(src))
