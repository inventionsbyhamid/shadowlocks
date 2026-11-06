"""The UIKit stylesheet and keycap helpers every generated panel shares.

UIKit keeps one global stylesheet, so a class must mean the same thing in every file: each
generated file starts with COMMON unchanged, and file specific classes go after it.

Ebony and Gold (the owner's look pick, plan/lookdev/shadow-locks/pick.md): a black lacquer panel
with a gold-leaf bezel and a stepped crest on top, drawn by UIKit on the root, over the slab mesh
behind it (src/ui/panel-slab.ts) that gives it depth. Primary keys are gold foil with black legends;
the rest are black glass with a double gold hairline. Hover lights a bright gold glow under the key.
The key element carries the cap colour as its border colour too, which UIKit never draws (no border
width) and the menus read to recolour a cap for its state. Colours mirror src/ui/theme.ts."""

COMMON = """
  .root { flex-direction: column; anchor-y: bottom; padding-top: 16; padding-bottom: 16; padding-left: 18; padding-right: 18; gap: 12; color: #EFE6D2; background-color: #1C191D; border-radius: 14; border-width: 1.4; border-color: #B08732; }
  .crest { position-type: absolute; position-left: 0; position-right: 0; position-top: -12; height: 12.6; flex-direction: column; align-items: center; justify-content: flex-end; pointer-events: none; }
  .crest-top { width: 46; height: 5.4; background-color: #1C191D; border-width: 1.2; border-color: #B08732; border-bottom-width: 0; border-top-left-radius: 2; border-top-right-radius: 2; }
  .crest-mid { width: 104; height: 7.4; background-color: #1C191D; border-width: 1.2; border-color: #B08732; border-bottom-width: 0; border-top-left-radius: 2; border-top-right-radius: 2; }
  .head { flex-direction: row; align-items: center; justify-content: space-between; height: 24; gap: 12; }
  .head-tall { flex-direction: row; align-items: center; justify-content: space-between; height: 44; gap: 12; }
  .title { font-size: 18; font-weight: extra-bold; color: #EFE6D2; flex-shrink: 0; }
  .meta { font-size: 10.5; font-weight: medium; color: #CDB27A; }
  .meta-row { flex-direction: row; align-items: center; gap: 6; }
  .led { width: 6; height: 6; border-radius: 3; background-color: #FFD36A; }
  .row { flex-direction: row; gap: 12; }
  .section { font-size: 10; font-weight: bold; color: #CDB27A; height: 13; }
  .line { font-size: 11; font-weight: medium; color: #EFE6D2; }
  .line-dim { font-size: 10.5; font-weight: medium; color: #CDB27A; }
  .slot { flex-grow: 1; flex-basis: 0; }
  .slot-fixed { flex-grow: 0; flex-shrink: 0; }
  .slot-cta { height: 56; }
  .slot-sm { height: 44; }
  .slot-md { height: 52; }
  .slot-square { width: 44; height: 44; }
  .slot-back { width: 74; height: 44; }
  .glow { position-type: absolute; position-left: -3.5; position-right: -3.5; position-top: -3.5; position-bottom: -3.5; border-radius: 9; background-color: #FFD36A; opacity: 0; pointer-events: none; }
  .key { position-type: absolute; position-left: 0; position-right: 0; position-top: 0; position-bottom: 0; border-radius: 6; }
  .cap { position-type: absolute; position-left: 0; position-right: 0; position-top: 0; position-bottom: 0; flex-direction: column; justify-content: center; padding-left: 9; padding-right: 9; gap: 2; border-radius: 6; pointer-events: none; }
  .cap-center { align-items: center; }
  .cap-row { flex-direction: row; align-items: center; justify-content: center; gap: 5; }
  .hair { position-type: absolute; position-left: 2.2; position-right: 2.2; position-top: 2.2; position-bottom: 2.2; border-radius: 4.5; border-width: 0.6; border-color: #B08732; pointer-events: none; }
  .key-putty { border-color: #E2BD62; }
  .cap-putty { color: #1C191D; background-color: #E2BD62; }
  .key-signal { border-color: #FFD36A; }
  .cap-signal { color: #1C191D; background-color: #FFD36A; }
  .key-danger { border-color: #7A2E28; }
  .cap-danger { color: #EFE6D2; background-color: #7A2E28; }
  .key-graphite { border-color: #2A2529; }
  .cap-graphite { color: #EFE6D2; background-color: #2A2529; border-width: 0.8; border-color: #B08732; }
  .label { font-size: 16; font-weight: extra-bold; }
  .label-sm { font-size: 11; font-weight: extra-bold; flex-shrink: 0; }
  .label-cta { font-size: 13; font-weight: extra-bold; }
  .label-wrap { font-size: 10; font-weight: extra-bold; text-align: center; }
  .sub { font-size: 10.5; font-weight: medium; }
  .ink-soft { color: #5A4520; }
  .ink-dim { color: #CDB27A; }
  .ghost-dot { position-type: absolute; position-right: 7; position-top: 7; width: 5; height: 5; border-radius: 2.5; background-color: #7FDCFF; }
  .bar-h { width: 11; height: 2; border-radius: 1; background-color: #EFE6D2; }
  .plus { width: 11; height: 11; align-items: center; justify-content: center; }
  .bar-v { position-type: absolute; position-left: 4.5; position-top: 0; width: 2; height: 11; border-radius: 1; background-color: #EFE6D2; }
  .dot { width: 5; height: 5; border-radius: 2.5; }
  .plate { background-color: #121016; border-radius: 6; border-width: 0.6; border-color: #3A3236; }
"""


