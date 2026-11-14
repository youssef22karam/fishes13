import * as THREE from 'three';
import { clamp } from './math';
import { grid, type Q4 } from './geom';
import { patchMaterial } from './shader';
import type { Ctx } from './ctx';

/**
 * Teleost eyes, built the way they are in life:
 *  - a large globe whose exposed cap is entirely iris + pupil (fishes show no white sclera);
 *    the orbit opening equals the measured eye diameter,
 *  - a clear, slightly flattened cornea continuous with the head skin (no eyelids),
 *  - an orbit margin made of the body skin itself, flush with the head (only a hair-thin rim),
 *  - every part is ANCHORED to the skin point at the centre of the orbit, so when the cheeks and
 *    suspensorium expand during a strike the eye rides on the skin instead of sinking into it,
 *  - close-set eyes (mudskippers, stargazers) are spaced so the orbits never overlap.
 */
export function buildEyes(ctx: Ctx) {
  const { sp, model, L, u, addMesh } = ctx;
  const e = sp.eye;
  if (e.d <= 0) return;
  const r = (e.d / 2) * L; // radius of the orbit opening (world)
  const bulge = clamp(e.bulge ?? 0.3, 0, 1);
  const flat = sp.plan === 'flatR' || sp.plan === 'flatL';

  // bilateral fishes: lower the eyes until the two orbit openings are clear of each other
  let yE = e.y;
  if (!flat) {
    for (let k = 0; k < 80 && yE > -0.3; k++) {
      if (model.attach(e.s, yE, 1).p.z >= r * 1.07) break;
      yE -= 0.012;
    }
  }
  const sides: { side: 1 | -1; s: number; y: number }[] = [];
  if (flat) {
    const sd = sp.plan === 'flatR' ? 1 : -1;
    sides.push({ side: sd, s: e.s, y: e.y }, { side: sd, s: e.s + e.d * 0.95, y: e.y - 0.4 });
  } else sides.push({ side: 1, s: e.s, y: yE }, { side: -1, s: e.s, y: yE });

  const iris = new THREE.Color(e.iris);
  const iris2 = e.iris2 ? new THREE.Color(e.iris2) : iris.clone().lerp(new THREE.Color('#fff0c0'), 0.45);
  const limbus = new THREE.Color(e.ring ?? e.iris).multiplyScalar(0.2);
  const eyeMat = patchMaterial(
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08 }),
    u, undefined, { eye: { iris, iris2, pupil: new THREE.Color('#010203'), globe: limbus } },
  );
  const corneaMat = patchMaterial(
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.015, metalness: 0, transparent: true, opacity: 0.07,
      clearcoat: 1, clearcoatRoughness: 0.01, ior: 1.376, depthWrite: false, envMapIntensity: 2.2,
    }),
    u,
  );
  ctx.track(eyeMat); ctx.track(corneaMat);

  for (const { side, s, y } of sides) {
    const at = model.attach(s, y, side);
    const fr = model.frame(s);
    const ez = at.n.clone();
    const fwd = fr.T.clone().negate();
    const ex = fwd.clone().addScaledVector(ez, -fwd.dot(ez)).normalize();
    const ey = new THREE.Vector3().crossVectors(ez, ex);
    if (ey.dot(fr.N) < 0) ey.negate();
    const handed = new THREE.Vector3().crossVectors(ex, ey).dot(ez) > 0;

    // globe: exposed cap radius == r; protrusion grows with `bulge`
    const kDepth = 0.5 - 0.4 * bulge; // depth of globe centre below the skin / globe radius
    let R = r / Math.sqrt(1 - kDepth * kDepth);
    // keep the back of the globe inside the head on very compressed fishes
    const room = Math.abs(at.p.z) / Math.max(0.25, Math.abs(ez.z));
    R = Math.min(R, room / Math.max(0.2, kDepth + 0.32));
    const depth = kDepth * R;
    const ctr = at.p.clone().addScaledVector(ez, -depth);
    const P = (lx: number, ly: number, lz: number, rad: number, zs = 1) =>
      ctr.clone().addScaledVector(ex, lx * rad).addScaledVector(ey, ly * rad).addScaledVector(ez, lz * rad * zs);

    // skin-anchor: the eye translates with the skin at the orbit centre
    const ancJ = ctx.seamJawUpper(s, at.phi);
    const ancPl = model.plasticAt(s, at.phi, false);
    const anchor = (g: THREE.BufferGeometry, w: (i: number) => number) => {
      const n = g.getAttribute('position').count;
      const A = new Float32Array(n * 4), Pl = new Float32Array(n * 4), W = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        A.set([at.p.x, at.p.y, at.p.z, ancJ], i * 4);
        Pl.set(ancPl, i * 4);
        W[i] = w(i);
      }
      g.setAttribute('aAnc', new THREE.BufferAttribute(A, 4));
      g.setAttribute('aAncPl', new THREE.BufferAttribute(Pl, 4));
      g.setAttribute('aAncW', new THREE.BufferAttribute(W, 1));
      return g;
    };

    // where the orbit skin meets the globe (higher on protruding, "stalked" eyes)
    const cIn = clamp(kDepth + 0.05 + 0.34 * bulge * bulge, -0.5, 0.9);
    const thIn = Math.acos(cIn);
    const Z4: Q4 = [0, 0, 0, 0];

    // 1. globe – iris/pupil shading is gaze driven in the shader (local coords in aEye)
    const globe = grid(64, 34, (uu, vv) => {
      const th = vv * Math.PI * 0.58, ph = uu * Math.PI * 2;
      const lx = Math.sin(th) * Math.cos(ph), ly = Math.sin(th) * Math.sin(ph), lz = Math.cos(th);
      return { p: P(lx, ly, lz, R, 0.985), plastic: Z4, eye: [lx, ly, lz, side * (1 + cIn)] };
    }, handed);
    addMesh(anchor(globe, () => 1), eyeMat, 2, true);

    // 2. cornea – clear dome just proud of the globe, its margin tucked under the orbit skin
    const Rc = R * 1.022;
    const thC = Math.acos(clamp((R * cIn) / Rc - 0.015, -0.9, 0.99)) + 0.03;
    const cornea = grid(56, 14, (uu, vv) => {
      const th = vv * thC, ph = uu * Math.PI * 2;
      return { p: P(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th), Rc, 0.97), plastic: Z4 };
    }, handed);
    addMesh(anchor(cornea, () => 1), corneaMat, 3, true);

    // 3. orbit margin: body skin from the globe out onto the head, flush (no raised goggle rim)
    const rhoMax = clamp((Math.abs(at.p.z) / r) * 0.98, 1.12, 1.6);
    const rimH = R * cIn - depth; // height of the skin/globe junction above the head surface
    const rows: [number, number][] = [
      [0, 0],
      [1.0, Math.max(0.022 * r, rimH * 0.9)],
      [lerpN(1.0, rhoMax, 0.3), Math.max(0.009 * r, rimH * 0.35)],
      [lerpN(1.0, rhoMax, 0.65), 0.003 * r],
      [rhoMax, -0.004 * r],
    ];
    const NU = 72;
    const rim = grid(NU, rows.length - 1, (uu, vv) => {
      const k = Math.round(vv * (rows.length - 1));
      const al = uu * Math.PI * 2, ca = Math.cos(al), sa = Math.sin(al);
      let p: THREE.Vector3;
      if (k === 0) p = P(Math.sin(thIn) * ca, Math.sin(thIn) * sa, Math.cos(thIn), R * 0.995, 0.985);
      else {
        const [rho, lift] = rows[k];
        const pr = model.project(at.p.clone().addScaledVector(ex, ca * rho * r).addScaledVector(ey, sa * rho * r));
        p = model.surface(pr.s, pr.phi).addScaledVector(model.normalAt(pr.s, pr.phi), lift);
      }
      const pr = model.project(p);
      return { p, uv: [pr.s, pr.phi / (2 * Math.PI)], jaw: ctx.seamJawUpper(pr.s, pr.phi), plastic: model.plasticAt(pr.s, pr.phi, false) };
    }, handed);
    // inner rows ride rigidly with the eye, the outer row deforms exactly like the head skin
    const rowW = [1, 1, 0.7, 0.3, 0];
    addMesh(anchor(rim, (i) => rowW[Math.floor(i / (NU + 1))] ?? 0), ctx.bodyMat, 1, true);
  }
}

function lerpN(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
