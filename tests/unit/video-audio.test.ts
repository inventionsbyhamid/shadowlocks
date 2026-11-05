import { describe, expect, it } from "vitest";
import type { AudioManifest } from "../../src/audio/manifest";
import { COPY } from "../../src/ui/copy";
import { EDITS, END_CARD } from "../video/edits";
import {
  distanceGain,
  duckExpr,
  type FrameEvents,
  levelExpr,
  musicSetup,
  panMatrix,
  placeFromHead,
  planMix,
  planMusic,
  voiceLevel,
} from "../video/lib/audio";
import { EDIT_LOUDNESS, editLoudness, SILENT_MANIFEST } from "../video/lib/deliver";
import { endCardHtml } from "../video/lib/endcard";
import { contactSheetArgs, deliveryArgs, duckFilter, editVideoFilter, endCardFilter, fadeFramesFor, mezzanineArgs, mixCommand } from "../video/lib/mixdown";
import { fixtureManifest } from "./helpers/audio-fixture";

// The shapes the sound pack's manifest has (the sound tools write them), with test values: the video
// mix must not depend on which pack is in the repo.
const manifest: AudioManifest = fixtureManifest();
const HEAD = { p: [0, 1.2, -1.4] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] };
const BUTTONS = [
  { id: "start", world: [0.1, 0.8, -1.77] as [number, number, number] },
  { id: "settings", world: [-0.1, 0.8, -1.77] as [number, number, number] },
];
const frame = (t: number, events: FrameEvents["events"]): FrameEvents => ({ t, events, head: HEAD, buttons: BUTTONS });
const db = (x: number) => 10 ** (x / 20);
/** The fixture with one change. */
const tweaked = (f: (m: AudioManifest) => void): AudioManifest => {
  const m = fixtureManifest();
  f(m);
  return m;
};

describe("placing sounds around the head", () => {
  it("measures azimuth in the head's frame", () => {
    expect(placeFromHead([0, 1.2, -2.4], HEAD).azimuth).toBeCloseTo(0, 9);
    expect(placeFromHead([1, 1.2, -1.4], HEAD).azimuth).toBeCloseTo(90, 9);
    expect(placeFromHead([-1, 1.2, -1.4], HEAD).azimuth).toBeCloseTo(-90, 9);
    // Head turned 90 degrees left: a sound straight ahead in the world is now on the right.
    const left = { p: HEAD.p, q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number] };
    expect(placeFromHead([0, 1.2, -2.4], left).azimuth).toBeCloseTo(90, 9);
    expect(placeFromHead([0, 1.2, -2.4], left).distance).toBeCloseTo(1, 9);
  });

  it("pans like Web Audio's equal-power panner and falls off like its inverse model", () => {
    const [[l], [r]] = panMatrix(0, 1);
    expect(l).toBeCloseTo(Math.SQRT1_2, 9);
    expect(r).toBeCloseTo(Math.SQRT1_2, 9);
    const hard = panMatrix(90, 1);
    expect(hard[0][0]).toBeCloseTo(0, 9);
    expect(hard[1][0]).toBeCloseTo(1, 9);
    // Behind the head mirrors to the front.
    expect(panMatrix(150, 1)).toEqual(panMatrix(30, 1));
    expect(panMatrix(null, 1)).toEqual([[1, 0], [1, 0]]);
    expect(panMatrix(null, 2)).toEqual([[1, 0], [0, 1]]);
    expect(panMatrix(-90, 2)).toEqual([[1, 1], [0, 0]]);
    expect(distanceGain(0.1)).toBe(1);
    expect(distanceGain(0.6)).toBeCloseTo(0.5, 9);
  });
});

