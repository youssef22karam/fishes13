import * as THREE from 'three';

/** Uniforms shared by every material of one fish (animation state). */
export interface FishUniforms {
  uTime: { value: number };
  uFinT: { value: number };
  uFinAct: { value: number };
  uGape: { value: number };
  uMaxGape: { value: number };
  uProtrude: { value: number };
  uGular: { value: number };
  uFwd: { value: THREE.Vector2 };
  uHinge: { value: THREE.Vector2 };
  uAmp: { value: number };
  uWave: { value: number };
  uFreq: { value: number };
  uA0: { value: number };
  uPow: { value: number };
  uL: { value: number };
  uX0: { value: number };
  uFlap: { value: number };
  uFlapF: { value: number };
  uFinWave: { value: number };
  uWing: { value: number };
  uWingF: { value: number };
  uSpan: { value: number };
  uGazeR: { value: THREE.Vector3 };
  uGazeL: { value: THREE.Vector3 };
  uPupil: { value: number };
}

export function makeUniforms(): FishUniforms {
  return {
    uTime: { value: 0 },
    uFinT: { value: 0 },
    uFinAct: { value: 1 },
    uGape: { value: 0 },
    uMaxGape: { value: 0.5 },
    uProtrude: { value: 0 },
    uGular: { value: 0 },
    uFwd: { value: new THREE.Vector2(1, 0) },
    uHinge: { value: new THREE.Vector2() },
    uAmp: { value: 0 },
    uWave: { value: 7 },
    uFreq: { value: 6 },
    uA0: { value: 0.15 },
    uPow: { value: 2 },
    uL: { value: 2 },
    uX0: { value: 1 },
    uFlap: { value: 0 },
    uFlapF: { value: 4 },
    uFinWave: { value: 0 },
    uWing: { value: 0 },
    uWingF: { value: 1.5 },
    uSpan: { value: 1 },
    uGazeR: { value: new THREE.Vector3(0.25, 0, 0.97).normalize() },
    uGazeL: { value: new THREE.Vector3(0.25, 0, 0.97).normalize() },
    uPupil: { value: 0 },
  };
}

/** Articulation of one fin (per-material uniforms). kind: 1 median ribbon, 2 paired ball-joint, 3 caudal */
export interface Joint {
  kind: number;
  pivot?: THREE.Vector3;
  axis?: THREE.Vector3; // rowing axis (fin base line)
  axis2?: THREE.Vector3; // feathering axis (leading ray / span)
  amp?: number;
  amp2?: number;
  freq?: number;
  phase?: number;
}

const VERT_HEAD = /* glsl */ `
attribute float aJaw;
attribute float aFlap;
attribute float aSide;
attribute vec4 aPlastic;
attribute vec4 aFin;
attribute vec4 aEye;
attribute vec4 aAnc;   // xyz: anchor point on the skin, w: anchor jaw weight
attribute vec4 aAncPl; // plasticity weights at the anchor
attribute float aAncW; // 0 = own deformation … 1 = rigidly follows the anchor
uniform float uTime, uFinT, uFinAct, uGape, uMaxGape, uProtrude, uGular, uAmp, uWave, uFreq, uA0, uPow, uL, uX0, uFlap, uFlapF, uFinWave, uWing, uWingF, uSpan;
uniform vec2 uHinge, uFwd;
uniform vec3 jP, jA, jB;
uniform float jKind, jAmp, jAmp2, jFreq, jPh;
varying vec2 vFin;
varying float vJaw;
varying vec4 vEye;
vec3 fishRot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
// lower-jaw rotation about the quadrate hinge + fleshy head plasticity (shared by skin, lips, eyes)
vec3 fishSoft(vec3 p, float jw, vec4 pl, inout vec3 nrm, float openF) {
  if (jw > 0.0) {
    float ja = -uGape * jw;
    float ca = cos(ja), sa = sin(ja);
    vec2 d = p.xy - uHinge;
    p.xy = uHinge + vec2(ca*d.x - sa*d.y, sa*d.x + ca*d.y);
    nrm.xy = vec2(ca*nrm.x - sa*nrm.y, sa*nrm.x + ca*nrm.y);
  }
  if (openF > 0.001) {
    vec2 dUp = vec2(-uFwd.y, uFwd.x);
    if (pl.x > 0.0) p.xy += (uFwd - dUp * 0.24) * (openF * uProtrude * pl.x * uL);
    if (pl.y > 0.0) p.z += (p.z >= 0.0 ? 1.0 : -1.0) * openF * uGular * 0.58 * pl.y * uL;
    if (pl.z > 0.0) p.xy -= dUp * (openF * uGular * pl.z * uL);
    if (pl.w > 0.0) {
      p.z *= 1.0 - 0.13 * openF * pl.w;
      p.xy += uFwd * (0.007 * openF * pl.w * uL);
    }
  }
  return p;
}
`;

