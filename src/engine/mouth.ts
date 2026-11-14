import * as THREE from 'three';
import { clamp, lerp, rng, smooth } from './math';
import { Batch, grid, orient } from './geom';
import { patchMaterial } from './shader';
import type { Ctx } from './ctx';

/** Lips, labial webs, oral cavity, tongue, dentition / beak – all scaled to the measured jaw. */
export function buildMouth(ctx: Ctx) {
  const { sp, model, L, u, seed, addMesh, seamJawUpper } = ctx;
  const disposables = { push: (d: { dispose: () => void }) => ctx.track(d) };
  const m = sp.mouth, c = sp.color;
  const { mouthTip: mt, rictus: rc, sSym } = model;
  const symLead = Math.max(0, mt.s - sSym);
  // ── FLESHY LIPS, STRETCHY LABIAL WEBS, ORAL CAVITY, TONGUE & TEETH ─────────
  if (model.hasJaw()) {
    const interiorMat = patchMaterial(
      new THREE.MeshPhysicalMaterial({ color: '#5c2329', roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide }),
      u,
    );
    disposables.push(interiorMat);

    // Lip colour: natural dermal-mucosal blend (or yellow lips on clown triggerfish)
    const lipCol = sp.id === 'clown-triggerfish'
      ? new THREE.Color('#e6b422')
      : sp.skin.kind === 'placoid'
        ? new THREE.Color(c.belly).lerp(new THREE.Color(c.side), 0.35)
        : new THREE.Color(c.side).lerp(new THREE.Color('#ba6c6e'), 0.24 + 0.16 * m.lip);
    const lipMat = patchMaterial(
      new THREE.MeshPhysicalMaterial({ color: lipCol, roughness: 0.28, clearcoat: 0.82, clearcoatRoughness: 0.2 }),
      u,
    );
    disposables.push(lipMat);

    // Stretchy maxillary-labial fold material (blends outer lip/cheek skin with mucosal warmth)
    const webCol = new THREE.Color(c.side).lerp(new THREE.Color('#6a3036'), 0.5);
    const webMat = patchMaterial(
      new THREE.MeshPhysicalMaterial({ color: webCol, roughness: 0.32, clearcoat: 0.7, side: THREE.DoubleSide }),
      u,
    );
    disposables.push(webMat);

    // Continuous 3D oral rim curve u ∈ [0, 1]: u=0 at anterior midline (z=0), u=1 at rictus
    const rimStation = (uVal: number) => {
      const uu = clamp(uVal);
      if (symLead > 1e-4) {
        // smooth horseshoe wrap from (sSym, phi=π, z=0) around mt.s to rc.s
        const split = 0.24;
        if (uu <= split) {
          const k = uu / split;
          const s = lerp(sSym, mt.s, k * k);
          const pTarget = model.seamPhi(mt.s);
          const phi = lerp(Math.PI, pTarget, Math.sin((k * Math.PI) / 2));
          return { s, phi };
        }
        const k = (uu - split) / (1 - split);
        const s = lerp(mt.s, rc.s, k);
        return { s, phi: model.seamPhi(s) };
      }
      // terminal mouths: the rim follows the body's own oral seam right to the snout tip, where the
      // section closes to a point (it used to dive to the ventral midline → V-notch / wavy lip tip)
      const s = lerp(0, rc.s, Math.pow(uu, 1.05));
      return { s, phi: model.seamPhi(Math.max(s, 1e-4)) };
    };

    const rimPoint = (uVal: number, side: 1 | -1, isLower: boolean) => {
      const { s, phi } = rimStation(uVal);
      const ph = side === 1 ? phi : 2 * Math.PI - phi;
      const p = model.surface(s, ph);
      if (uVal <= 1e-4) p.z = 0;
      if (isLower && m.jut > 0) {
        const k2 = (1 - smooth(mt.s, mt.s + 0.075, s)) * smooth(sSym - 0.01, sSym + 0.004, s);
        p.x += m.jut * L * k2;
      }
      const jw = isLower ? model.jawWeight(s, 0) : seamJawUpper(s, ph);
      const pl = model.plasticAt(s, ph, isLower);
      return { p, s, phi: ph, jw, pl };
    };

    // 1. 3D Fleshy Upper & Lower Lip Cushions (wrapping continuously left rictus -> symphysis -> right rictus)
    // lip cushions scale with the jaw: thick-lipped wrasses stay fleshy, tiny mouths no longer crumple
    // Lips are a rolled fold of the head skin (same material & texture as the head), sunk into the
    // head so only the rounded margin stands proud. Frames: outward = away from a point inside the
    // mouth (forward at the chin, lateral at the corners), tangent = symmetric difference across the
    // symphysis → no twisting, no wavy/balled tip.
    const lipBaseR = clamp(m.gape * (0.026 + 0.055 * m.lip) + 0.0005, 0.001, 0.0075) * L;
    const jawLen = Math.max(0.006, rc.s - mt.s);
    const lipSurf = sp.id === 'clown-triggerfish' ? lipMat : ctx.bodyMat;
    const rimSigned = (sg: number, isLower: boolean) => rimPoint(Math.min(1, Math.abs(sg)), sg >= 0 ? 1 : -1, isLower);
    for (const isLower of [false, true]) {
      const nArc = 72, nSec = 12;
      const lipG = grid(nArc, nSec, (uu, vv) => {
        const sg = (uu * 2 - 1) * 0.985;
        const uRim = Math.abs(sg);
        const A = rimSigned(sg, isLower);
        const T = rimSigned(sg + 0.012, isLower).p.sub(rimSigned(sg - 0.012, isLower).p);
        if (T.lengthSq() < 1e-12) T.set(0, 0, 1);
        T.normalize();
        const sI = Math.min(A.s + Math.max(0.004, 0.3 * jawLen), rc.s + 0.01);
        const inner = model.local(sI, model.mouthY(Math.min(sI, rc.s)), 0);
        const N = A.p.clone().sub(inner);
        N.addScaledVector(T, -N.dot(T));
        if (N.lengthSq() < 1e-12) N.copy(model.frame(A.s).T).negate();
        N.normalize();
        const C = new THREE.Vector3().crossVectors(N, T).normalize();
        if (C.dot(model.frame(A.s).N) * (isLower ? 1 : -1) < 0) C.negate(); // across the cleft
        const taper = Math.pow(Math.max(0, 1 - Math.pow(uRim, 2.2)), 0.6);
        const rl = lipBaseR * (0.3 + 0.7 * taper) * (isLower ? 0.9 : 1);
        const ang = vv * Math.PI * 2;
        const q = A.p.clone()
          .addScaledVector(N, (Math.cos(ang) - 0.58) * rl)
          .addScaledVector(C, (Math.sin(ang) * 0.72 - 0.08) * rl);
        if (Math.abs(sg) < 1e-6) q.z = 0;
        const cornerBlend = smooth(0.84, 1.0, uRim);
        const jw = lerp(A.jw, model.jawWeight(rc.s, 0) * 0.55, cornerBlend);
        return { p: q, jaw: jw, plastic: A.pl, uv: [A.s, A.phi / (2 * Math.PI)] as [number, number] };
      }, isLower);
      addMesh(lipG, lipSurf, 2, true);
    }

    // 2. Stretchy Maxillary-Mandibular Labial Corner Membranes (plicae labiales)
    const webStart = clamp(0.56 - (m.protrude ?? 0.35) * 0.24, 0.34, 0.55);
    for (const side of [1, -1] as const) {
      const webR = grid(16, 10, (uu, vv) => {
        const uRim = lerp(webStart, 1.0, uu);
        const U = rimPoint(uRim, side, false);
        const Lw = rimPoint(uRim, side, true);
        const p = U.p.clone().lerp(Lw.p, vv);
        const midFold = Math.sin(Math.PI * vv);
        // concave crescentic anterior margin + slight inward tuck so closed web hides cleanly inside lips
        const fr = model.frame(lerp(U.s, Lw.s, vv));
        const freeBow = (1 - uu) * midFold * Math.min(0.022, m.gape * 0.22) * L;
        p.addScaledVector(fr.T, freeBow);
        p.z *= 1 - 0.045 * (1 - uu * 0.5) * (0.35 + 0.65 * midFold);
        const jw = lerp(U.jw, Lw.jw, vv);
        const stretch = midFold * Math.sin(Math.PI * clamp(uu * 0.85 + 0.15));
        const pl: [number, number, number, number] = [
          lerp(U.pl[0], Lw.pl[0], vv),
          lerp(U.pl[1], Lw.pl[1], vv),
          lerp(U.pl[2], Lw.pl[2], vv),
          stretch,
        ];
        return { p, jaw: jw, plastic: pl };
      }, side === -1);
      addMesh(webR, webMat, 2, true);
    }

    // 3. Vaulted Palate, Hyoid Floor, Sculpted Fleshy Tongue & Pharyngeal Throat
    const s0 = sSym, s1 = rc.s + 0.022;
    const lipAtS = (s: number, side: 1 | -1) => {
      const pm = model.seamPhi(s);
      return model.surface(s, side === 1 ? pm : 2 * Math.PI - pm);
    };
    const mid = (s: number) => ({ y: model.mouthY(Math.min(s, rc.s)), top: model.top(s), bot: model.bot(s) });

    // palate (kept strictly inside dorsal snout contour even during premaxillary protrusion)
    addMesh(grid(12, 24, (uu, vv) => {
      const s = lerp(s0, s1, vv);
      const a = lipAtS(s, 1), b = lipAtS(s, -1);
      const { y, top } = mid(s);
      const dep = 0.34 * Math.max(0.003, top - y) * smooth(s0, lerp(s0, s1, 0.45), s);
      const p = a.clone().lerp(b, uu);
      p.z *= 0.86;
      const arch = Math.sin(Math.PI * uu) * (1 - 0.16 * Math.pow(Math.sin(Math.PI * 2 * uu), 2));
      p.addScaledVector(model.frame(s).N, dep * arch * L);
      const pl = model.plasticAt(s, model.seamPhi(s) * 0.8, false);
      return { p, jaw: seamJawUpper(s, model.seamPhi(s)) * (1 - 0.6 * Math.sin(Math.PI * uu)), plastic: [pl[0] * 0.55, pl[1] * 0.75, 0, 0] };
    }), interiorMat, 1, true);

    // oral floor
    addMesh(grid(12, 24, (uu, vv) => {
      const s = lerp(s0, s1, vv);
      const a = lipAtS(s, 1), b = lipAtS(s, -1);
      const { y, bot } = mid(s);
      const dep = 0.48 * Math.max(0.004, y + bot) * smooth(s0, s0 + 0.028, s);
      const p = a.clone().lerp(b, uu);
      p.z *= 0.91;
      if (m.jut > 0) {
        const k2 = (1 - smooth(mt.s, mt.s + 0.075, s)) * (1 - 0.35 * Math.sin(Math.PI * uu));
        p.x += m.jut * L * k2 * 0.85;
      }
      p.addScaledVector(model.frame(s).N, -dep * Math.sin(Math.PI * uu) * L);
      const w = lerp(model.jawWeight(s, 0), model.jawWeight(s, 0.55), Math.sin(Math.PI * uu));
      const pl = model.plasticAt(s, Math.PI * 0.92, true);
      return { p, jaw: w, plastic: [0, pl[1] * 0.8, pl[2] * 0.85 * Math.sin(Math.PI * uu), 0] };
    }), interiorMat, 1, true);

    // sculpted 3D fleshy tongue (basihyal) on the floor of the mouth
    const ts0 = lerp(s0, rc.s, 0.22), ts1 = rc.s + 0.012;
    if (ts1 - ts0 > 0.012) {
      const tongueMat = patchMaterial(
        new THREE.MeshPhysicalMaterial({ color: '#8a3d45', roughness: 0.32, clearcoat: 0.8, side: THREE.DoubleSide }),
        u,
      );
      addMesh(grid(12, 16, (uu, vv) => {
        const s = lerp(ts0, ts1, vv);
        const hwT = Math.abs(lipAtS(s, 1).z) * 0.46 * Math.pow(Math.sin(Math.PI * clamp(vv * 0.88 + 0.08)), 0.55);
        const { y, bot } = mid(s);
        const baseY = y - 0.34 * Math.max(0.004, y + bot);
        const dome = Math.max(0.003, (y + bot) * 0.26) * Math.sin(Math.PI * uu) * Math.sin(Math.PI * clamp(vv * 0.92 + 0.05));
        const ang = (uu - 0.5) * Math.PI;
        const p = model.local(s, baseY + dome, Math.sin(ang) * hwT / L);
        const w = model.jawWeight(s, 0.35);
        const pl = model.plasticAt(s, Math.PI * 0.95, true);
        return { p, jaw: w, plastic: [0, 0, pl[2] * 0.8, 0] };
      }), tongueMat, 2);
    }

    // pharyngeal throat wall (deep shadow → the open mouth reads as a cavity, not a pink notch)
    const pharynxMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#16060a', roughness: 0.7, side: THREE.DoubleSide }), u);
    disposables.push(pharynxMat);
    addMesh(grid(12, 6, (uu, vv) => {
      const s = s1;
      const a = lipAtS(s, 1), b = lipAtS(s, -1);
      const { y, top, bot } = mid(s);
      const p = a.clone().lerp(b, uu);
      p.z *= 0.91;
      const up = 0.52 * Math.max(0.004, top - y) * Math.sin(Math.PI * uu);
      const dn = -0.48 * Math.max(0.004, y + bot) * Math.sin(Math.PI * uu);
      p.addScaledVector(model.frame(s).N, lerp(up, dn, vv) * L);
      const w = lerp(model.jawWeight(s, 0), model.jawWeight(s, 0.55), Math.sin(Math.PI * uu)) * vv;
      const pl = model.plasticAt(s, Math.PI * 0.9, true);
      return { p, jaw: w, plastic: [0, pl[1] * 0.8, pl[2] * 0.85 * vv, 0] };
    }), pharynxMat, 1, true);

    // 4. Dentition (continuous across anterior symphysis; fused beak plates or multi-row shark/fang teeth)
    if (m.teeth === 'beak') {
      // Solid fused dental plates (parrotfish / puffer beak): crescent section sitting inside the lips,
      // cutting edges meeting in the cleft – visible when closed, separating cleanly when open.
      const beakMat = patchMaterial(
        new THREE.MeshPhysicalMaterial({ color: m.beak ?? '#ece3ce', roughness: 0.24, clearcoat: 0.85, clearcoatRoughness: 0.12 }),
        u,
      );
      disposables.push(beakMat);
      const bH = clamp(m.gape * 0.34 + 0.001, 0.003, 0.016) * L;
      for (const isLower of [false, true]) {
        const beakG = grid(44, 12, (uu, vv) => {
          const signed = (uu * 2 - 1) * 0.86;
          const side: 1 | -1 = signed >= 0 ? 1 : -1;
          const uRim = Math.abs(signed);
          const A = rimPoint(uRim, side, isLower);
          const B = rimPoint(Math.min(1, uRim + 0.025), side, isLower);
          const tang = B.p.clone().sub(A.p);
          if (tang.lengthSq() < 1e-10) tang.set(0, 0, side);
          tang.normalize();
          const ctr = model.local(A.s, 0, 0);
          const outN = A.p.clone().sub(ctr);
          outN.z = A.p.z;
          if (outN.lengthSq() < 1e-10) outN.set(1, isLower ? -0.5 : 0.5, 0);
          outN.normalize();
          const fr = model.frame(A.s);
          const cleftN = fr.N.clone().multiplyScalar(isLower ? 0.85 : -0.85).addScaledVector(outN, 0.45).normalize();
          const outOrtho = outN.clone().addScaledVector(tang, -outN.dot(tang)).normalize();
          const taper = Math.pow(Math.max(0, Math.cos((uRim / 0.86) * Math.PI * 0.47)), 0.55);
          const h = bH * (0.3 + 0.7 * taper);
          const ang = vv * Math.PI * 2;
          const q = A.p.clone()
            .addScaledVector(outOrtho, (Math.cos(ang) * 0.36 - 0.2) * h)
            .addScaledVector(cleftN, (Math.sin(ang) * 0.5 + 0.22) * h);
          if (Math.abs(signed) < 1e-3) q.z = 0;
          return { p: q, jaw: A.jw, plastic: A.pl };
        }, isLower);
        addMesh(beakG, beakMat, 2, true);
      }
    } else if (m.teeth !== 'none' && m.tn > 0) {
      const batch = new Batch();
      const cone = new THREE.ConeGeometry(0.28, 1, 7, 1);
      cone.translate(0, 0.5, 0);
      const tr = rng(seed + 77);
      const rows = m.teeth === 'shark' ? 2 : 1; // functional outer row + inner replacement row in sharks
      for (let row = 0; row < rows; row++)
        for (const side of [1, -1] as const)
          for (const upper of [true, false]) {
            const n = m.tn;
            for (let i = 0; i < n; i++) {
              const t = (i + 0.45) / (n + 0.35) * 0.86;
              const R0 = rimPoint(t, side, !upper);
              const ctr = model.local(R0.s, model.mouthY(Math.min(R0.s, rc.s)), 0);
              const snaggle = sp.id === 'shortfin-mako' || sp.id === 'sloane-s-viperfish' || sp.id === 'black-dragonfish' || sp.id === 'humpback-anglerfish';
              const inset = (snaggle ? 0.05 : 0.2) + row * 0.085;
              const f = model.frame(R0.s);
              // teeth sit BEHIND the rolled lip (hidden when the mouth is closed) – only snaggle-toothed
              // deep-sea fishes and makos show their fangs outside the closed lips
              const lp = R0.p.clone().lerp(ctr, inset).addScaledVector(f.T, lipBaseR * (snaggle ? 0.25 : 1.15) + row * lipBaseR * 0.5);
              const dir = f.N.clone()
                .multiplyScalar(upper ? -1 : 1)
                .addScaledVector(f.T, 0.26 + row * 0.2)
                .add(new THREE.Vector3(0, 0, -side * (0.18 + 0.1 * t)))
                .normalize();
              let h = m.ts * L * (row === 0 ? 1 : 0.72);
              let rad = 1, flat = 1;
              switch (m.teeth) {
                case 'fang': h *= (i % 3 === 0 ? 1.55 : 0.62) * (1.22 - t * 0.55) * (0.88 + tr() * 0.24); rad = 0.52; break;
                case 'tri': rad = 1.55; flat = 0.32; h *= 1.05 - 0.3 * t; break;
                case 'shark': rad = 1.55; flat = 0.28; h *= (upper ? 1.08 : 0.86) * (1.08 - 0.42 * t); break;
                case 'needle': rad = 0.44; h *= 0.82 + tr() * 0.36; break;
                case 'fine': h *= 0.58; break;
              }
              if (m.teeth === 'shark' || m.teeth === 'tri') dir.addScaledVector(f.T, -0.15).normalize();
              const M = orient(lp, dir, h * rad, h, h * rad * flat);
              batch.add(cone, M, R0.jw, undefined, 0, R0.pl);
            }
          }
      const toothMat = patchMaterial(new THREE.MeshPhysicalMaterial({ color: '#f5f0e4', roughness: 0.22, clearcoat: 0.65 }), u);
      addMesh(batch.build(), toothMat, 2);
    }
  }

}