describe("mix plan", () => {
  it("turns a press and a grab into the game's sounds, a press heard at its button", () => {
    const plan = planMix(
      [
        frame(0.5, [{ type: "press", id: "start" }]),
        frame(1.0, [{ type: "grab", hand: "right", at: [0.05, 0.95, -1.8] }]),
        // Not in this manifest: logged, not played.
        frame(1.4, [{ type: "release", hand: "right" }]),
      ],
      manifest,
      { duration: 3, seed: "t", initialMusic: "menu" },
    );
    expect(plan.layers.map((l) => [l.t, l.id])).toEqual([
      [0.5, "ui_press"],
      [1.0, "lantern_pick"],
    ]);
    expect(plan.log).toContainEqual({ t: 1.4, cue: "lantern_set", note: "no such sound in the manifest" });
    const press = plan.layers[0]!;
    expect(press.file).toBe(manifest.sfx.ui_press!.files[0]);
    // The start button is right of centre and below: panned right, quieter with distance, on the ui bus.
    expect(press.azimuth).toBeGreaterThan(5);
    const d = Math.hypot(0.1, 0.8 - 1.2, -1.77 + 1.4);
    expect(press.gain).toBeCloseTo(manifest.buses.ui * manifest.buses.sfx * distanceGain(d), 9);
    expect(press.rate).toBe(1);
    // The grab carries its own place.
    const grab = plan.layers[1]!;
    expect(grab.azimuth).toBeCloseTo(placeFromHead([0.05, 0.95, -1.8], HEAD).azimuth, 9);
    expect(plan.music.changes).toEqual([]);
  });

  it("plays head-locked when an event names no button on screen and has no place", () => {
    const plan = planMix([frame(0.5, [{ type: "press", id: "gone" }])], manifest, { duration: 1, seed: "h", initialMusic: "menu" });
    expect(plan.layers[0]!.azimuth).toBeNull();
    const noButtons = planMix([{ t: 0.5, events: [{ type: "press", id: "start" }], head: HEAD, buttons: null }], manifest, {
      duration: 1,
      seed: "h",
      initialMusic: "menu",
    });
    expect(noButtons.layers[0]!.azimuth).toBeNull();
  });

  it("rotates variants, honours cooldowns and is the same every time for a seed", () => {
    const m = tweaked((x) => {
      x.sfx.ui_press!.pitchCents = 50;
    });
    const events = [0, 0.01, 0.5, 1].map((t) => frame(t, [{ type: "press", id: "start" }]));
    const plan = planMix(events, m, { duration: 2, seed: "same", initialMusic: "off" });
    const files = plan.layers.map((l) => l.file);
    const variants = m.sfx.ui_press!.files;
    // 10 ms after the first is inside the 40 ms cooldown.
    expect(files).toEqual([variants[0], variants[1], variants[2]]);
    expect(plan.log.some((x) => x.note === "cooldown")).toBe(true);
    expect(planMix(events, m, { duration: 2, seed: "same", initialMusic: "off" })).toEqual(plan);
    expect(planMix(events, m, { duration: 2, seed: "other", initialMusic: "off" }).layers[0]!.rate).not.toBe(plan.layers[0]!.rate);
  });

  it("follows screens with music and ducks it under a sound that asks for it", () => {
    const m = tweaked((x) => {
      x.sfx.lantern_pick!.duckMusicDb = 6;
    });
    const plan = planMix(
      [
        frame(0.2, [{ type: "screen", from: "home", to: "play" }]),
        frame(1.0, [{ type: "grab", hand: "right" }]),
        frame(2.5, [{ type: "screen", from: "play", to: "home" }]),
      ],
      m,
      { duration: 8, seed: "m", initialMusic: "menu" },
    );
    expect(plan.music.changes.map((c) => c.state)).toEqual(["calm", "menu"]);
    expect(plan.ducks).toHaveLength(1);
    expect(plan.ducks[0]!.t).toBe(1);
    expect(plan.ducks[0]!.depth).toBeCloseTo(db(-6), 6);
  });

  it("mixes a shot to silence of its length while there is no sound pack", () => {
    const plan = planMix([frame(0.5, [{ type: "press", id: "start" }]), frame(0.7, [{ type: "screen", from: "home", to: "play" }])], SILENT_MANIFEST, {
      duration: 2,
      seed: "s",
      initialMusic: "menu",
    });
    expect(plan.layers).toEqual([]);
    expect(plan.log[0]).toEqual({ t: 0.5, cue: "ui_press", note: "no such sound in the manifest" });
    const cmd = mixCommand(
      { plan, music: planMusic(plan.music, musicSetup(SILENT_MANIFEST)), musicBus: SILENT_MANIFEST.buses.music, limiter: true, out: "o.wav" },
      { audioDir: "/a", channels: () => 2 },
      "s.filter",
    );
    expect(cmd.args.join(" ")).toContain("anullsrc=r=48000:cl=stereo");
    expect(cmd.script).toContain("apad=whole_dur=2,atrim=0:2");
  });

  it("skips an edit's loudness step on the silent mix, with a warning, and keeps it with a sound pack", () => {
    const said: string[] = [];
    const log = (s: string) => said.push(s);
    // The edits without a voice-over cut while there is no sound pack: none asks silence for -14 LUFS.
    expect(editLoudness(EDITS["concat-check"]!, SILENT_MANIFEST, log, "concat-check")).toBeNull();
    expect(editLoudness(EDITS["card-check"]!, SILENT_MANIFEST, log, "card-check")).toBeNull();
    expect(said).toHaveLength(2);
    expect(said[0]).toMatch(/^warning: edit concat-check: no sound pack, so no loudness step/);
    // A voice-over is sound: it is still brought to the target.
    expect(editLoudness(EDITS["narration-check"]!, SILENT_MANIFEST, log, "narration-check")).toEqual(EDIT_LOUDNESS);
    // With a pack: the default target, an edit's own, or none when it asks for none; no warning.
    said.length = 0;
    expect(editLoudness({}, manifest, log)).toEqual(EDIT_LOUDNESS);
    expect(editLoudness({ loudness: { I: -16, TP: -1.5 } }, manifest, log)).toEqual({ I: -16, TP: -1.5 });
    expect(editLoudness({ loudness: null }, manifest, log)).toBeNull();
    expect(editLoudness({ loudness: null }, SILENT_MANIFEST, log)).toBeNull();
    expect(said).toEqual([]);
  });
});