const VERT_DEFORM = /* glsl */ `
vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif
vec3 fishP = position;
vFin = aFin.yz;
vJaw = aJaw;
vEye = aEye;
float openF = clamp(uGape / max(uMaxGape, 0.05), 0.0, 1.25);

// 1+2. lower jaw rotation and fleshy head plasticity. Anchored parts (eyeballs, corneas, orbit rims)
// translate exactly with the skin at their anchor, so the eyes ride on the cheek when the head
// inflates instead of sinking into it.
if (aAncW > 0.0) {
  vec3 nA = vec3(0.0, 1.0, 0.0);
  vec3 own = fishSoft(fishP, aJaw, aPlastic, objectNormal, openF);
  vec3 anc = fishSoft(aAnc.xyz, aAnc.w, aAncPl, nA, openF) - aAnc.xyz;
  fishP = mix(own, fishP + anc, aAncW);
} else {
  fishP = fishSoft(fishP, aJaw, aPlastic, objectNormal, openF);
}
// 3. articulated fins – joints keep the fleshy root welded to the body while the rays move
if (aFin.x > 0.0 && jKind > 0.5) {
  float w = aFin.x * uFinAct;
  float fu = aFin.y, fv = aFin.z;
  if (jKind < 1.5) {
    float ph = uFinT * jFreq + jPh - (uX0 - fishP.x) / uL * 11.0;
    fishP.z += jAmp * uL * w * sin(ph);
  } else if (jKind < 2.5) {
    vec3 P = jP, A = jA, B = jB;
    if (aSide < 0.0) { P.z = -P.z; A = vec3(-A.x, -A.y, A.z); B = vec3(-B.x, -B.y, B.z); }
    float ph = uFinT * jFreq + jPh - 1.3 * fu - 1.0 * fv;
    float row = jAmp * w * sin(ph);
    float fea = jAmp2 * w * fv * cos(ph);
    vec3 d = fishRot(fishRot(fishP - P, B, fea), A, row);
    fishP = P + d;
    objectNormal = fishRot(fishRot(objectNormal, B, fea), A, row);
  } else {
    float ph = uWave - uTime * uFreq;
    float lobe = pow(abs(fu - 0.5) * 2.0, 2.0);
    fishP.z += jAmp * uL * w * (lobe * sin(ph + 1.0) - 0.45 * sin(ph - 1.4 * fv));
    fishP.y = jP.y + (fishP.y - jP.y) * (1.0 + 0.035 * w * sin(2.0 * ph));
  }
}
// 4. flexible appendages without joints (barbels, fronds, finlets)
if (aFlap > 0.0 && aFin.w < 0.5) {
  float pf = uFinT*uFlapF - aFlap*2.35;
  float flex = pow(aFlap, 1.35);
  fishP.z += aSide * flex * uFlap * uL * sin(pf);
  fishP.y += abs(aSide) * flex * uFlap * uL * 0.42 * cos(pf);
  fishP.z += (1.0-abs(aSide)) * flex * uFinWave * uL * sin(uFinT*7.0 + fishP.x*14.0/uL);
}
// 5. batoid wings
if (uWing > 0.0) {
  float az = clamp(abs(fishP.z)/uSpan, 0.0, 1.0);
  float sw = (uX0 - fishP.x)/uL;
  float wp = uTime*uWingF - sw*3.5;
  fishP.y += uWing * pow(az, 1.7) * sin(wp) * uSpan;
  float dy = uWing * 1.7 * pow(max(az,1e-3), 0.7) * sin(wp);
  objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z - dy*sign(fishP.z)*objectNormal.y));
}
// 6. axial undulation – travelling wave continued through the caudal fin rays
{
  float sRaw = (uX0 - fishP.x)/uL;
  float s = clamp(sRaw, 0.0, 1.0);
  float ext = clamp(sRaw - 1.0, 0.0, 1.2);
  float A = uAmp * (uA0 + (1.0-uA0)*pow(s, uPow));
  float dA = uAmp*(1.0-uA0)*uPow*pow(max(s,1e-3), uPow-1.0);
  A += dA * ext * 0.55;
  float ph = uWave*(s + ext) - uTime*uFreq;
  fishP.z += A*sin(ph)*uL;
  float slope = (ext > 0.0 ? dA * 0.55 : dA) * sin(ph) + A*uWave*cos(ph);
  float th = atan(-slope);
  float c = cos(th), sn = sin(th);
  objectNormal.xz = vec2(c*objectNormal.x - sn*objectNormal.z, sn*objectNormal.x + c*objectNormal.z);
}
`;

