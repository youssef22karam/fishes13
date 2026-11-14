import type * as THREE from 'three';
import type { BodyModel } from './model';
import type { FishUniforms } from './shader';
import type { Species } from './types';

/** Shared build context handed to every anatomical sub-builder. */
export interface Ctx {
  sp: Species;
  model: BodyModel;
  L: number;
  u: FishUniforms;
  seed: number;
  addMesh: (g: THREE.BufferGeometry, m: THREE.Material, order?: number, shareMat?: boolean) => THREE.Mesh;
  track: (d: { dispose: () => void }) => void;
  seamJawUpper: (s: number, phi: number) => number;
  bodyMat: THREE.MeshPhysicalMaterial;
  skinTex: THREE.Texture;
  bump: THREE.Texture;
}