describe("music plan", () => {
  const setup = musicSetup(manifest);

  it("changes on the next bar line, crossfading the filtered calm copies", () => {
    const m = planMusic({ initial: "menu", offsetSec: 0, changes: [{ t: 0.7, state: "calm" }] }, setup);
    // 120 bpm: bars every 2 s from the loop start; 0.7 + lead goes to the bar at 2 s.
    expect(m.ramps.calm[0]!.at).toBeCloseTo(2, 9);
    expect(voiceLevel(m, "menu", 1.9)).toBeCloseTo(setup.calmGain * setup.fx.menu.gain, 9);
    expect(voiceLevel(m, "calm", 3.5)).toBeCloseTo(setup.calmGain, 9);
    expect(voiceLevel(m, "menu", 3.5)).toBeCloseTo(0, 9);
    // Complementary (smooth) halfway: the two copies of one signal add up to a steady level.
    const mid = voiceLevel(m, "calm", 2.75) / setup.calmGain + voiceLevel(m, "menu", 2.75) / (setup.calmGain * setup.fx.menu.gain);
    expect(mid).toBeCloseTo(1, 6);
  });

  it("reads the menu and results colouring from the manifest", () => {
    expect(setup.fx.menu.lowpassHz).toBe(1500);
    expect(setup.fx.menu.gain).toBeCloseTo(db(-2), 9);
    expect(setup.fx.results.lowpassHz).toBe(800);
    expect(setup.bpm).toBe(120);
  });

  it("brings intense in with an equal-power fade and drops a fade not yet started", () => {
    const m = planMusic(
      { initial: "calm", offsetSec: 0, changes: [{ t: 1.0, state: "intense" }, { t: 1.5, state: "menu" }, { t: 5.1, state: "intense" }] },
      setup,
    );
    // The intense change at 1.0 s waited for the bar at 2 s; menu at 1.5 s replaced it.
    expect(m.ramps.intense.map((r) => r.at)).toEqual([6]);
    expect(m.ramps.menu[0]!.at).toBe(2);
    const x = voiceLevel(m, "intense", 6.75) / setup.intenseGain;
    expect(x).toBeCloseTo(Math.sin(Math.PI / 4), 6);
  });

  it("writes level and duck expressions ffmpeg can read", () => {
    const m = planMusic({ initial: "menu", offsetSec: 0, changes: [{ t: 0.7, state: "calm" }] }, setup);
    expect(levelExpr(m, "intense")).toBe("0");
    expect(levelExpr(m, "calm")).toMatch(/^0\+\(1\.000000\)\*\(1-cos\(PI\*clip\(\(t-2\.000000\)\/1\.500000,0,1\)\)\)\/2$/);
    expect(duckExpr([])).toBe("1");
    expect(duckExpr([{ t: 1, depth: 0.5, end: 2 }])).toContain("clip((t-1.000000)/0.05,0,1)");
  });
});