export interface FinLook {
  rays: number;
  incise: number;
  membrane: number;
  base: THREE.Color;
  mid: THREE.Color;
  tip: THREE.Color;
  edge: THREE.Color;
  edgeW: number;
  spots: number;
  spotCol: THREE.Color;
  pattern: number; // 0 none 1 spots 2 leopard 3 bands 4 reticulate 5 rayspots
  fray: number;
  root: number; // v-extent of the body-skin blend at the fin base
}

export interface EyeLook {
  iris: THREE.Color;
  iris2: THREE.Color;
  pupil: THREE.Color;
  globe: THREE.Color;
}

const FRAG_HEAD = /* glsl */ `
varying vec2 vFin;
varying float vJaw;
varying vec4 vEye;
uniform float fRays, fIncise, fMembrane, fEdgeW, fSpots, fIsFin, fFray, fPattern, fRoot, fIsEye;
uniform vec3 fBase, fTip, fMid, fEdge, fSpotCol;
uniform vec3 eIris, eIris2, ePupil, eGlobe;
uniform vec3 uGazeR, uGazeL;
uniform float uPupil;
float fHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float fNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(fHash(i), fHash(i+vec2(1.0,0.0)), f.x), mix(fHash(i+vec2(0.0,1.0)), fHash(i+vec2(1.0,1.0)), f.x), f.y); }
`;

