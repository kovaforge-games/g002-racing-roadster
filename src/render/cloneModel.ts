// Fast copies of a built car model for the rivals. Building a CarModel projects its details onto
// the body with thousands of ray casts, which takes seconds; a copy shares the geometry and only
// clones what each car changes on its own (paint, lights, the moving parts). It works on any
// model class whose fields are scene objects, materials, plain data, or arrays and records of
// those, so it keeps working as the car model changes.
import * as THREE from 'three';

type Remap = { objects: Map<THREE.Object3D, THREE.Object3D>; materials: Map<THREE.Material, THREE.Material> };

function remap(value: unknown, m: Remap): unknown {
  if (value instanceof THREE.Object3D) return m.objects.get(value) ?? value;
  if (value instanceof THREE.Material) return m.materials.get(value) ?? value;
  if (Array.isArray(value)) return value.map(v => remap(v, m));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = remap(v, m);
    return out;
  }
  return value;
}

/** materials the model keeps a reference to (so it changes them later): these get cloned */
function ownMaterials(value: unknown, into: Set<THREE.Material>) {
  if (value instanceof THREE.Material) into.add(value);
  else if (Array.isArray(value)) value.forEach(v => ownMaterials(v, into));
  else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(v => ownMaterials(v, into));
}

export function cloneModel<T extends { root: THREE.Object3D }>(src: T): T {
  const root = src.root.clone(true);
  const objects = new Map<THREE.Object3D, THREE.Object3D>();
  const a: THREE.Object3D[] = [], b: THREE.Object3D[] = [];
  src.root.traverse(o => a.push(o)); root.traverse(o => b.push(o));
  a.forEach((o, k) => objects.set(o, b[k]));

  const owned = new Set<THREE.Material>();
  for (const v of Object.values(src)) ownMaterials(v, owned);
  const materials = new Map<THREE.Material, THREE.Material>();
  for (const mat of owned) materials.set(mat, mat.clone());
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(x => materials.get(x) ?? x) : materials.get(mesh.material) ?? mesh.material;
  });

  const copy = Object.create(Object.getPrototypeOf(src)) as T;
  const m = { objects, materials };
  for (const [k, v] of Object.entries(src)) (copy as Record<string, unknown>)[k] = remap(v, m);
  return copy;
}
