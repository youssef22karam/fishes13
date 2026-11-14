import * as THREE from 'three';
import type { Species } from './types';
import { clamp, curve, DEG, lerp, smooth } from './math';

/**
 * BodyModel – the analytic description of one fish, derived purely from its
 * morphometrics. Everything attached to the body (fins, eyes, lips, jaws,
 * barbels, teeth) is positioned through this model so all parts agree.
 *
 * Coordinates: loft parameter s ∈ [0,1] (snout → caudal base),
 * object space: snout points to +X, dorsal is +Y, right flank is +Z.
 * One loft-length = `L` world units.
 */
export class BodyModel {
  readonly sp: Species;
  readonly L: number;
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  private th = new Float64Array(0);
  private K = 600;
  readonly mouthTip: { s: number; y: number };
  readonly rictus: { s: number; y: number };
  readonly hinge: { s: number; y: number };
  readonly sSym: number;

  constructor(sp: Species, L = 2) {
    this.sp = sp;
    this.L = L;
    this.buildCenterline();
    const m = sp.mouth;
    const yTip = this.normY(m.s, m.y);
    const a = m.angle * DEG;
    const rs = clamp(m.s + m.gape * Math.cos(a), m.s + 0.004, 0.92);
    let ry = yTip - m.gape * Math.sin(a);
    // Anatomical law for ventral / sub-terminal mouths (sharks, sturgeons, sawfish, ratfish):
    // rictus must follow the descending ventral head contour, never rising into a cheek "smile".
    if (m.y <= -0.58 && m.angle < 25) {
      ry = Math.min(ry, -this.bot(rs) * 0.62);
    }
    ry = clamp(ry, -this.bot(rs) * 0.9, this.top(rs) * 0.9);
    this.mouthTip = { s: m.s, y: yTip };
    this.rictus = { s: rs, y: ry };
    const symLead = m.s > 0.003 ? Math.min(m.s * 0.42, 0.022) : 0;
    this.sSym = Math.max(0.0005, m.s - symLead);
    // quadrate–articular / Meckel's joint: slightly behind and below the rictus
    this.hinge = {
      s: rs + clamp(m.gape * 0.16, 0.006, 0.022),
      y: ry - clamp(m.gape * 0.06, 0.002, 0.009),
    };
  }

  // ── outline ────────────────────────────────────────────────────────────────
  private front(t: number, b: number) {
    const a = 1 + b * 1.65;
    const c = 1 + b * 1.28;
    return Math.pow(clamp(1 - Math.pow(1 - clamp(t), a)), 1 / c);
  }
  private back(t: number, e: number) {
    return 0.5 + 0.5 * Math.cos(Math.PI * Math.pow(clamp(t), e));
  }
  private bumps(s: number, side: 1 | -1) {
    let v = 0;
    for (const [bs, h, w, sd] of this.sp.body.bumps ?? []) {
      if (sd !== side) continue;
      const d = (s - bs) / w;
      v += h * Math.exp(-d * d);
    }
    return v;
  }
  private hypuralFlare(s: number) {
    const b = this.sp.body;
    if (b.disc || b.bend || b.P < 0.025 || b.P > 0.3 || this.sp.fins.caudal.span <= 0.08) return 1;
    return 1 + 0.065 * Math.pow(smooth(0.94, 1.0, s), 1.6);
  }

  /** dorsal height above the axis (SL units) */
  top(s: number) {
    const b = this.sp.body;
    const Dt = b.D * b.df;
    const Pt = (b.P / 2 + b.pedY) * this.hypuralFlare(s);
    let v: number;
    if (s <= b.pD) {
      const t = s / Math.max(1e-4, b.pD);
      v = Dt * this.front(t, b.bD);
      // subtle cranial-to-nuchal inflection on sleek/moderate snouts
      const nape = b.nape ?? (b.disc || b.bend ? 0 : clamp(0.48 - b.bD, -0.15, 0.32) * 0.22);
      if (nape !== 0) {
        v -= Dt * nape * Math.sin(Math.PI * Math.pow(clamp(t), 0.85)) * (1 - smooth(0.45, 0.95, t));
      }
    } else {
      v = Pt + (Dt - Pt) * this.back((s - b.pD) / Math.max(1e-4, 1 - b.pD), b.tD);
    }
    return Math.max(0, v + this.bumps(s, 1) * smooth(0, 0.04, s));
  }