const FRAG_MAIN = /* glsl */ `
float eyeMetal = -1.0, eyeRough = -1.0;
vec3 finGlow = vec3(0.0);
if (fIsFin > 0.5) {
  float u = vFin.x;
  float v = clamp(vFin.y, 0.0, 1.0);
  vec3 skin = diffuseColor.rgb;
  vec3 col = v < 0.5 ? mix(fBase, fMid, smoothstep(0.0, 0.5, v)) : mix(fMid, fTip, smoothstep(0.5, 1.0, v));
  float rx = u * fRays;
  float rid = floor(rx);
  float ray = 0.0;
  if (fRays > 0.5) {
    float rd = abs(fract(rx) - 0.5) * 2.0;
    float ray1 = smoothstep(0.64, 0.95, rd);
    float br = abs(fract(rx * 2.0 + 0.25) - 0.5) * 2.0;
    float ray2 = smoothstep(0.7, 0.96, br) * smoothstep(0.45, 0.75, v) * (1.0 - step(0.45, fIncise));
    ray = max(ray1 * (1.0 - 0.3 * smoothstep(0.55, 0.9, v)), ray2 * 0.75);
    float joints = 0.88 + 0.12 * smoothstep(0.2, 0.8, abs(sin(v * 46.0 + fHash(vec2(rid, 3.0)) * 6.0)));
    if (fPattern > 0.5) {
      float pat = 0.0;
      if (fPattern < 2.5) {
        vec2 g = vec2(u * fSpots * 2.2, v * fSpots);
        vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float h = fHash(id);
        vec2 o = (vec2(fHash(id + 3.1), fHash(id + 7.7)) - 0.5) * 0.55;
        float dd = length(f + o);
        float rr = 0.15 + 0.17 * h;
        pat = (1.0 - smoothstep(rr - 0.05, rr + 0.03, dd)) * step(0.28, h);
        if (fPattern > 1.5) pat *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, rr * 0.45, dd));
      } else if (fPattern < 3.5) {
        pat = smoothstep(0.3, 0.42, abs(fract(v * fSpots + 0.25) - 0.5));
      } else if (fPattern < 4.5) {
        vec2 g = vec2(u * fSpots * 2.0, v * fSpots);
        vec2 id = floor(g); vec2 f = fract(g);
        float f1 = 9.0, f2 = 9.0;
        for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
          vec2 o = vec2(float(xx), float(yy));
          float dd = length(o + vec2(fHash(id + o), fHash(id + o + 5.3)) * 0.85 - f);
          if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
        }
        pat = 1.0 - smoothstep(0.04, 0.12, f2 - f1);
      } else {
        float along = fract(v * fSpots + fHash(vec2(rid, 1.0)));
        pat = (1.0 - smoothstep(0.16, 0.3, abs(along - 0.5))) * smoothstep(0.3, 0.8, rd);
      }
      col = mix(col, fSpotCol, clamp(pat, 0.0, 1.0) * 0.92);
    }
    col = mix(col, col * 0.6 * joints, ray * 0.45);
    float jag = fHash(vec2(rid, 11.0));
    float jag2 = fHash(vec2(rid, 23.0));
    float effInc = max(fIncise, 0.03 + fFray * 0.08);
    float notch = effInc * (1.0 - ray1 * 0.9) * (0.6 + 0.8 * jag2) + fFray * 0.14 * jag * jag;
    if (v > 1.0 - notch * (0.45 + 0.55 * abs(sin(rx * 3.14159)))) discard;
  } else {
    col *= 0.96 + 0.04 * sin(u * 95.0 + v * 12.0) * smoothstep(0.35, 1.0, v);
  }
  float edgeM = smoothstep(1.0 - fEdgeW, 1.0 - fEdgeW * 0.35, v) * step(0.001, fEdgeW);
  col = mix(col, fEdge, edgeM);
  float root = fRoot > 0.001 ? 1.0 - smoothstep(0.0, fRoot, v) : 0.0;
  col = mix(col, skin, root);
  diffuseColor.rgb = col;
  float a = fRays > 0.5 ? mix(fMembrane, min(1.0, fMembrane + 0.4), ray * 0.9) : fMembrane;
  a = mix(a, 1.0, max(root, (1.0 - smoothstep(0.0, 0.1, v)) * 0.6));
  a = mix(a, 1.0, edgeM * 0.6);
  if (fRays > 0.5) a *= 1.0 - smoothstep(0.95, 1.0, v) * 0.35;
  a = clamp(a, 0.0, 1.0);
  if (a < 0.999) a = 1.0 - sqrt(1.0 - a); // two-layer membrane
  diffuseColor.a *= a;
  finGlow = col * 0.14 * (1.0 - a);
}
if (fIsEye > 0.5 && abs(vEye.w) > 0.5) {
  vec3 d = normalize(vEye.xyz);
  vec3 g = vEye.w > 0.0 ? uGazeR : uGazeL;
  float ang = acos(clamp(dot(d, g), -1.0, 1.0));
  vec3 ref = abs(g.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 ax = normalize(cross(ref, g)); vec3 ay = cross(g, ax);
  float az = atan(dot(d, ay), dot(d, ax));
  // teleost eye: the iris fills the whole exposed globe (no sclera), the round pupil is large and the
  // spherical lens bulges through it; many teleosts show an anterior aphakic gap (pupil drawn forward).
  vec3 off = d - g * dot(d, g);
  float fw = dot(off, vec3(1.0, 0.0, 0.0)) / max(length(off), 1e-4);
  float rp = mix(0.4, 0.53, uPupil) * (1.0 + 0.17 * smoothstep(0.25, 1.0, fw));
  float ri = 1.35;
  float t = clamp((ang - rp) / (ri - rp), 0.0, 1.0);
  float fib = fNoise(vec2(az * 13.0, t * 3.0)) * 0.5 + fNoise(vec2(az * 41.0, t * 8.0)) * 0.32 + fNoise(vec2(az * 97.0, t * 15.0)) * 0.18;
  float crypt = smoothstep(0.58, 0.86, fNoise(vec2(az * 6.0 + 3.1, t * 4.0)));
  vec3 iris = mix(eIris2, eIris, smoothstep(0.02, 0.26, t));
  iris *= 0.6 + 0.65 * fib;
  iris = mix(iris, iris * 0.5, crypt * 0.4);
  iris += eIris2 * 0.22 * exp(-pow((t - 0.17) / 0.045, 2.0)); // collarette
  float fleck = step(0.83, fHash(floor(vec2(az * 36.0, t * 16.0))));
  iris = mix(iris, eIris2 * 1.2 + 0.05, fleck * 0.3 * (1.0 - smoothstep(0.3, 0.9, t)));
  iris *= 1.0 - 0.22 * smoothstep(0.35, 0.95, abs(d.y)); // dorsal / ventral pigment shading
  // limbus: darkening toward the socket edge (socket space, independent of the gaze)
  float ce = abs(vEye.w) - 1.0;
  float lim = smoothstep(ce + 0.2, ce - 0.01, vEye.z);
  iris = mix(iris, eGlobe, lim * 0.82);
  // pupillary margin: thin bright ring, then the black lens
  float pe = smoothstep(rp - 0.01, rp + 0.022, ang);
  iris = mix(iris, eIris2 * 1.15, 0.45 * exp(-pow((ang - rp - 0.03) / 0.022, 2.0)));
  diffuseColor.rgb = mix(ePupil, iris, pe);
  eyeMetal = mix(0.0, 0.5, pe) * (1.0 - lim * 0.7);
  eyeRough = mix(0.03, 0.36, pe);
}
`;

