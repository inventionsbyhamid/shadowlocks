// The lantern. Two draw calls: one body (foot, fins and core in one mesh) and one glow sprite that also carries the
// settle ripple's ring. Its two ways of going dim: quiet while it waits in a lesson's cradle (no glow or ripple, its
// body drawn), and put away while a menu is up, where it disappears without changing the scene's lights (three builds
// each lit shader for the number of visible lights, so hiding the lantern's light made every lit material compile
// again the first time the box showed lit after a menu). The two are independent.
import { describe, expect, it } from "vitest";
import {
  Group,
  type Light,
  type Mesh,
  type MeshStandardMaterial,
  MeshBasicMaterial,
  type Object3D,
  ShaderLib,
  type SpriteMaterial,
  Vector3,
} from "@iwsdk/core";
import { LanternView } from "../../src/render/lantern-view";
import { LANTERN_GLOW } from "../../src/render/theme";

const named = (v: LanternView, name: string): Object3D => v.group.getObjectByName(name)!;
const mats = () => ({ lacquer: new MeshBasicMaterial(), gold: new MeshBasicMaterial() });

/** The lights three would gather here (only those whose whole chain up is visible). */
function visibleLights(root: Object3D): Light[] {
  const out: Light[] = [];
  root.traverseVisible((o) => {
    if ((o as Light).isLight) out.push(o as Light);
  });
  return out;
}

/** The names of what would be drawn under `root` (one draw call each). */
function drawn(root: Object3D): string[] {
  const out: string[] = [];
  root.traverseVisible((o) => {
    if ((o as { isMesh?: boolean }).isMesh || (o as { isSprite?: boolean }).isSprite) out.push(o.name);
  });
  return out.sort();
}