describe("ffmpeg commands", () => {
  it("mixes every layer from its file, delayed, panned and summed without normalising", () => {
    const plan = planMix(
      [frame(0.5, [{ type: "grab", hand: "right", at: [0.05, 0.95, -1.8] }]), frame(1, [{ type: "grab", hand: "right", at: [-0.05, 0.95, -1.8] }])],
      manifest,
      { duration: 2, seed: "c", initialMusic: "calm" },
    );
    const cmd = mixCommand(
      { plan, music: planMusic(plan.music, musicSetup(manifest)), musicBus: 0.55, limiter: true, out: "out.wav" },
      {
        audioDir: "/a",
        calmLoop: { file: "/w/calm.wav", samples: 1536000, startSample: 0 },
        intenseLoop: { file: "/w/intense.wav", samples: 1536000, startSample: 0 },
        channels: () => 1,
      },
      "mix.filter",
    );
    expect(cmd.args).toContain("-filter_complex_script");
    // The music loops from decoded PCM, sample exact (no decoder gap at the seam).
    expect(cmd.args).not.toContain("-stream_loop");
    expect(cmd.args).toContain("/w/calm.wav");
    expect(cmd.script).toContain("aloop=loop=-1:size=1536000:start=0");
    expect(cmd.script).toContain("adelay=delays=500:all=1");
    expect(cmd.script).toContain("adelay=delays=1000:all=1");
    expect(cmd.script).toMatch(/amix=inputs=3:normalize=0/);
    expect(cmd.script).toContain("acompressor=");
    expect(cmd.script).toContain("apad=whole_dur=2");
    // A mono file feeds each side once (ffmpeg's pan refuses a channel twice in one output).
    for (const pan of cmd.script.match(/pan=stereo[^,]*/g) ?? []) {
      for (const side of pan.split("|").slice(1)) expect(side.match(/c0(?!=)/g) ?? []).toHaveLength(1);
    }
    const stereo = mixCommand(
      { plan, music: null, musicBus: 0.55, limiter: false, out: "fx.wav" },
      { audioDir: "/a", channels: () => 2 },
      "fx.filter",
    );
    expect(stereo.script).not.toContain("acompressor");
    expect(stereo.script).toMatch(/pan=stereo\|c0=[\d.]+\*c0(\+[\d.]+\*c1)?\|c1=([\d.]+\*c0\+)?[\d.]+\*c1/);
  });

  it("ducks the bed under a voice-over by about the asked depth", () => {
    const plan = planMix([], manifest, { duration: 4, seed: "n", initialMusic: "calm" });
    const cmd = mixCommand(
      { plan, music: null, musicBus: 0.55, limiter: true, out: "o.wav", narration: { file: "/v/voice.wav", t: 1.5, gain: 1, duckDb: 8 } },
      { audioDir: "/a", channels: () => 2 },
      "n.filter",
    );
    expect(cmd.args).toContain("/v/voice.wav");
    expect(cmd.script).toContain("adelay=delays=1500:all=1");
    expect(cmd.script).toMatch(/\[bed\]\[key\]sidechaincompress=/);
    expect(cmd.script).toMatch(/\[ducked\]\[voice\]amix=inputs=2:normalize=0/);
    // A -12 dBFS voice peak over the threshold, at ratio 8, takes the bed down about 8 dB.
    const thresh = Number(/threshold=([\d.]+)/.exec(duckFilter(8))?.[1]);
    const over = -12 - 20 * Math.log10(thresh);
    expect(over * (1 - 1 / 8)).toBeCloseTo(8, 2);
  });

  it("keeps a lossless mezzanine and makes one dithered delivery encode", () => {
    const z = mezzanineArgs({ framesPattern: "f%05d.png", fps: 60, frames: 390, out: "m.mkv" }).join(" ");
    expect(z).toContain("-framerate 60 -i f%05d.png -frames:v 390");
    expect(z).toContain("-c:v libx264rgb -qp 0");
    const d = deliveryArgs({ inputs: ["m.mkv"], videoFilter: null, audio: "a.wav", fps: 60, crf: 18, preset: "slow", out: "o.mp4" }).join(" ");
    expect(d).toContain("-i m.mkv -i a.wav");
    expect(d).toContain("sws_dither=ed");
    expect(d).toContain("-x264-params aq-mode=3");
    expect(d).toContain("-c:v libx264 -preset slow -crf 18");
    expect(d).toContain("-map 1:a");
    expect(d).toContain("+faststart");
  });

  it("cuts edits in whole frames and refuses a crossfade as long as a clip", () => {
    expect(fadeFramesFor(500, 60)).toBe(30);
    expect(fadeFramesFor(333, 60)).toBe(20);
    const v = editVideoFilter([{ file: "a", frames: 240 }, { file: "b", frames: 300 }, { file: "c", frames: 180 }], 30, 60);
    expect(v.startFrames).toEqual([0, 210, 480]);
    expect(v.frames).toBe(660);
    expect(v.duration).toBeCloseTo(11, 9);
    expect(v.filter).toBe("[0:v][1:v]xfade=transition=fade:duration=0.5:offset=3.5[x1];[x1][2:v]xfade=transition=fade:duration=0.5:offset=8[v]");
    expect(editVideoFilter([{ file: "a", frames: 240 }, { file: "b", frames: 300 }], 0, 60).filter).toBe("[0:v][1:v]concat=n=2:v=1:a=0[v]");
    expect(() => editVideoFilter([{ file: "a", frames: 20 }, { file: "b", frames: 300 }], 30, 60)).toThrow(/shortest clip/);
    expect(() => editVideoFilter([{ file: "a", frames: 20 }], 2.5, 60)).toThrow(/whole frames/);
    expect(contactSheetArgs({ input: "x.mp4", frames: 360, out: "c.png" }).join(" ")).toContain("not(mod(n,30))");
  });
});