const black = new THREE.Color(0, 0, 0);

/** Patch a standard/physical material with the fish deformation pipeline */
export function patchMaterial(mat: THREE.Material, u: FishUniforms, fin?: FinLook, opt: { joint?: Joint; eye?: EyeLook } = {}) {
  const j = opt.joint, e = opt.eye;
  const fu = {
    fRays: { value: fin?.rays ?? 0 },
    fIncise: { value: fin?.incise ?? 0 },
    fMembrane: { value: fin?.membrane ?? 1 },
    fEdgeW: { value: fin?.edgeW ?? 0 },
    fSpots: { value: fin?.spots ?? 0 },
    fFray: { value: fin?.fray ?? 0 },
    fPattern: { value: fin?.pattern ?? 0 },
    fRoot: { value: fin?.root ?? 0 },
    fIsFin: { value: fin ? 1 : 0 },
    fIsEye: { value: e ? 1 : 0 },
    fBase: { value: fin?.base ?? black },
    fMid: { value: fin?.mid ?? black },
    fTip: { value: fin?.tip ?? black },
    fEdge: { value: fin?.edge ?? e?.globe ?? black },
    fSpotCol: { value: fin?.spotCol ?? black },
    eIris: { value: e?.iris ?? black },
    eIris2: { value: e?.iris2 ?? black },
    ePupil: { value: e?.pupil ?? black },
    eGlobe: { value: e?.globe ?? black },
    jKind: { value: j?.kind ?? 0 },
    jP: { value: j?.pivot ?? new THREE.Vector3() },
    jA: { value: (j?.axis ?? new THREE.Vector3(0, 1, 0)).clone().normalize() },
    jB: { value: (j?.axis2 ?? new THREE.Vector3(1, 0, 0)).clone().normalize() },
    jAmp: { value: j?.amp ?? 0 },
    jAmp2: { value: j?.amp2 ?? 0 },
    jFreq: { value: j?.freq ?? 5 },
    jPh: { value: j?.phase ?? 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, fu);
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', VERT_DEFORM)
      .replace('#include <begin_vertex>', 'vec3 transformed = fishP;');
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n' + FRAG_MAIN)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (eyeMetal >= 0.0) { metalnessFactor = eyeMetal; roughnessFactor = eyeRough; }')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += finGlow;');
  };
  mat.customProgramCacheKey = () => 'fish-v6';
  return mat;
}

/** make sure a geometry carries the custom attributes */
export function ensureAttrs(g: THREE.BufferGeometry, jaw = 0, flap = 0, side = 0) {
  const n = g.getAttribute('position').count;
  if (!g.getAttribute('aJaw')) g.setAttribute('aJaw', new THREE.BufferAttribute(new Float32Array(n).fill(jaw), 1));
  if (!g.getAttribute('aFlap')) g.setAttribute('aFlap', new THREE.BufferAttribute(new Float32Array(n).fill(flap), 1));
  if (!g.getAttribute('aSide')) g.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(n).fill(side), 1));
  if (!g.getAttribute('aPlastic')) g.setAttribute('aPlastic', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  if (!g.getAttribute('aFin')) g.setAttribute('aFin', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  if (!g.getAttribute('aEye')) g.setAttribute('aEye', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  if (!g.getAttribute('aAnc')) g.setAttribute('aAnc', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  if (!g.getAttribute('aAncPl')) g.setAttribute('aAncPl', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  if (!g.getAttribute('aAncW')) g.setAttribute('aAncW', new THREE.BufferAttribute(new Float32Array(n), 1));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
