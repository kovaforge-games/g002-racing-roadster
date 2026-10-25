// Rapier world: one heightfield for the whole landscape (road included) and barrier walls with
// the debris fence on top, built from short boxes along both sides of the circuit.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Track } from './track';
import type { Terrain } from './terrain';
import { PIT } from './pits';

/** the pit wall between the main straight and the pit lane */
export const PIT_WALL_HEIGHT = 1.0;

export const PHYSICS_DT = 1 / 120;
export const WALL_HEIGHT = 1.1;
/** the debris fence on top of the barriers: solid, so a hop can't clear the barrier */
export const FENCE_HEIGHT = 2.6;
const WALL_SEGMENT = 4;

export async function initPhysics() {
  await RAPIER.init();
}

export function buildWorld(track: Track, terrain: Terrain) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_DT;

  // Rapier stores heightfields column-major with rows along z and columns along x
  const { nx, nz } = terrain;
  const hf = new Float32Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) hf[ix * nz + iz] = terrain.heights[iz * nx + ix];
  const ground = RAPIER.ColliderDesc.heightfield(nz - 1, nx - 1, hf, { x: terrain.width, y: 1, z: terrain.depth })
    .setTranslation(terrain.x0 + terrain.width / 2, 0, terrain.z0 + terrain.depth / 2)
    .setFriction(1).setRestitution(0);
  world.createCollider(ground);

  // barriers: low-friction so a glancing hit slides along the wall instead of spinning the car
  const step = track.total / track.n;
  const every = Math.max(1, Math.round(WALL_SEGMENT / step));
  for (const side of [-1, 1]) {
    for (let i = 0; i < track.n; i += every) {
      const s0 = track.s[i], s1 = s0 + every * step;
      const a = track.pointAt(s0, side * (track.wallOffset + 0.3));
      const b = track.pointAt(s1, side * (track.wallOffset + 0.3));
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, len);
      const q = quatYawPitch(yaw, pitch);
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, WALL_HEIGHT, len / 2 + 0.25)
        .setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2 + WALL_HEIGHT * 0.5, (a.z + b.z) / 2)
        .setRotation(q).setFriction(0.15).setRestitution(0.1));
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.08, FENCE_HEIGHT / 2, len / 2 + 0.25)
        .setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2 + WALL_HEIGHT * 1.5 + FENCE_HEIGHT / 2 - 0.1, (a.z + b.z) / 2)
        .setRotation(q).setFriction(0.1).setRestitution(0.05));
    }
  }
  // the pit wall: concrete between the track and the pit lane, in short boxes like the barriers
  for (let s0 = PIT.wallFrom; s0 < PIT.wallTo; s0 += WALL_SEGMENT) {
    const s1 = Math.min(PIT.wallTo, s0 + WALL_SEGMENT);
    const a = track.pointAt(s0, PIT.wallD + 0.15), b = track.pointAt(s1, PIT.wallD + 0.15);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dz);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, PIT_WALL_HEIGHT / 2, len / 2 + 0.05)
      .setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2 + PIT_WALL_HEIGHT / 2, (a.z + b.z) / 2)
      .setRotation(quatYawPitch(Math.atan2(dx, dz), -Math.atan2(dy, len))).setFriction(0.15).setRestitution(0.1));
  }
  return world;
}

/** quaternion for yaw about y followed by pitch about the local x axis */
export function quatYawPitch(yaw: number, pitch: number) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return { w: cy * cp, x: cy * sp, y: sy * cp, z: -sy * sp };
}
