import * as THREE from 'three';
import type { BodyModel } from './model';
import type { Layer } from './types';
import { rng, smooth } from './math';

const TW = 2048, TH = 1024;

/**
 * Texture space: u = s (snout→tail), v = φ / 2π.
 * Patterns are authored in (s, h) with h = φ/π: 0 dorsal midline, 0.5 lateral
 * midline, 1 ventral midline – and mirrored onto both flanks.
 */
export function paintSkin(model: BodyModel, seed: number) {
  const sp = model.sp;
  const c = sp.color;
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const g = cv.getContext('2d')!;
  const R = rng(seed);

  // base countershading
  const [a, b] = c.cs ?? [0.3, 0.68];
  const grad = g.createLinearGradient(0, 0, 0, TH / 2);
  grad.addColorStop(0, c.top);
  grad.addColorStop(Math.max(0.01, a * 0.7), c.top);
  grad.addColorStop(Math.min(0.98, (a + b) / 2), c.side);
  grad.addColorStop(Math.min(0.99, b * 1.05), c.belly);
  grad.addColorStop(1, c.belly);
  g.fillStyle = grad;
  g.fillRect(0, 0, TW, TH / 2);
  g.save();
  g.translate(0, TH);
  g.scale(1, -1);
  g.fillRect(0, 0, TW, TH / 2);
  g.restore();

  /** run fn twice, in unit (s,h) space for right and left flank */
  const both = (fn: () => void) => {
    g.save(); g.setTransform(TW, 0, 0, TH / 2, 0, 0); fn(); g.restore();
    g.save(); g.setTransform(TW, 0, 0, -TH / 2, 0, TH); fn(); g.restore();
  };
  /** isotropic ellipse: radius r in SL units at (s,h) */
  const dot = (s: number, h: number, r: number) => {
    const rh = r / model.halfPerim(Math.min(0.999, Math.max(0.001, s)));
    g.beginPath();
    g.ellipse(s, h, r, Math.min(rh, 0.5), 0, 0, Math.PI * 2);
  };
  const hp = (s: number) => model.halfPerim(Math.min(0.999, Math.max(0.002, s)));

  for (const L of (c.layers ?? []) as Layer[]) {
    switch (L.k) {
      case 'grad': {
        // one vertical soft band masked by a horizontal soft window (no strip banding)
        const col = new THREE.Color(L.c);
        const rgb = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
        const soft = L.soft ?? 0.04;
        const tmp = document.createElement('canvas');
        tmp.width = TW; tmp.height = TH / 2;
        const tg = tmp.getContext('2d')!;
        const win = (a0: number, a1: number, px: number, horizontal: boolean, c: string) => {
          const span = a1 - a0 + 2 * soft;
          const gr = horizontal ? tg.createLinearGradient((a0 - soft) * px, 0, (a1 + soft) * px, 0) : tg.createLinearGradient(0, (a0 - soft) * px, 0, (a1 + soft) * px);
          gr.addColorStop(0, `rgba(${c},0)`);
          gr.addColorStop(Math.min(0.49, soft / span), `rgba(${c},1)`);
          gr.addColorStop(Math.max(0.51, 1 - soft / span), `rgba(${c},1)`);
          gr.addColorStop(1, `rgba(${c},0)`);
          tg.fillStyle = gr;
          tg.fillRect(0, 0, TW, TH / 2);
        };
        win(L.h0, L.h1, TH / 2, false, rgb);
        tg.globalCompositeOperation = 'destination-in';
        win(L.s0, L.s1, TW, true, '0,0,0');
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = L.a ?? 1;
        g.drawImage(tmp, 0, 0);
        g.translate(0, TH); g.scale(1, -1);
        g.drawImage(tmp, 0, 0);
        g.restore();
        break;
      }
      case 'bars': {
        both(() => {
          const h0 = L.h0 ?? 0, h1 = L.h1 ?? 1;
          for (const at of L.at) {
            const draw = (w: number, col: string) => {
              g.fillStyle = col;
              g.beginPath();
              const N = 30;
              for (let i = 0; i <= N; i++) {
                const h = h0 + (h1 - h0) * (i / N);
                const off = (L.wob ?? 0) * Math.sin(h * 9 + at * 40) + (L.slant ?? 0) * (h - 0.5);
                const ww = w * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, (h - h0) / (h1 - h0) * 1.0 + 0.0001)) ** 0.3);
                g.lineTo(at + off - ww / 2, h);
              }
              for (let i = N; i >= 0; i--) {
                const h = h0 + (h1 - h0) * (i / N);
                const off = (L.wob ?? 0) * Math.sin(h * 9 + at * 40) + (L.slant ?? 0) * (h - 0.5);
                const ww = w * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, (h - h0) / (h1 - h0) + 0.0001)) ** 0.3);
                g.lineTo(at + off + ww / 2, h);
              }
              g.closePath();
              g.fill();
            };
            if (L.edge) draw(L.w + (L.ew ?? 0.012) * 2, L.edge);
            draw(L.w, L.c);
          }
        });
        break;
      }
      case 'stripe': {
        both(() => {
          const s0 = L.s0 ?? 0, s1 = L.s1 ?? 1;
          g.fillStyle = L.c;
          if (L.glow) { g.shadowColor = L.c; g.shadowBlur = 6; }
          g.beginPath();
          const N = 80;
          for (let i = 0; i <= N; i++) {
            const s = s0 + (s1 - s0) * (i / N);
            const tp = 1 - (L.taper ?? 0) * (i / N);
            const w = (L.w * tp) / hp(s) * 0.5;
            g.lineTo(s, L.h + (L.wob ?? 0) * Math.sin(s * 30) - w / 2);
          }
          for (let i = N; i >= 0; i--) {
            const s = s0 + (s1 - s0) * (i / N);
            const tp = 1 - (L.taper ?? 0) * (i / N);
            const w = (L.w * tp) / hp(s) * 0.5;
            g.lineTo(s, L.h + (L.wob ?? 0) * Math.sin(s * 30) + w / 2);
          }
          g.fill();
          g.shadowBlur = 0;
        });
        break;
      }
      case 'spots':
      case 'blotch': {
        const r2 = rng(seed + (L.seed ?? 0) + L.n);
        const pts: [number, number, number][] = [];
        for (let i = 0; i < L.n; i++) {
          const s = (L.s0 ?? 0.02) + r2() * ((L.s1 ?? 0.99) - (L.s0 ?? 0.02));
          const h = (L.h0 ?? 0) + r2() * ((L.h1 ?? 1) - (L.h0 ?? 0));
          const rv = L.k === 'spots' ? (L.rv ?? 0.4) : 0.6;
          pts.push([s, h, L.r * (1 - rv / 2 + r2() * rv)]);
        }
        both(() => {
          for (const [s, h, r] of pts) {
            if (L.k === 'blotch') {
              g.fillStyle = L.c;
              const rr = rng(Math.floor(s * 1e5 + h * 1e3));
              for (let j = 0; j < 7; j++) {
                dot(s + (rr() - 0.5) * r * 1.4, h + (rr() - 0.5) * (r / hp(s)) * 1.4, r * (0.45 + rr() * 0.5));
                g.fill();
              }
            } else {
              if (L.k === 'spots' && L.ring) { g.fillStyle = L.ring; dot(s, h, r * 1.45); g.fill(); }
              g.fillStyle = L.c;
              dot(s, h, r); g.fill();
            }
          }
        });
        break;
      }
      case 'reticulate': {
        // snakeskin / mosaic net: irregular cell outlines, drawn in pixel space for even stroke width
        const r2 = rng(seed + (L.seed ?? 0) + 913);
        const s0 = L.s0 ?? 0.2, s1 = L.s1 ?? 0.98, h0 = L.h0 ?? 0.08, h1 = L.h1 ?? 0.8;
        const ds = (s1 - s0) / L.n;
        const cells: [number, number][] = [];
        for (let sc = s0 + ds / 2; sc < s1; sc += ds) {
          const dh = ds / hp(sc);
          for (let hc = h0 + dh / 2; hc < h1; hc += dh) cells.push([sc + (r2() - 0.5) * ds * 0.45, hc + (r2() - 0.5) * dh * 0.45]);
        }
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.strokeStyle = L.c;
        g.lineWidth = Math.max(1, (L.w ?? 0.003) * TW * 0.7);
        g.lineJoin = 'round';
        for (const flip of [false, true]) {
          for (const [sc, hc] of cells) {
            const rr = rng(Math.floor(sc * 1e5 + hc * 1e4));
            g.globalAlpha = smooth(s0, s0 + 0.05, sc) * (1 - smooth(s1 - 0.05, s1, sc)) * smooth(h0, h0 + 0.06, hc) * (1 - smooth(h1 - 0.12, h1, hc));
            g.beginPath();
            const K = 7, a0 = rr() * 6.28;
            for (let k = 0; k <= K; k++) {
              const a = a0 + (k / K) * Math.PI * 2;
              const rad = ds * (0.4 + rr() * 0.16);
              const x = (sc + Math.cos(a) * rad) * TW;
              const yy = (hc + (Math.sin(a) * rad) / hp(sc)) * (TH / 2);
              const y = flip ? TH - yy : yy;
              if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.stroke();
          }
        }
        g.restore();
        break;
      }
      case 'scaleFill': {
        // a pigment spot in the centre of every scale (parrotfishes, some wrasses)
        const n = Math.max(8, sp.skin.scales);
        const avg = [0.15, 0.3, 0.5, 0.7, 0.85].reduce((acc, q) => acc + model.halfPerim(q), 0) / 5;
        const rows = Math.max(6, Math.round(n * avg));
        const dx = 1 / n, dh = 1 / rows, rr = L.r ?? 0.34;
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = L.c;
        g.globalAlpha = L.a ?? 0.85;
        for (const flip of [false, true]) {
          for (let i = Math.floor(n * Math.max(L.s0 ?? 0, sp.HL * 0.9)); i < n; i++) {
            for (let j = 0; j < rows; j++) {
              const sc = (i + 0.5 + (j % 2) * 0.5) * dx, hc = (j + 0.5) * dh;
              if (hc < (L.h0 ?? 0.04) || hc > (L.h1 ?? 0.9) || sc > 0.995) continue;
              const yy = hc * (TH / 2);
              g.beginPath();
              g.ellipse((sc - dx * 0.08) * TW, flip ? TH - yy : yy, dx * rr * TW, dh * rr * 1.1 * (TH / 2), 0, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
        g.restore();
        break;
      }
      case 'waves': {
        if (L.vertical) {
          both(() => {
            g.strokeStyle = L.c;
            g.lineWidth = L.w * 0.25;
            const h0 = L.h0 ?? 0.04, h1 = L.h1 ?? 0.96, s0 = L.s0 ?? 0, s1 = L.s1 ?? 1;
            for (let i = 0; i < L.n; i++) {
              const sb = s0 + (s1 - s0) * ((i + 0.5) / L.n);
              g.beginPath();
              for (let k = 0; k <= 80; k++) {
                const h = h0 + (h1 - h0) * (k / 80);
                const sx = sb + L.amp * 0.02 * Math.sin(h * L.freq + i * 1.7) + (L.slant ?? 0) * (h - 0.5);
                if (k === 0) g.moveTo(sx, h); else g.lineTo(sx, h);
              }
              g.stroke();
            }
          });
          break;
        }
        both(() => {
          g.strokeStyle = L.c;
          const h0 = L.h0 ?? 0.02, h1 = L.h1 ?? 0.98;
          for (let i = 0; i < L.n; i++) {
            const hb = h0 + (h1 - h0) * ((i + 0.5) / L.n);
            g.beginPath();
            const s0 = L.s0 ?? 0, s1 = L.s1 ?? 1;
            for (let k = 0; k <= 120; k++) {
              const s = s0 + (s1 - s0) * (k / 120);
              const h = hb + L.amp * Math.sin(s * L.freq + i * 1.7) / hp(s) * 0.1 + (L.slant ?? 0) * (s - 0.5);
              g.lineWidth = L.w / hp(s) * 0.5;
              if (k === 0) g.moveTo(s, h); else g.lineTo(s, h);
            }
            g.stroke();
          }
        });
        break;
      }
      case 'gills': {
        both(() => {
          g.strokeStyle = L.c;
          for (const at of L.at) {
            g.lineWidth = 0.0025;
            g.beginPath();
            g.moveTo(at, L.h0 ?? 0.38);
            g.quadraticCurveTo(at - 0.006, ((L.h0 ?? 0.38) + (L.h1 ?? 0.72)) / 2, at + 0.002, L.h1 ?? 0.72);
            g.stroke();
          }
        });
        break;
      }
      case 'lateral': {
        both(() => {
          g.strokeStyle = L.c;
          g.lineWidth = (L.w ?? 0.006) / 1.2;
          g.beginPath();
          for (let k = 0; k <= 100; k++) {
            const s = sp.HL * 0.9 + (1 - sp.HL * 0.9) * (k / 100);
            const h = (L.h ?? 0.32) + 0.12 * Math.pow(k / 100, 1.3);
            if (k === 0) g.moveTo(s, h); else g.lineTo(s, h);
          }
          g.stroke();
        });
        break;
      }
      case 'photo': {
        both(() => {
          g.fillStyle = L.c;
          g.shadowColor = L.c; g.shadowBlur = 8;
          for (let i = 0; i < L.n; i++) {
            const s = (L.s0 ?? 0.15) + ((L.s1 ?? 0.9) - (L.s0 ?? 0.15)) * (i / Math.max(1, L.n - 1));
            dot(s, L.h, L.r ?? 0.006); g.fill();
          }
          g.shadowBlur = 0;
        });
        break;
      }
      case 'scaleEdge':
        break;
    }
  }

  // operculum (gill cover) margin: posteriorly convex like a real opercle, soft shadow + faint edge
  // (the raised geometry in the body model does most of the work, so the paint stays subtle)
  const opS = (h: number) => sp.HL + 0.014 * Math.sin(Math.PI * Math.min(1, Math.max(0, (h - 0.2) / 0.66))) - 0.05 * (h - 0.55) * (h - 0.55);
  if (sp.skin.kind !== 'placoid' && sp.plan !== 'ray' && sp.HL > 0.05 && sp.mouth.kind !== 'disc') {
    both(() => {
      g.strokeStyle = 'rgba(0,0,0,0.05)';
      g.lineWidth = 0.01;
      g.beginPath();
      for (let k = 0; k <= 40; k++) {
        const h = 0.22 + 0.64 * (k / 40);
        if (k === 0) g.moveTo(opS(h) + 0.005, h); else g.lineTo(opS(h) + 0.005, h);
      }
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.09)';
      g.lineWidth = 0.0016;
      g.beginPath();
      for (let k = 0; k <= 40; k++) {
        const h = 0.22 + 0.64 * (k / 40);
        if (k === 0) g.moveTo(opS(h), h); else g.lineTo(opS(h), h);
      }
      g.stroke();
      // preopercle groove: a fine curved line from below the eye sweeping down to the jaw angle
      const e = sp.eye;
      if (e.d > 0) {
        const s0 = Math.max(e.s + e.d * 0.9, sp.HL * 0.62);
        g.strokeStyle = 'rgba(0,0,0,0.06)';
        g.lineWidth = 0.0014;
        g.beginPath();
        for (let k = 0; k <= 30; k++) {
          const t = k / 30;
          const h = 0.42 + 0.4 * t;
          const ss = s0 + (sp.HL * 0.8 - s0) * 0.15 * Math.sin(Math.PI * t * 0.5) - 0.025 * t * t;
          if (k === 0) g.moveTo(ss, h); else g.lineTo(ss, h);
        }
        g.stroke();
      }
    });
  }

  // nares (paired nostrils) in front of the eye – small dark pits with a pale rim
  if (sp.eye.d > 0 && sp.plan !== 'ray' && sp.skin.kind !== 'placoid') {
    const e = sp.eye;
    const ys = model.normY(e.s, e.y);
    const hE = model.phiAtY(Math.max(0.002, e.s), ys) / Math.PI;
    for (const [ds, dh, rr] of [[0.95, -0.025, 0.075], [0.64, -0.035, 0.06]] as const) {
      const sn = e.s - e.d * ds;
      if (sn < 0.008) continue;
      both(() => {
        g.fillStyle = 'rgba(255,255,255,0.12)';
        dot(sn, hE + dh, e.d * rr * 1.5); g.fill();
        g.fillStyle = 'rgba(8,8,10,0.5)';
        dot(sn, hE + dh, e.d * rr); g.fill();
      });
    }
  }

  // fine noise / mottling for realism
  const img = g.getImageData(0, 0, TW, TH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * 10;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // scale-edge tinting
  const se = c.layers?.find((l) => l.k === 'scaleEdge') as Extract<Layer, { k: 'scaleEdge' }> | undefined;
  if (se && sp.skin.scales > 0) drawScales(g, model, sp.skin.scales, se.c, se.a ?? 0.35, false);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  return { tex, canvas: cv };
}

function drawScales(g: CanvasRenderingContext2D, model: BodyModel, n: number, col: string, alpha: number, bump: boolean, cw = TW, ch = TH) {
  const avgHP = [0.15, 0.3, 0.5, 0.7, 0.85].reduce((a, s) => a + model.halfPerim(s), 0) / 5;
  const rows = Math.max(6, Math.round(n * avgHP));
  const dx = 1 / n, dh = 1 / rows;
  const both = (fn: () => void) => {
    g.save(); g.setTransform(cw, 0, 0, ch / 2, 0, 0); fn(); g.restore();
    g.save(); g.setTransform(cw, 0, 0, -ch / 2, 0, ch); fn(); g.restore();
  };
  both(() => {
    const hl = model.sp.HL;
    for (let i = Math.floor(n * hl * 0.7); i < n; i++) {
      for (let j = 0; j < rows; j++) {
        const s = (i + (j % 2) * 0.5) * dx;
        const h = (j + 0.5) * dh;
        const fade = smooth(hl * 0.7, hl * 1.08, s);
        if (fade <= 0.01) continue;
        if (bump) {
          const gr = g.createRadialGradient(s - dx * 0.25, h, 0, s - dx * 0.25, h, dx * 0.95);
          gr.addColorStop(0, 'rgba(255,255,255,0.9)');
          gr.addColorStop(0.75, 'rgba(160,160,160,0.6)');
          gr.addColorStop(1, 'rgba(60,60,60,0.0)');
          g.fillStyle = gr;
          g.globalAlpha = fade;
          g.beginPath();
          g.ellipse(s, h, dx * 0.85, dh * 0.95, 0, -Math.PI / 2, Math.PI / 2);
          g.fill();
          g.globalAlpha = 1;
        } else {
          g.strokeStyle = col;
          g.globalAlpha = alpha * fade;
          g.lineWidth = Math.max(0.0006, dx * 0.12);
          g.beginPath();
          g.ellipse(s, h, dx * 0.7, dh * 0.62, 0, -Math.PI / 2, Math.PI / 2);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
    }
  });
}

/** grayscale height map: scales / dermal denticles / warts + opercle groove */
export function paintBump(model: BodyModel, seed: number) {
  const sp = model.sp;
  const cv = document.createElement('canvas');
  cv.width = TW / 2; cv.height = TH / 2;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, cv.width, cv.height);
  const R = rng(seed ^ 0x9e3779b9);
  const W = cv.width, H = cv.height;
  const k = sp.skin.kind;
  if ((k === 'cycloid' || k === 'ctenoid' || k === 'ganoid') && sp.skin.scales > 0) {
    drawScales(g, model, sp.skin.scales, '#fff', 1, true, W, H);
  } else if (k === 'warty' || k === 'bony') {
    for (let i = 0; i < (k === 'warty' ? 2600 : 1400); i++) {
      const x = R() * W, y = R() * H, r = 1 + R() * (k === 'warty' ? 6 : 3);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  } else {
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 128 + (R() - 0.5) * (k === 'placoid' ? 40 : 14);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
