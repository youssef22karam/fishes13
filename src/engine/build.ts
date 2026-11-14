import * as THREE from 'three';
import { BodyModel } from './model';
import type { Species } from './types';
import { DEG, lerp, smooth } from './math';
import { ensureAttrs, makeUniforms, patchMaterial, type FishUniforms } from './shader';
import { paintBump, paintSkin } from './skin';
import { buildMouth } from './mouth';
import { buildEyes } from './eyes';
import { buildFins } from './fins';
import { buildExtras } from './extras';
import type { Ctx } from './ctx';

const SWIM: Record<string, { amp: number; wave: number; freq: number; a0: number; pow: number; flap: number; finWave: number }> = {
  carangiform: { amp: 0.05, wave: 7, freq: 7, a0: 0.1, pow: 2.2, flap: 0.012, finWave: 0.003 },
  subcarangiform: { amp: 0.06, wave: 6.5, freq: 6, a0: 0.14, pow: 1.8, flap: 0.012, finWave: 0.003 },
  thunniform: { amp: 0.045, wave: 5.5, freq: 9, a0: 0.04, pow: 3.6, flap: 0.004, finWave: 0.0 },
  anguilliform: { amp: 0.065, wave: 12, freq: 6, a0: 0.3, pow: 1.1, flap: 0.01, finWave: 0.004 },
  ostraciiform: { amp: 0.06, wave: 2.5, freq: 8, a0: 0, pow: 7, flap: 0.03, finWave: 0.006 },
  labriform: { amp: 0.018, wave: 5, freq: 4, a0: 0.1, pow: 2, flap: 0.035, finWave: 0.004 },
  rajiform: { amp: 0.01, wave: 6, freq: 3, a0: 0, pow: 3, flap: 0.004, finWave: 0 },
  syngnathiform: { amp: 0.0, wave: 4, freq: 2, a0: 0, pow: 2, flap: 0.02, finWave: 0.015 },
  still: { amp: 0.012, wave: 5, freq: 3, a0: 0.1, pow: 2, flap: 0.01, finWave: 0.002 },
};

export interface FishBuild {
  group: THREE.Group;
  model: BodyModel;
  uniforms: FishUniforms;
  swim: (typeof SWIM)[string];
  wing: number;
  radius: number;
  dispose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export function buildFish(sp: Species, seed = 1): FishBuild {
  const L = 2;
  const model = new BodyModel(sp, L);
  const u = makeUniforms();
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];

  const addMesh = (g: THREE.BufferGeometry, m: THREE.Material, order = 0, shareMat = false) => {
    ensureAttrs(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    group.add(mesh);
    disposables.push(g);
    if (!shareMat) disposables.push(m);
    return mesh;
  };

  const { mouthTip: mt, rictus: rc, sSym } = model;
  const m = sp.mouth;

  // shared jaw-weight helper along the seam so upper & lower seam meet watertight behind rictus
  const seamJawUpper = (s: number, phi: number) => {
    if (!model.hasJaw()) return 0;
    const pFold = phi <= Math.PI ? phi : 2 * Math.PI - phi;
    const pm = model.seamPhi(s);
    const nearSeam = Math.exp(-Math.pow((pm - pFold) / 0.24, 2));
    // smoothly match lower-jaw weight right at/behind the rictus so cheek skin stretches without a slit
    // join zone proportional to the jaw: on tiny mouths it used to drag half the upper lip down
    const join = smooth(rc.s - Math.min(0.01, Math.max(0.004, rc.s - mt.s) * 0.22), rc.s + 0.003, s);
    const wPost = model.jawWeight(s, 0) * join;
    const wCheek = model.upperCornerJaw(s, phi) * (1 - join);
    return (wPost + wCheek) * nearSeam;
  };

  // ── BODY LOFT ──────────────────────────────────────────────────────────────
  const NS = 232, nU = 28, nL = 24;
  const ring = 2 * (nU + nL) + 4;
  const pos = new Float32Array((NS + 1) * ring * 3);
  const uvs = new Float32Array((NS + 1) * ring * 2);
  const jaw = new Float32Array((NS + 1) * ring);
  const plastic = new Float32Array((NS + 1) * ring * 4);
  const sAt: number[] = [];
  const v3 = new THREE.Vector3();
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const s = Math.pow(t, 1.32);
    sAt.push(s);
    const pm = model.seamPhi(s);
    const seg: [number, number, number, number][] = [
      [0, pm, nU, 0],
      [pm, Math.PI, nL, 1],
      [Math.PI, 2 * Math.PI - pm, nL, -1],
      [2 * Math.PI - pm, 2 * Math.PI, nU, 0],
    ];
    let k = i * ring;
    for (const [a, b, n, lj] of seg) {
      for (let j = 0; j <= n; j++) {
        const phi = lerp(a, b, j / n);
        model.surface(s, phi, v3);
        if (lj !== 0 && m.jut > 0 && model.hasJaw()) {
          const depth = lj === 1 ? j / n : 1 - j / n;
          const k2 = (1 - smooth(mt.s, mt.s + 0.075, s)) * smooth(sSym - 0.01, sSym + 0.004, s) * (1 - 0.45 * depth);
          v3.x += m.jut * L * k2;
        }
        pos.set([v3.x, v3.y, v3.z], k * 3);
        uvs.set([s, phi / (2 * Math.PI)], k * 2);
        if (lj !== 0) {
          const depth = lj === 1 ? j / n : 1 - j / n;
          jaw[k] = model.jawWeight(s, depth);
          plastic.set(model.plasticAt(s, phi, true), k * 4);
        } else {
          jaw[k] = seamJawUpper(s, phi);
          plastic.set(model.plasticAt(s, phi, false), k * 4);
        }
        k++;
      }
    }
  }
  const idx: number[] = [];
  const segStart = [0, nU + 1, nU + nL + 2, nU + 2 * nL + 3];
  const segN = [nU, nL, nL, nU];
  for (let i = 0; i < NS; i++)
    for (let q = 0; q < 4; q++)
      for (let j = 0; j < segN[q]; j++) {
        const a = i * ring + segStart[q] + j, b = a + 1, c = a + ring, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
  const bodyG = new THREE.BufferGeometry();
  bodyG.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bodyG.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  bodyG.setAttribute('aJaw', new THREE.BufferAttribute(jaw, 1));
  bodyG.setAttribute('aPlastic', new THREE.BufferAttribute(plastic, 4));
  bodyG.setIndex(idx);
  bodyG.computeVertexNormals();
  {
    const N = bodyG.getAttribute('normal') as THREE.BufferAttribute;
    const avg = (a: number, b: number) => {
      const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l);
    };
    for (let i = 0; i <= NS; i++) {
      const o = i * ring;
      const lipOpen = model.hasJaw() && sAt[i] >= sSym - 0.004 && sAt[i] <= rc.s + 0.004;
      if (!lipOpen) { avg(o + nU, o + nU + 1); avg(o + nU + 2 * nL + 2, o + nU + 2 * nL + 3); }
      avg(o + nU + nL + 1, o + nU + nL + 2);
      avg(o + ring - 1, o);
    }
    N.needsUpdate = true;
  }