describe("end card", () => {
  it("holds the last frame, blurs it in and lays the card over it", () => {
    const g = endCardFilter("[0:v][1:v]xfade=transition=fade:duration=0.5:offset=5[v]", {
      frames: 300,
      fps: 30,
      extraFrames: 108,
      fadeFrames: 18,
      cardInput: 3,
      blurSigma: 14,
    });
    expect(g.startsWith("[0:v][1:v]xfade=transition=fade:duration=0.5:offset=5[vcut];")).toBe(true);
    expect(g).toContain("[vcut]tpad=stop_mode=clone:stop=108,split[vhold][vtail]");
    expect(g).toContain("[vtail]trim=start_frame=300,setpts=PTS-STARTPTS,gblur=sigma=14");
    expect(g).toContain("fade=t=in:st=0:d=0.6:alpha=1,setpts=PTS+10/TB[vblur]");
    expect(g).toContain("[3:v]format=yuva444p,fade=t=in:st=0:d=0.6:alpha=1,setpts=PTS+10.166667/TB[vcard]");
    expect(g.endsWith("[vbg][vcard]overlay=eof_action=pass:format=auto[v]")).toBe(true);
    expect(() => endCardFilter("[0:v]null[x]", { frames: 1, fps: 30, extraFrames: 30, fadeFrames: 3, cardInput: 2, blurSigma: 1 })).toThrow(/\[v\]/);
    expect(() => endCardFilter("[0:v]null[v]", { frames: 1, fps: 30, extraFrames: 3, fadeFrames: 3, cardInput: 2, blurSigma: 1 })).toThrow(/longer/);
  });

  it("fades the whole mix out under the card", () => {
    const plan = { ...planMix([], manifest, { duration: 6, seed: "e", initialMusic: "calm" }), fadeOutSec: 2 };
    const cmd = mixCommand({ plan, music: null, musicBus: 0.55, limiter: true, out: "o.wav" }, { audioDir: "/a", channels: () => 2 }, "e.filter");
    expect(cmd.script).toContain("afade=t=out:st=4:d=2");
  });

  it("says the game's own words: the name, the tagline and three facts, no dashes", () => {
    expect(END_CARD.title).toBe("Shadow Locks");
    expect(END_CARD.tagline).toBe("Your hands. One light. Every shadow a lock.");
    expect(END_CARD.facts).toEqual(["Seated", "Hands only", "Plays offline"]);
    expect([END_CARD.title, END_CARD.tagline, ...END_CARD.facts].join(" ")).not.toMatch(/[‒–—―]/);
    expect(END_CARD.title).toBe(COPY.film.title);
    // The link slot stays free until the hosted link exists.
    expect(END_CARD.link).toBeUndefined();
  });

  it("lays out the title, tagline and facts, and keeps the link line free", () => {
    const html = endCardHtml(END_CARD, 960, 540, "data:x");
    expect(html).toContain(">Shadow Locks<");
    expect(html).toContain(">Your hands. One light. Every shadow a lock.<");
    expect(html).toContain('<span class="chip accent">Seated</span><span class="chip">Hands only</span><span class="chip">Plays offline</span>');
    expect(html).toContain('<div class="link"></div>');
    expect(html).toContain("font-size: 54.00px");
    // Ebony and gold, not Number Smash's orange.
    expect(html).toContain("#E2BD62");
    expect(html).not.toContain("#FF5A1F");
    expect(endCardHtml({ ...END_CARD, link: "x.example" }, 960, 540, "data:x")).toContain('<div class="link">x.example</div>');
    expect(endCardHtml({ title: "a<b", tagline: "", facts: [], holdSec: 3 }, 960, 540, "data:x")).toContain(">a&lt;b<");
  });
});