def head(extra):
    return "<style>" + COMMON + extra + "</style>\n"


CREST = """<div class="crest">
    <div class="crest-top"></div>
    <div class="crest-mid"></div>
  </div>"""


def key(id, tone, content, slot="slot slot-sm", cap_extra="", key_extra=""):
    # Black glass keys carry a second, inner gold hairline (the deco double line).
    hair = '<div class="hair"></div>\n          ' if tone == "graphite" else ""
    return f"""<div id="{id}-slot" class="{slot}">
      <div id="{id}-glow" class="glow"></div>
      <div id="{id}" class="key key-{tone}{(' ' + key_extra) if key_extra else ''}">
        <div id="{id}-cap" class="cap cap-{tone}{(' ' + cap_extra) if cap_extra else ''}">
          {hair}{content}
        </div>
      </div>
    </div>"""


def label_key(id, tone, label, slot="slot slot-sm"):
    """A key with one centred legend. Legends are text: a Lucide icon costs a draw call per path per eye."""
    return key(id, tone, f"""<div id="{id}-label" class="label-sm">{label}</div>""", slot, "cap-center")


def cta_key(id, tone, label, sub, slot="slot slot-cta"):
    # Subs: soft ink on gold, light on black glass.
    ink = {"putty": " ink-soft", "signal": " ink-soft", "graphite": " ink-dim"}.get(tone, "")
    return key(id, tone, f"""<div id="{id}-label" class="label-cta">{label}</div>
          <div id="{id}-sub" class="sub{ink}">{sub}</div>""", slot)


def sub_key(id, tone, label, sub, slot="slot slot-sm", dot=False):
    """A key with a legend and a second line under it (its state: a streak, a count)."""
    ink = {"putty": " ink-soft", "signal": " ink-soft", "graphite": " ink-dim"}.get(tone, "")
    mark = '<div class="ghost-dot"></div>\n          ' if dot else ""
    return key(id, tone, f"""{mark}<div id="{id}-label" class="label-sm">{label}</div>
          <div id="{id}-sub" class="sub{ink}">{sub}</div>""", slot)


def back_key(id, label="Back"):
    return key(id, "graphite", f"""<div id="{id}-label" class="label-sm">{label}</div>""", "slot-fixed slot-back", "cap-center")


HEADER = "<!-- Generated by scripts/ui (edit the generator, not this). Shared classes are identical in every menu file (UIKit has one stylesheet). One unit is 1 mm. -->\n"