  const skin = paintSkin(model, seed);
  const bump = paintBump(model, seed);
  const c = sp.color;
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: skin.tex,
    bumpMap: bump,
    bumpScale: sp.skin.bump,
    roughness: c.rough ?? 0.4,
    metalness: c.metal ?? 0.08,
    clearcoat: 0.58,
    clearcoatRoughness: 0.3,
    iridescence: c.iri ?? 0,
    iridescenceIOR: 1.6,
    sheen: c.sheen ?? 0,
    sheenColor: new THREE.Color(c.side),
    transparent: !!c.trans,
    opacity: c.trans ? 1 - c.trans : 1,
  });
  patchMaterial(bodyMat, u);
  addMesh(bodyG, bodyMat, 1);
  disposables.push(skin.tex, bump);

  // ── anatomical sub-builders (all positioned through the same BodyModel) ──
  const ctx: Ctx = {
    sp, model, L, u, seed, addMesh, seamJawUpper, bodyMat, skinTex: skin.tex, bump,
    track: (d) => disposables.push(d),
  };
  if (model.hasJaw()) buildMouth(ctx);
  buildEyes(ctx);
  buildFins(ctx);
  buildExtras(ctx);

  // ── animation constants & plan orientation ────────────────────────────────
  const swim = SWIM[sp.swim.mode] ?? SWIM.carangiform;
  const fwd0 = model.frame(0).T.clone().negate();
  u.uFwd.value.set(fwd0.x, fwd0.y).normalize();
  u.uHinge.value.copy(model.hingeXY());
  u.uMaxGape.value = Math.max(5, sp.mouth.open) * DEG;
  u.uProtrude.value = model.protrudeAmt();
  u.uGular.value = model.gularAmt();
  u.uL.value = L;
  u.uX0.value = model.local(0, 0, 0).x;
  u.uAmp.value = sp.body.bend ? 0 : swim.amp;
  u.uWave.value = swim.wave;
  u.uFreq.value = swim.freq;
  u.uA0.value = swim.a0;
  u.uPow.value = swim.pow;
  u.uFlap.value = swim.flap;
  u.uFinWave.value = swim.finWave;
  let wing = 0;
  if (sp.plan === 'ray') {
    wing = sp.id.includes('manta') ? 0.22 : 0.1;
    u.uSpan.value = (sp.body.disc?.span ?? 0.5) * L;
    u.uWingF.value = sp.id.includes('manta') ? 1.4 : 2.2;
  }
  u.uWing.value = wing;
  if (sp.plan === 'flatR') group.rotation.x = -Math.PI / 2;
  if (sp.plan === 'flatL') group.rotation.x = Math.PI / 2;

  const box = new THREE.Box3().setFromObject(group);
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const ctr = box.getCenter(new THREE.Vector3());
  const localCtr = ctr.clone().applyQuaternion(group.quaternion.clone().invert());
  // preserve exact z = 0 symmetry plane for all bilateral fishes & rays!
  if (sp.plan === 'fish' || sp.plan === 'ray') localCtr.z = 0;
  group.children.forEach((ch) => ch.position.sub(localCtr));

  return {
    group, model, uniforms: u, swim, wing, radius,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
