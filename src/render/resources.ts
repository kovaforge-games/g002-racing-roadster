import * as THREE from 'three';

/** For exclusively owned scene objects; car templates use a separate shared cache. */
export function disposeResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const drawable = object as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (drawable.material) {
      for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.Light) object.dispose();
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

/** Local instance bounds let the renderer cull scenery in other parts of a circuit. */
export function partitionInstances(source: THREE.InstancedMesh, cellSize = 240): THREE.InstancedMesh[] {
  const cells = new Map<string, number[]>();
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < source.count; i++) {
    source.getMatrixAt(i, matrix);
    const key = `${Math.floor(matrix.elements[12] / cellSize)},${Math.floor(matrix.elements[14] / cellSize)}`;
    const indices = cells.get(key) ?? [];
    indices.push(i); cells.set(key, indices);
  }
  const color = new THREE.Color();
  const batches: THREE.InstancedMesh[] = [];
  for (const indices of cells.values()) {
    const batch = new THREE.InstancedMesh(source.geometry, source.material, indices.length);
    batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow;
    indices.forEach((index, local) => {
      source.getMatrixAt(index, matrix); batch.setMatrixAt(local, matrix);
      if (source.instanceColor) { source.getColorAt(index, color); batch.setColorAt(local, color); }
    });
    batch.computeBoundingSphere();
    batches.push(batch);
  }
  source.dispose();
  return batches;
}
