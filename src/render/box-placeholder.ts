// A stand-in for the box until the box scene exists: its back panel (a frosted square the box's size,
// with a thin walnut rim) where the box will sit, tilted back so it faces the seated player's eyes.
// Two meshes under one root entity named "Box"; nothing moves per frame (it is placed only when the
// placement or the box size changes).
import { BoxGeometry, type Entity, Group, Mesh, MeshBasicMaterial, PlaneGeometry, type World } from "@iwsdk/core";
import { BOX_ROOT_NAME, type BoxPose } from "../app/placement";

/** The panel leans back this far so it faces the eyes like a book on the lap. */
export const PANEL_TILT_RAD = (20 * Math.PI) / 180;
/** Rim width and depth around the frosted face, in metres. */
const RIM_M = 0.01;
const RIM_DEPTH_M = 0.012;

export class BoxPlaceholder {
  /** The box root ("Box"): its origin is the back panel's centre, its +Z faces the player. */
  readonly root = new Group();
  readonly entity: Entity;
  private readonly face: Mesh;
  private readonly rim: Mesh;
  private sizeM = 0.24;

  constructor(world: World) {
    this.root.name = BOX_ROOT_NAME;
    this.rim = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x3a2a1e }));
    this.rim.name = "Box Rim";
    this.face = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0xd9cfc0, transparent: true, opacity: 0.86 }));
    this.face.name = "Box Panel";
    this.root.add(this.rim, this.face);
    this.entity = world.createTransformEntity(this.root, { persistent: true });
    this.resize();
  }

  /** The box's edge in metres. */
  get size(): number {
    return this.sizeM;
  }

  /** Put the panel at the box pose (its back panel's centre and heading). */
  layout(pose: Readonly<BoxPose>): void {
    this.root.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.root.rotation.set(-PANEL_TILT_RAD, pose.yaw, 0, "YXZ");
    this.root.updateMatrixWorld(true);
  }

  /** The box size setting changed (cm): the panel grows or shrinks around its centre. */
  setSize(cm: number): void {
    const m = cm / 100;
    if (Math.abs(m - this.sizeM) < 1e-6) return;
    this.sizeM = m;
    this.resize();
  }

  private resize(): void {
    const s = this.sizeM;
    this.face.scale.set(s, s, 1);
    this.face.position.z = 0.001;
    this.rim.scale.set(s + 2 * RIM_M, s + 2 * RIM_M, RIM_DEPTH_M);
    this.rim.position.z = -RIM_DEPTH_M / 2;
    this.root.updateMatrixWorld(true);
  }
}