  /** ventral depth below the axis (SL units) */
  bot(s: number) {
    const b = this.sp.body;
    const Dv = b.D * (1 - b.df);
    const Pb = (b.P / 2 - b.pedY) * this.hypuralFlare(s);
    let v: number;
    if (s <= b.pV) v = Dv * this.front(s / Math.max(1e-4, b.pV), b.bV);
    else v = Pb + (Dv - Pb) * this.back((s - b.pV) / Math.max(1e-4, 1 - b.pV), b.tV);
    return Math.max(0, v + this.bumps(s, -1) * smooth(0, 0.04, s));
  }

  /** half width (SL units) */
  hw(s: number) {
    const b = this.sp.body;
    if (b.disc) return this.discW(s);
    const base = ((this.top(s) + this.bot(s)) / 2) * b.W;
    let w = base * lerp(b.Wh, 1, smooth(0.02, 0.34, s)) * lerp(1, b.Wt, smooth(0.35, 0.95, s));
    if (this.sp.skin.kind === 'placoid' && s > 0.16 && s < 0.26) {
      // subtle 3D branchial gill-slit fluting on sharks
      const env = Math.sin(Math.PI * clamp((s - 0.165) / 0.08));
      w *= 1 - 0.022 * env * (0.5 + 0.5 * Math.sin(((s - 0.17) / 0.015) * Math.PI * 2));
    }
    // lateral compression into the hypural plate at the caudal fin base
    if (!b.bend && this.sp.fins.caudal.span > 0.06) {
      w *= 1 - 0.46 * Math.pow(smooth(0.92, 1.0, s), 1.5);
    }
    for (const [bs, e, ww] of b.wbumps ?? []) {
      const d = (s - bs) / ww;
      w += e * Math.exp(-d * d * d * d);
    }
    return w;
  }

  private discW(s: number) {
    const d = this.sp.body.disc!;
    const tail = d.tailW * (1 - 0.7 * smooth(d.end, 1, s));
    let w: number;
    if (s <= d.pW) {
      const t = s / d.pW;
      w = d.span * Math.pow(this.front(t, 0.12), d.fr);
      if (d.head) w = Math.max(w, d.head * this.front(s / 0.03, 0.8));
    } else if (s <= d.end) {
      const t = (s - d.pW) / (d.end - d.pW);
      w = d.span * Math.pow(1 - t, d.bk);
    } else w = 0;
    return Math.max(w, s > d.pW * 0.5 ? tail : 0);
  }

  /** half perimeter of a section (SL units) – used for isotropic texturing */
  halfPerim(s: number) {
    const h = (this.top(s) + this.bot(s)) / 2;
    const w = this.hw(s);
    return Math.PI * Math.sqrt((h * h + w * w) / 2) + 1e-4;
  }

  normY(s: number, yn: number) {
    return yn >= 0 ? yn * this.top(s) : yn * this.bot(s);
  }