describe("LanternView", () => {
  it("draws in two calls: one body for foot, fins and core, and the glow; the body is metal where gold, glowing where core", () => {
    const v = new LanternView(mats());
    expect(drawn(v.group)).toEqual(["Lantern Body", "Lantern Glow"]);
    const body = named(v, "Lantern Body") as Mesh;
    const m = body.material as MeshStandardMaterial;
    expect(m.vertexColors).toBe(true);
    // Its shader: metal only where gold, the core's own glow only on the core (the core's colour is its emissive).
    const shader = {
      uniforms: {},
      vertexShader: "",
      fragmentShader: "void main() {\nvec3 totalEmissiveRadiance = emissive;\n#include <color_fragment>\n#include <metalnessmap_fragment>\n}",
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toMatch(/#include <metalnessmap_fragment>\s*metalnessFactor \*= /);
    expect(shader.fragmentShader).toContain("totalEmissiveRadiance = emissive * ");
    // The core brightens with the hand, as before (its colour is the body's emissive now).
    const dim = m.emissive.clone();
    v.setBrightness(1);
    expect(m.emissive.equals(dim)).toBe(false);
  });

  it("the settle ripple rides on the glow: still one sprite, the ring grows and fades, and the sprite holds it", () => {
    const v = new LanternView(mats());
    const glow = named(v, "Lantern Glow");
    const rest = glow.scale.x;
    expect(v.ringOpacity).toBe(0);
    v.ripple();
    const seen: { ring: number; scale: number }[] = [];
    for (let t = 0; t < LANTERN_GLOW.rippleS + 0.2; t += 1 / 72) {
      v.update(1 / 72);
      seen.push({ ring: v.ringOpacity, scale: glow.scale.x });
      expect(drawn(v.group)).toEqual(["Lantern Body", "Lantern Glow"]);
    }
    // The ring shows, fades out, and is gone at the end; while it is wide the sprite is wide enough to hold it.
    expect(Math.max(...seen.map((s) => s.ring))).toBeGreaterThan(0.8);
    expect(seen.at(-1)!.ring).toBe(0);
    expect(Math.max(...seen.map((s) => s.scale))).toBeGreaterThanOrEqual(2 * LANTERN_GLOW.rippleRadius * 0.99);
    expect(seen.at(-1)!.scale).toBeCloseTo(rest, 9);
  });

  it("the core shows its own colour exactly, as its unlit material did: no light, no reflection, no tone mapping", () => {
    // It was a MeshBasicMaterial that skipped tone mapping; in the lit body it came out greyed (lit and tone-mapped).
    const v = new LanternView(mats());
    const m = (named(v, "Lantern Body") as Mesh).material as MeshStandardMaterial;
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as never, undefined as never);
    const f = shader.fragmentShader;
    const core = "gl_FragColor.rgb = mix( gl_FragColor.rgb, totalEmissiveRadiance, step( 0.5, vColor.b ) );";
    expect(f).toContain(core);
    // After the tone mapping, before the encoding: the core's emissive (masked to the core) goes out as it is.
    expect(f.indexOf(core)).toBeGreaterThan(f.indexOf("#include <tonemapping_fragment>"));
    expect(f.indexOf(core)).toBeLessThan(f.indexOf("#include <colorspace_fragment>"));
    expect(f).toContain("vec3 totalEmissiveRadiance = emissive * step( 0.5, vColor.b );");
  });

  it("the glow and its ring add as the two light sprites did: each term in output colour, added after the encoding", () => {
    // The light blend adds what the shader puts out, and the XR target takes sRGB-encoded colour: two sprites added
    // enc(lamp)·alpha and enc(gold)·ring. Adding lamp·alpha + gold·ring before the encoding (one enc of the sum)
    // made the halo's faint outer half several times brighter.
    const v = new LanternView(mats());
    const m = (named(v, "Lantern Glow") as unknown as { material: SpriteMaterial }).material;
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.sprite.vertexShader, fragmentShader: ShaderLib.sprite.fragmentShader };
    m.onBeforeCompile(shader as never, undefined as never);
    const f = shader.fragmentShader;
    // The glow itself goes through three's sprite path untouched (as the hint and ghost lanterns' glows do).
    expect(f).toContain("vec4 diffuseColor = vec4( diffuse, opacity );");
    expect(f).not.toMatch(/\n\s*diffuseColor = /);
    // The ring's coverage is read after the map (it needs the sprite's uv) and added after the encoding, with its
    // own colour encoded the same way; alpha 1, so the blend adds the colour as it is and leaves the page's alpha.
    const ringAt = f.indexOf("float ringA = ");
    expect(ringAt).toBeGreaterThan(f.indexOf("#include <map_fragment>"));
    const add = "gl_FragColor = vec4( gl_FragColor.rgb * gl_FragColor.a + linearToOutputTexel( vec4( ringColor, 1.0 ) ).rgb * ringA, 1.0 );";
    expect(f).toContain(add);
    expect(f.indexOf(add)).toBeGreaterThan(f.indexOf("#include <colorspace_fragment>"));
    expect(Object.keys(shader.uniforms).sort()).toEqual(["ring", "ringColor", "ringMap"]);
  });

  it("goes quiet while it waits in a lesson's cradle: no glow or ripple, its body still drawn", () => {
    const v = new LanternView(mats());
    v.setBrightness(1);
    expect(named(v, "Lantern Glow").visible).toBe(true);
    v.setQuiet(true);
    expect(named(v, "Lantern Glow").visible).toBe(false);
    v.ripple();
    v.update(0.05);
    expect(drawn(v.group)).toEqual(["Lantern Body"]);
    v.setQuiet(false);
    expect(named(v, "Lantern Glow").visible).toBe(true);
  });

  it("put away: hides its body and glow but keeps its light in the scene, dark; shown again it lights as before", () => {
    const root = new Group();
    const lantern = new LanternView(mats());
    root.add(lantern.group);
    lantern.setBoxSize(0.24);
    const lit = visibleLights(root);
    expect(lit).toHaveLength(1);
    const intensity = lit[0]!.intensity;
    expect(intensity).toBeGreaterThan(0);

    lantern.setShown(false);
    expect(drawn(root)).toEqual([]);
    const away = visibleLights(root);
    expect(away).toHaveLength(1);
    expect(away[0]!.intensity).toBe(0);
    lantern.setBrightness(1);
    lantern.flare();
    lantern.update(0.05);
    expect(away[0]!.intensity).toBe(0);

    lantern.setShown(true);
    lantern.setBrightness(0);
    lantern.update(10);
    expect(visibleLights(root)[0]!.intensity).toBeCloseTo(intensity, 9);
    expect(drawn(root)).toEqual(["Lantern Body", "Lantern Glow"]);
  });

  it("put away and quiet are independent: either hides the glow, only put away hides the body, the light stays", () => {
    const root = new Group();
    const v = new LanternView(mats());
    root.add(v.group);
    v.setQuiet(true);
    expect(drawn(root)).toEqual(["Lantern Body"]);
    v.setShown(false);
    expect(drawn(root)).toEqual([]);
    v.setShown(true);
    expect(drawn(root)).toEqual(["Lantern Body"]);
    v.setQuiet(false);
    expect(drawn(root)).toEqual(["Lantern Body", "Lantern Glow"]);
    for (const [shown, quiet] of [[false, false], [false, true], [true, true]] as const) {
      v.setShown(shown);
      v.setQuiet(quiet);
      expect(visibleLights(root)).toHaveLength(1);
    }
    // Its position is still its light's.
    v.setPos([0.1, -0.2, 1.2]);
    v.group.updateMatrixWorld(true);
    expect(v.light.getWorldPosition(new Vector3()).toArray()).toEqual([0.1, -0.2, 1.2]);
  });
});
