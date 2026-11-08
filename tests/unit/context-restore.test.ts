// A WebGL context lost and restored (render/box-scene.ts restoreEnvironmentsOnContextRestore): three brings back its
// own state and the textures it can upload again, but not a render target's contents, so the two PMREM studio
// environments are rendered again and every material under the box that reflected one takes its new copy.
import { Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Texture } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { restoreEnvironmentsOnContextRestore, type StudioEnvs } from "../../src/render/box-scene";

function rig() {
  const made: StudioEnvs[] = [];
  const make = (): StudioEnvs => {
    const e = { gold: new Texture(), dark: new Texture() };
    made.push(e);
    return e;
  };
  const first = make();
  const disposed: Texture[] = [];
  for (const t of [first.gold!, first.dark!]) t.addEventListener("dispose", () => disposed.push(t));
  const root = new Group();
  const plane = new PlaneGeometry(1, 1);
  const gold = new MeshStandardMaterial({ envMap: first.gold });
  const lacquer = new MeshPhysicalMaterial({ envMap: first.dark });
  const plain = new MeshBasicMaterial();
  const other = new Texture();
  const own = new MeshStandardMaterial({ envMap: other });
  root.add(new Mesh(plane, gold), new Mesh(plane, lacquer), new Mesh(plane, plain), new Mesh(plane, own));
  // Deeper down, and one mesh with two materials (the drawer, the lantern: added under the box later).
  const deep = new Group();
  const both = new Mesh(plane, [new MeshStandardMaterial({ envMap: first.gold }), new MeshStandardMaterial({ envMap: first.dark })]);
  deep.add(both);
  root.add(deep);
  const canvas = new EventTarget();
  const off = restoreEnvironmentsOnContextRestore(canvas, root, first, make);
  return { made, first, disposed, root, gold, lacquer, plain, own, other, both, canvas, off };
}

describe("WebGL context restore", () => {
  it("does nothing until the context is restored (a loss alone changes nothing)", () => {
    const r = rig();
    r.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(r.made).toHaveLength(1);
    expect(r.gold.envMap).toBe(r.first.gold);
  });

  it("renders both studios again and gives every material under the box that reflected one its new copy", () => {
    const r = rig();
    const goldVersion = r.gold.version;
    r.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(r.made).toHaveLength(2);
    const next = r.made[1]!;
    expect(r.gold.envMap).toBe(next.gold);
    expect(r.lacquer.envMap).toBe(next.dark);
    const [a, b] = r.both.material as MeshStandardMaterial[];
    expect(a!.envMap).toBe(next.gold);
    expect(b!.envMap).toBe(next.dark);
    // What reflected neither is left alone; a map for a map needs no new program.
    expect(r.plain.envMap).toBeNull();
    expect(r.own.envMap).toBe(r.other);
    expect(r.gold.version).toBe(goldVersion);
    // The lost ones are let go.
    expect(r.disposed).toEqual([r.first.gold, r.first.dark]);
  });

  it("restores again after a second loss, from the copies the first restore made; stops when told", () => {
    const r = rig();
    r.canvas.dispatchEvent(new Event("webglcontextrestored"));
    r.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(r.made).toHaveLength(3);
    expect(r.gold.envMap).toBe(r.made[2]!.gold);
    expect(r.lacquer.envMap).toBe(r.made[2]!.dark);
    r.off();
    r.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(r.made).toHaveLength(3);
  });

  it("a studio that cannot be made again leaves its materials without one, their programs rebuilt", () => {
    const r = rig();
    r.off();
    const goldVersion = r.gold.version;
    const canvas = new EventTarget();
    restoreEnvironmentsOnContextRestore(canvas, r.root, r.first, () => ({ gold: null, dark: new Texture() }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(r.gold.envMap).toBeNull();
    expect(r.gold.version).toBeGreaterThan(goldVersion);
    expect(r.lacquer.envMap).not.toBe(r.first.dark);
  });
});