  // ── centreline (supports seahorse-like bending) ───────────────────────────
  private buildCenterline() {
    const K = this.K;
    const bend = this.sp.body.bend;
    const f = bend && bend.length > 1 ? curve(bend) : () => 0;
    this.cx = new Float64Array(K + 1);
    this.cy = new Float64Array(K + 1);
    this.th = new Float64Array(K + 1);
    let x = 0, y = 0;
    for (let i = 0; i <= K; i++) {
      const s = i / K;
      const t = f(s) * DEG;
      this.th[i] = t;
      this.cx[i] = x;
      this.cy[i] = y;
      x += -Math.cos(t) / K;
      y += -Math.sin(t) / K;
    }
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let i = 0; i <= K; i++) {
      mnx = Math.min(mnx, this.cx[i]); mxx = Math.max(mxx, this.cx[i]);
      mny = Math.min(mny, this.cy[i]); mxy = Math.max(mxy, this.cy[i]);
    }
    const ox = (mnx + mxx) / 2, oy = bend ? (mny + mxy) / 2 : 0;
    for (let i = 0; i <= K; i++) { this.cx[i] -= ox; this.cy[i] -= oy; }
  }
  private sample(arr: Float64Array, s: number) {
    const f = clamp(s) * this.K;
    const i = Math.min(this.K - 1, Math.floor(f));
    const t = f - i;
    if (s > 1) return arr[this.K] + (arr[this.K] - arr[this.K - 1]) * (s - 1) * this.K;
    if (s < 0) return arr[0] + (arr[1] - arr[0]) * s * this.K;
    return lerp(arr[i], arr[i + 1], t);
  }
  heading(s: number) {
    return this.sample(this.th, clamp(s));
  }
  /** local (s, y, z) in SL units → object space */
  local(s: number, y: number, z: number, out = new THREE.Vector3()) {
    const t = this.heading(s);
    const nx = -Math.sin(t), ny = Math.cos(t);
    const cx = this.sample(this.cx, s), cy = this.sample(this.cy, s);
    return out.set((cx + nx * y) * this.L, (cy + ny * y) * this.L, z * this.L);
  }
  /** backward tangent and dorsal normal (object space, unit) */
  frame(s: number) {
    const t = this.heading(s);
    return {
      T: new THREE.Vector3(-Math.cos(t), -Math.sin(t), 0),
      N: new THREE.Vector3(-Math.sin(t), Math.cos(t), 0),
    };
  }

  // ── cross-section ─────────────────────────────────────────────────────────
  private yExponents() {
    const b = this.sp.body;
    const flat = b.bellyFlat ?? (b.Wh >= 1.25 && !b.disc ? clamp((b.Wh - 1.15) * 0.9, 0, 0.55) : 0);
    const ed = 2 / b.sq;
    const ev = 2 / lerp(b.sq, Math.max(b.sq, 3.3), flat);
    return { ed, ev, flat };
  }

  sectionYZ(s: number, phi: number): [number, number] {
    const b = this.sp.body;
    const { ed, ev, flat } = this.yExponents();
    const c = Math.cos(phi), sn = Math.sin(phi);
    const y = c >= 0 ? this.top(s) * Math.pow(c, ed) : -this.bot(s) * Math.pow(-c, ev);

    // lateral width profile: epaxial muscular shoulder fullness + optional ventral keel or flat sole
    const ez = c >= 0 ? ed : lerp(ed, ev, 0.7);
    let wShape = Math.pow(Math.abs(sn), ez);
    if (!b.disc && b.sq < 3.2) {
      // epaxial muscle fullness above lateral midline
      wShape *= 1 + 0.065 * c * (1 - flat * 0.6);
      // compressed ventral keel (clupeids, piranha, tarpon, arowana)
      const kv = b.keelVentral ?? 0;
      if (kv > 0 && c < 0) wShape *= 1 - kv * 0.38 * Math.pow(-c, 1.4);
    }
    let w = this.hw(s) * wShape;
    // smooth lateral opercular fullness (only on the mid-flank gill cover, never creasing dorsal/ventral midlines)
    const hl = this.sp.HL;
    if (!b.disc && this.sp.skin.kind !== 'placoid' && hl > 0.12 && this.sp.mouth.kind !== 'disc') {
      const op = smooth(hl * 0.3, hl * 0.82, s) * (1 - smooth(hl * 0.84, hl * 1.22, s));
      w *= 1 + 0.028 * op * sn * sn;
    }
    // sculpted gill cover: the operculum overlaps the flank, so its free margin stands slightly proud
    if (!b.disc && this.sp.skin.kind !== 'placoid' && hl > 0.1 && this.sp.mouth.kind !== 'disc' && this.sp.plan !== 'ray') {
      const hN = Math.acos(clamp(c, -1, 1)) / Math.PI; // 0 dorsal … 1 ventral (texture h)
      if (hN > 0.15 && hN < 0.9) {
        const edge = hl - 0.025 * Math.cos((hN - 0.5) * 3.2) * (1 - Math.abs(hN - 0.55));
        const cover = smooth(edge - 0.08, edge - 0.012, s) * (1 - smooth(edge - 0.002, edge + 0.009, s));
        const hv = smooth(0.15, 0.27, hN) * (1 - smooth(0.78, 0.9, hN));
        w *= 1 + 0.034 * cover * hv * sn * sn;
      }
    }
    // hydrodynamic lateral caudal peduncle keel (tunas, billfishes, lamnid sharks, jacks)
    if (b.keel && s > 0.79 && s < 0.995) {
      const ks = Math.sin(Math.PI * clamp((s - 0.8) / 0.19));
      const kp = Math.exp(-Math.pow(c / 0.2, 2));
      w += b.keel * ks * kp * Math.abs(sn);
    }
    return [y, Math.sign(sn) * w];
  }

  surface(s: number, phi: number, out = new THREE.Vector3()) {
    const [y, z] = this.sectionYZ(s, phi);
    return this.local(s, y, z, out);
  }

  /** angle φ on the right flank at which the section reaches height y */
  phiAtY(s: number, y: number) {
    const { ed, ev } = this.yExponents();
    const t = this.top(s), b = this.bot(s);
    let c: number;
    if (y >= 0) c = t < 1e-6 ? 0 : Math.pow(Math.min(y / t, 0.985), 1 / ed);
    else c = b < 1e-6 ? 0 : -Math.pow(Math.min(-y / b, 0.985), 1 / ev);
    return Math.acos(clamp(c, -1, 1));
  }

  /** outward surface point & normal for an attachment at (s, normalised y) on the right/left flank */
  attach(s: number, yn: number, side: 1 | -1 = 1) {
    const s1 = clamp(s, 0.0005, 0.9995);
    const phi = this.phiAtY(s1, this.normY(s1, yn));
    const ph = side === 1 ? phi : 2 * Math.PI - phi;
    const p = this.surface(s1, ph);
    const ds = 0.002, dp = 0.01;
    const a = this.surface(s1 + ds, ph).sub(this.surface(s1 - ds, ph));
    const b = this.surface(s1, ph + dp).sub(this.surface(s1, ph - dp));
    const n = new THREE.Vector3().crossVectors(b, a).normalize();
    const c = this.local(s1, 0, 0);
    if (n.dot(p.clone().sub(c)) < 0) n.negate();
    if (!isFinite(n.x)) n.set(0, 0, side);
    return { p, n, phi: ph };
  }

  // ── mouth & fleshy plasticity ─────────────────────────────────────────────
  /** height of the oral cleft at s (between tip and rictus) */
  mouthY(s: number) {
    const { mouthTip: a, rictus: r } = this;
    const t = clamp((s - a.s) / Math.max(1e-4, r.s - a.s));
    const y = lerp(a.y, r.y, t) + this.sp.mouth.curve * this.sp.mouth.gape * Math.sin(Math.PI * t);
    return clamp(y, -this.bot(s) * 0.96, this.top(s) * 0.96);
  }
  hasJaw() {
    const k = this.sp.mouth.kind ?? 'jaw';
    return k === 'jaw' && this.sp.mouth.gape > 0.004;
  }
  /** φ of the mouth seam for any station (smoothly continued past the rictus) */
  seamPhi(s: number) {
    const { mouthTip: a, rictus: r, sSym } = this;
    if (!this.hasJaw()) return Math.PI * 0.5 + 0.35;
    if (s < a.s) {
      const p0 = this.phiAtY(a.s + 1e-4, this.mouthY(a.s + 1e-4));
      if (a.s - sSym < 1e-4) return p0;
      const k = clamp((s - sSym) / (a.s - sSym));
      return lerp(Math.PI - 0.02, p0, Math.sqrt(k));
    }
    if (s <= r.s) return this.phiAtY(s, this.mouthY(s));
    const pr = this.phiAtY(r.s, this.mouthY(r.s));
    return lerp(pr, Math.PI * 0.5 + 0.35, smooth(r.s, r.s + 0.25, s));
  }

  /** lower-jaw skinning weight. `depth` 0 at lip, 1 at ventral midline */
  jawWeight(s: number, depth: number) {
    if (!this.hasJaw()) return 0;
    const { mouthTip: a, rictus: r, sSym } = this;
    const m = this.sp.mouth;
    const sClamped = clamp(s, a.s, r.s);
    const lipY = this.mouthY(sClamped);
    const vSpan = Math.max(1e-4, lipY + this.bot(s));
    // anatomical height of mandible + gular floor so deep chests stay smooth without pinching under the chin
    const maxJawH = clamp(m.gape * 1.45 + 0.06, 0.07, 0.19);
    const yBelowLip = depth * vSpan;
    const radialFade = 1 - smooth(maxJawH * 0.7, maxJawH * 1.5, yBelowLip);
    const ext = 0.02 + clamp(yBelowLip, 0, maxJawH) * 0.75 + depth * (m.throat ?? 0.065) * 0.55;
    // fade toward the rictus proportional to the jaw length (tiny jaws used to lose half their lower lip)
    const jl = Math.max(0.006, r.s - a.s);
    let w = (1 - smooth(r.s - Math.min(0.016, jl * 0.28), r.s + Math.min(ext, 0.012 + jl * 0.6), s)) * radialFade;
    // full weight AT the symphysis (the chin used to lag behind the rest of the mandible → kinked tip)
    if (sSym > 0.002) w *= smooth(sSym - 0.012, sSym - 0.0005, s);
    // the mandible ends at the quadrate joint: skin behind it is handled by the hyoid/gular channel
    w *= 1 - smooth(this.hinge.s - 0.004, this.hinge.s + clamp(m.gape * 0.3, 0.012, 0.04), s);
    return w;
  }

  /** premaxillary / upper-jaw protrusion travel in SL units at full gape */
  protrudeAmt() {
    if (!this.hasJaw()) return 0;
    const m = this.sp.mouth;
    const g = Math.max(0.012, m.gape);
    if (m.protrude !== undefined) return clamp(m.protrude * 0.42 * g, 0, 0.032);
    if (this.sp.rostrum) return 0.002;
    if (m.teeth === 'shark') return clamp(0.12 * g, 0.004, 0.012); // palatoquadrate protrusion
    if (m.teeth === 'fang' || m.teeth === 'needle' || m.teeth === 'tri' || m.teeth === 'beak') return clamp(0.05 * g, 0.001, 0.005);
    // teleost suction / protrusible premaxilla – proportional to the jaw
    return clamp(g * (0.1 + m.lip * 0.22), 0.002, 0.03);
  }

  /** hyoid / gular floor depression & cheek expansion amplitude in SL units at full gape */
  gularAmt() {
    if (!this.hasJaw()) return 0;
    const m = this.sp.mouth;
    const g = Math.max(0.012, m.gape);
    const head = clamp(this.sp.body.D * 0.5, 0.04, 0.3);
    if (m.gular !== undefined) return Math.min(0.04, m.gular * (0.008 + 0.22 * g + 0.02 * head));
    return clamp(0.006 + g * 0.12 + (m.open / 60) * 0.008, 0.004, 0.036);
  }

  /**
   * 4-channel fleshy plasticity weights at a body surface vertex:
   *  x = upper-jaw / premaxilla protrusion
   *  y = lateral cheek / suspensorium / operculum flare
   *  z = ventral hyoid / gular floor depression
   *  w = labial corner / cheek skin elastic tension
   */
  plasticAt(s: number, phi: number, isLower: boolean): [number, number, number, number] {
    if (!this.hasJaw()) return [0, 0, 0, 0];
    const { mouthTip: a, rictus: r } = this;
    const gape = Math.max(0.015, r.s - a.s);
    const pm = this.seamPhi(s);
    const pFold = phi <= Math.PI ? phi : 2 * Math.PI - phi; // 0 dorsal .. π ventral

    // 1. Premaxillary / upper-lip plastic protrusion
    let prot = 0;
    if (!isLower) {
      const sEnv = smooth(a.s - 0.02, a.s + 0.004, s) * (1 - smooth(a.s + gape * 0.25, r.s - 0.002, s));
      const dPhi = Math.max(0, pm - pFold) / Math.max(0.22, pm * 0.65);
      prot = sEnv * Math.exp(-dPhi * dPhi * 1.8);
    }

    // 2. Suspensorium / cheek / operculum lateral flare during buccal expansion
    const hl = Math.max(this.sp.HL, r.s + 0.05);
    const cEnv = smooth(a.s + gape * 0.35, r.s + 0.01, s) * (1 - smooth(hl * 0.82, hl * 1.08, s));
    const cheek = cEnv * Math.pow(Math.abs(Math.sin(phi)), 1.4);

    // 3. Ventral hyoid / branchiostegal gular depression
    const gEnv = smooth(a.s + gape * 0.28, r.s, s) * (1 - smooth(hl * 0.72, hl * 1.15, s));
    const vent = smooth(0.45, 1.0, -Math.cos(pFold));
    const gular = gEnv * vent;

    // 4. Rictus cheek skin stretch
    const ds = (s - r.s) / Math.max(0.018, gape * 0.35);
    const dp = (pFold - pm) / 0.35;
    const corner = Math.exp(-(ds * ds + dp * dp));

    return [prot, cheek, gular, corner];
  }

  /** gentle cheek follow weight on the upper face right around the rictus */
  upperCornerJaw(s: number, phi: number) {
    if (!this.hasJaw()) return 0;
    const { mouthTip: a, rictus: r } = this;
    const gape = Math.max(0.015, r.s - a.s);
    const pFold = phi <= Math.PI ? phi : 2 * Math.PI - phi;
    const pm = this.seamPhi(s);
    const nearRictus = smooth(r.s - gape * 0.32, r.s, s) * (1 - smooth(r.s, r.s + 0.032, s));
    const nearSeam = Math.exp(-Math.pow((pm - pFold) / 0.22, 2));
    return 0.2 * nearRictus * nearSeam;
  }

  /** φ on the right flank (0..π) where the section half-width equals zAbs (dorsal or ventral half) */
  phiAtZ(s: number, zAbs: number, dorsal: boolean) {
    let lo = dorsal ? 0 : Math.PI / 2, hi = dorsal ? Math.PI / 2 : Math.PI;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      const z = Math.abs(this.sectionYZ(s, mid)[1]);
      if ((z < zAbs) === dorsal) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** outward unit surface normal at (s, φ) */
  normalAt(s: number, phi: number) {
    const s1 = clamp(s, 0.0015, 0.9985);
    const ds = 0.0015, dp = 0.012;
    const a = this.surface(s1 + ds, phi).sub(this.surface(s1 - ds, phi));
    const b = this.surface(s1, phi + dp).sub(this.surface(s1, phi - dp));
    const n = new THREE.Vector3().crossVectors(b, a).normalize();
    const p = this.surface(s1, phi), c = this.local(s1, 0, 0);
    if (n.dot(p.sub(c)) < 0) n.negate();
    if (!isFinite(n.x) || n.lengthSq() < 0.5) n.set(0, Math.cos(phi), Math.sin(phi));
    return n;
  }

  /** approximate body-surface coordinates (s, φ) of an object-space point near the skin */
  project(p: THREE.Vector3) {
    let best = 0, bd = 1e9;
    for (let i = 0; i <= 160; i++) {
      const si = i / 160;
      // nearest centreline point by true distance (curled seahorse tails have many perpendicular feet)
      const d = p.distanceToSquared(this.local(si, 0, 0));
      if (d < bd) { bd = d; best = si; }
    }
    let s = best;
    for (let k = 0; k < 3; k++) {
      const step = p.clone().sub(this.local(s, 0, 0)).dot(this.frame(s).T) / this.L;
      s = clamp(s + clamp(step, -0.01, 0.01), 0, 1);
    }
    const y = p.clone().sub(this.local(s, 0, 0)).dot(this.frame(s).N) / this.L;
    let phi = this.phiAtY(s, y);
    if (p.z < 0) phi = 2 * Math.PI - phi;
    return { s, phi };
  }

  /** object-space hinge position */
  hingeXY() {
    const p = this.local(this.hinge.s, this.hinge.y, 0);
    return new THREE.Vector2(p.x, p.y);
  }
}
