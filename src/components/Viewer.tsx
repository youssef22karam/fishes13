import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildFish, type FishBuild } from '../engine/build';
import type { Species } from '../engine/types';
import { DEG } from '../engine/math';

export type ViewName = 'side' | 'front' | 'top' | 'three' | 'below';

interface Props {
  species: Species;
  seed: number;
  gape: number; // 0..1 manual
  autoFeed: boolean;
  swim: boolean;
  speed: number;
  view: ViewName;
  viewNonce: number;
  wire: boolean;
  fins: boolean; // articulated fin motion
  eyes: boolean; // saccadic eye movement
}

export default function Viewer(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    fish?: FishBuild; holder: THREE.Group; props: Props; t: number; feedT: number; shadow: THREE.Mesh;
    ft: number; sac: number; gz: number[]; tg: number[];
  } | null>(null);

  // one-time scene setup
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a1d2b');
    scene.fog = new THREE.FogExp2('#0a1d2b', 0.045);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    camera.position.set(0, 0.2, 6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.HemisphereLight('#bfe6ff', '#1b2b2a', 0.9));
    const key = new THREE.DirectionalLight('#fff4e0', 2.2);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#7fc8ff', 1.4);
    rim.position.set(-4, 2, -5);
    scene.add(rim);
    const under = new THREE.DirectionalLight('#5a8aa0', 0.5);
    under.position.set(0, -5, 2);
    scene.add(under);

    // marine snow
    const N = 900;
    const pts = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pts.set([(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 16], i * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const snow = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#a8d8f0', size: 0.018, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(snow);

    // soft contact shadow / sea floor glow
    const sc = document.createElement('canvas');
    sc.width = sc.height = 256;
    const g = sc.getContext('2d')!;
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    const holder = new THREE.Group();
    scene.add(holder);

    const s: NonNullable<typeof st.current> = { renderer, scene, camera, controls, holder, props: p, t: 0, feedT: 0, shadow, fish: undefined, ft: 0, sac: 0, gz: [0.15, 0, 0.15, 0], tg: [0.15, 0, 0.15, 0] };
    st.current = s;

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let last = performance.now();
    let raf = 0;
    // ?shot=N renders N frames then idles (deterministic stills for documentation / testing)
    const shotN = +(new URLSearchParams(location.search).get('shot') ?? 0);
    let frames = 0;
    const loop = () => {
      if (!shotN || ++frames < shotN) raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const P = s.props;
      const f = s.fish;
      if (P.swim) s.t += dt * P.speed;
      if (f) {
        const u = f.uniforms;
        u.uTime.value = s.t;
        let g = P.gape;
        if (P.autoFeed) {
          s.feedT += dt * P.speed;
          const cyc = s.feedT % 3.2;
          // fast strike, brief hold, slower closing (suction-feeding kinematics)
          const open = cyc < 0.18 ? cyc / 0.18 : cyc < 0.45 ? 1 : cyc < 1.1 ? 1 - (cyc - 0.45) / 0.65 : 0;
          g = Math.max(g, open * open * (3 - 2 * open));
        }
        u.uGape.value = g * f.model.sp.mouth.open * DEG;
        // articulated fins run on their own clock so they keep sculling while hovering
        if (P.fins) s.ft += dt * P.speed;
        u.uFinT.value = s.ft;
        u.uFinAct.value += ((P.fins ? 1 : 0) - u.uFinAct.value) * Math.min(1, dt * 4);
        // eyes: saccades (fast jumps, independent-ish left/right), converge forward on the prey when striking
        if (P.eyes) {
          s.sac -= dt;
          if (s.sac <= 0) {
            s.sac = 0.6 + Math.random() * 2.2;
            const yaw = -0.3 + Math.random() * 0.8, pitch = (Math.random() - 0.5) * 0.45;
            s.tg = [yaw, pitch, yaw + (Math.random() - 0.5) * 0.3, pitch + (Math.random() - 0.5) * 0.12];
          }
        } else s.tg = [0.15, 0, 0.15, 0];
        if (g > 0.25) s.tg = [0.45, -0.06, 0.45, -0.06];
        const kk = 1 - Math.exp(-dt * 18);
        for (let i = 0; i < 4; i++) s.gz[i] += (s.tg[i] - s.gz[i]) * kk;
        u.uGazeR.value.set(Math.sin(s.gz[0]) * Math.cos(s.gz[1]), Math.sin(s.gz[1]), Math.cos(s.gz[0]) * Math.cos(s.gz[1]));
        u.uGazeL.value.set(Math.sin(s.gz[2]) * Math.cos(s.gz[3]), Math.sin(s.gz[3]), Math.cos(s.gz[2]) * Math.cos(s.gz[3]));
        u.uPupil.value += ((g > 0.25 ? 0.55 : 0.12) - u.uPupil.value) * Math.min(1, dt * 3);
        const bob = P.swim ? Math.sin(s.t * 0.8) * 0.03 : 0;
        s.holder.position.y = bob;
      }
      snow.position.y = ((s.t * 0.05) % 1) * -0.5;
      snow.rotation.y += dt * 0.01;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      s.fish?.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep latest props for the loop
  useEffect(() => {
    if (st.current) st.current.props = p;
  });

  // rebuild fish on species / seed change
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    if (s.fish) {
      s.holder.remove(s.fish.group);
      s.fish.dispose();
    }
    const fish = buildFish(p.species, p.seed);
    s.fish = fish;
    s.holder.add(fish.group);
    const r = fish.radius;
    s.shadow.scale.set(r * 2.2, r * 1.2, 1);
    s.shadow.position.y = -r * 0.62 - 0.15;
    frame(s.camera, s.controls, p.view, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.species, p.seed]);

  useEffect(() => {
    const s = st.current;
    if (!s?.fish) return;
    s.fish.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'wireframe' in m) m.wireframe = p.wire;
    });
  }, [p.wire, p.species, p.seed]);

  useEffect(() => {
    const s = st.current;
    if (s?.fish) frame(s.camera, s.controls, p.view, s.fish.radius);
  }, [p.view, p.viewNonce]);

  return <div ref={host} className="absolute inset-0" />;
}

function frame(cam: THREE.PerspectiveCamera, ctl: OrbitControls, view: ViewName, r: number) {
  const d = (r / Math.tan((cam.fov * DEG) / 2)) * 1.05;
  const dirs: Record<ViewName, THREE.Vector3> = {
    side: new THREE.Vector3(0, 0.02, 1),
    front: new THREE.Vector3(1, 0.12, 0.18),
    top: new THREE.Vector3(0.001, 1, 0.02),
    three: new THREE.Vector3(0.75, 0.32, 0.9),
    below: new THREE.Vector3(0.3, -0.9, 0.5),
  };
  const qs = new URLSearchParams(location.search);
  const zoom = Math.max(0.2, +(qs.get('zoom') ?? 1));
  const dist = (view === 'front' ? d * 0.6 : d) / zoom;
  const tgt = new THREE.Vector3(view === 'front' ? r * 0.35 : 0, 0, 0);
  if (qs.has('focus')) tgt.x = (0.5 - +qs.get('focus')!) * 2.2; // focus = body station s (0 snout … 1 tail)
  cam.position.copy(dirs[view].normalize().multiplyScalar(dist)).add(tgt);
  ctl.target.copy(tgt);
  cam.near = dist / 100;
  cam.far = dist * 20;
  cam.updateProjectionMatrix();
  ctl.update();
}
