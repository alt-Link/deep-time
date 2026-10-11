import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = matchMedia('(max-width: 820px)').matches;
const TAU = Math.PI * 2;
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
// GLSL-style smoothstep; edges may be reversed
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ scroll */

let lenis = null;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.085, smoothWheel: true, syncTouch: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const el = document.querySelector(a.getAttribute('href'));
    if (!el) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(el, { duration: a.classList.contains('cta') ? 4 : 2.4 });
    else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });
});

/* ------------------------------------------------------------------ world */

const canvas = document.getElementById('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe7c9a4, 0.014);
scene.background = new THREE.Color(0xe7c9a4);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(isMobile ? 68 : 56, innerWidth / innerHeight, 0.1, 1400);

/* ---------- noise ---------- */

function hash(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function rng(seed) {
  let r = seed * 9301 + 49297;
  return () => ((r = (r * 16807) % 2147483647) / 2147483647);
}

/* ---------- the ground: a valley where distance is time ----------
   z  30 .. -62   Triassic desert (red mesas)
   z -80 .. -148  Jurassic floodplain (river, giants)
   z -166 .. -250 Cretaceous forest
   z -268 ..      ash, then the fern spike                          */

function H(x, z) {
  const v = ss(9, 46, Math.abs(x));
  const wT = ss(-80, -50, z);
  let hill = v * (4 + 24 * fbm(x * 0.013 + 7, z * 0.013, 4));
  if (wT > 0) { // flat-topped buttes in the desert
    const step = 3.2, k = hill / step, fl = Math.floor(k);
    hill = lerp(hill, (fl + ss(0.75, 1, k - fl)) * step * 1.15, wT);
  }
  let h = hill + ((fbm(x * 0.06, z * 0.06, 3) - 0.5) * 1.2 + (noise(x * 0.4, z * 0.4) - 0.5) * 0.15) * (1 - v * 0.5);
  const wJ = ss(-66, -78, z) * ss(-158, -146, z);
  if (wJ > 0) {
    const rx = -15 + Math.sin(z * 0.05) * 5;
    h -= (1 - ss(2.5, 8, Math.abs(x - rx))) * 2.0 * wJ;
  }
  return h;
}

const PALETTES = {
  T: { floor: '#C99467', slope: '#A4502C', band: '#DDB283' },
  J: { floor: '#6C7640', slope: '#4C5934', band: '#5A6538' },
  C: { floor: '#7E7744', slope: '#3D4B29', band: '#46532C' },
  A: { floor: '#4D4845', slope: '#2B2725', band: '#363130' },
};
const PAL = Object.fromEntries(Object.entries(PALETTES).map(([k, p]) => [k,
  Object.fromEntries(Object.entries(p).map(([n, c]) => [n, new THREE.Color(c)]))]));
const ZSTOPS = [[60, 'T'], [-60, 'T'], [-80, 'J'], [-148, 'J'], [-166, 'C'], [-250, 'C'], [-268, 'A'], [-500, 'A']];
const fernTint = new THREE.Color('#5F6E3D');

function paletteAt(z, out) {
  for (let i = 0; i < ZSTOPS.length - 1; i++) {
    const [z0, a] = ZSTOPS[i], [z1, b] = ZSTOPS[i + 1];
    if (z <= z0 && z >= z1) {
      const k = ss(z0, z1, z);
      ['floor', 'slope', 'band'].forEach((n) => out[n].copy(PAL[a][n]).lerp(PAL[b][n], k));
      return out;
    }
  }
  ['floor', 'slope', 'band'].forEach((n) => out[n].copy(PAL.A[n]));
  return out;
}

const world = new THREE.Group();
scene.add(world);

const terrainGeo = new THREE.PlaneGeometry(260, 460, isMobile ? 150 : 210, isMobile ? 260 : 360);
terrainGeo.rotateX(-Math.PI / 2);
terrainGeo.translate(0, 0, -190);
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const pal = { floor: new THREE.Color(), slope: new THREE.Color(), band: new THREE.Color() };
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = H(x, z);
    pos.setY(i, h);
    paletteAt(z, pal);
    c.copy(pal.floor).lerp(pal.slope, ss(1.2, 7, h));
    const wT = ss(-80, -50, z);
    if (wT > 0) { // painted-desert strata on the buttes
      const b = 0.5 + 0.5 * Math.sin(h * 2.3 + fbm(x * 0.05, z * 0.05) * 3);
      c.lerp(pal.band, ss(0.55, 0.75, b) * ss(2, 5, h) * wT);
    }
    c.lerp(fernTint, ss(-312, -345, z) * 0.55 * (1 - ss(1, 5, h)));
    c.multiplyScalar(0.86 + 0.28 * fbm(x * 0.25 + 3, z * 0.25, 3));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}

/* ---------- the signature: footprints that follow the cursor ---------- */

const MAX_PRINTS = 28;
const prints = Array.from({ length: MAX_PRINTS }, () => new THREE.Vector4(0, 0, -999, 0));
const printScale = new Array(MAX_PRINTS).fill(1);
const printUniforms = {
  uPrints: { value: prints },
  uPrintScale: { value: printScale },
  uTime: { value: 0 },
  uEmber: { value: 0 },
};

const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.5 });
terrainMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, printUniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', /* glsl */`#include <common>
      varying vec3 vWp;
      uniform vec4 uPrints[${MAX_PRINTS}];
      uniform float uPrintScale[${MAX_PRINTS}];
      uniform float uTime, uEmber;

      float capsule(vec2 p, vec2 a, vec2 b, float r) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h) - r;
      }
      float smin(float a, float b, float k) {
        float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
        return mix(b, a, h) - k * h * (1.0 - h);
      }
      // a three-toed theropod track, heel at the back, about 1 unit long
      float track(vec2 q) {
        q.y += 0.32;
        float heel = length(q * vec2(1.0, 1.3)) - 0.16;
        float mid = capsule(q, vec2(0.0, 0.1), vec2(0.0, 0.66), 0.07);
        float l = capsule(q, vec2(-0.03, 0.08), vec2(-0.31, 0.47), 0.063);
        float r = capsule(q, vec2(0.03, 0.08), vec2(0.31, 0.47), 0.063);
        return smin(heel, min(mid, min(l, r)), 0.08);
      }
      // x: depth here, y: depth a little toward the light (for the wall shading), z: raised rim
      vec3 tracks(vec2 p) {
        vec3 o = vec3(0.0);
        vec2 lightOff = vec2(0.045, 0.06);
        for (int k = 0; k < ${MAX_PRINTS}; k++) {
          vec4 P = uPrints[k];
          float age = uTime - P.z;
          if (age < 0.0 || age > 22.0) continue;
          float sc = uPrintScale[k];
          vec2 d = p - P.xy;
          if (dot(d, d) > sc * sc * 0.8) continue;
          float s = sin(P.w), c = cos(P.w);
          vec2 rgt = vec2(c, -s), fwd = vec2(s, c);
          float life = smoothstep(0.0, 0.16, age) * (1.0 - smoothstep(13.0, 22.0, age));
          vec2 q = vec2(dot(d, rgt), dot(d, fwd)) / sc;
          vec2 d2 = d + lightOff;
          vec2 q2 = vec2(dot(d2, rgt), dot(d2, fwd)) / sc;
          float sd = track(q), sd2 = track(q2);
          o.x = max(o.x, (1.0 - smoothstep(-0.05, 0.02, sd)) * life);
          o.y = max(o.y, (1.0 - smoothstep(-0.05, 0.02, sd2)) * life);
          o.z = max(o.z, smoothstep(0.0, 0.03, sd) * (1.0 - smoothstep(0.04, 0.13, sd)) * life);
        }
        return o;
      }`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      vec3 trk = tracks(vWp.xz);
      float wall = clamp((trk.x - trk.y) * 3.0, -1.0, 1.0);
      diffuseColor.rgb *= 1.0 - trk.x * 0.5;
      diffuseColor.rgb *= 1.0 - max(wall, 0.0) * 0.45;
      diffuseColor.rgb += max(-wall, 0.0) * 0.07;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.22 + 0.025, trk.z * 0.7);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * trk.x * uEmber * 1.6;`);
};

const terrain = new THREE.Mesh(terrainGeo, terrainMat);
world.add(terrain);

// Jurassic river and wetland pools: a plane that only shows where the ground dips
const river = new THREE.Mesh(
  new THREE.PlaneGeometry(64, 96),
  new THREE.MeshStandardMaterial({ color: '#5E7A6A', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.86, envMapIntensity: 1.3 }),
);
river.rotation.x = -Math.PI / 2;
river.position.set(-12, -0.62, -111);
world.add(river);

/* ---------- plants (instanced, merged from primitives with vertex colours) ---------- */

function paint(g, hex) {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const at = (g, x, y, z, sx = 1, sy = 1, sz = 1) => { g.scale(sx, sy, sz); g.translate(x, y, z); return g; };

const PLANTS = {
  conifer: mergeGeometries([
    paint(at(new THREE.CylinderGeometry(0.14, 0.24, 4, 6), 0, 2, 0), '#4A3424'),
    paint(at(new THREE.ConeGeometry(1.5, 3, 7), 0, 3.4, 0), '#46532C'),
    paint(at(new THREE.ConeGeometry(1.15, 2.4, 7), 0, 4.9, 0), '#4D5B30'),
    paint(at(new THREE.ConeGeometry(0.75, 2, 7), 0, 6.2, 0), '#566435'),
  ]),
  araucaria: mergeGeometries([
    paint(at(new THREE.CylinderGeometry(0.22, 0.42, 14, 7), 0, 7, 0), '#4B3626'),
    paint(at(new THREE.IcosahedronGeometry(3, 1), 0, 14, 0, 1, 0.42, 1), '#334527'),
    paint(at(new THREE.IcosahedronGeometry(2.2, 1), 0, 11.6, 0, 1, 0.38, 1), '#3A4C2A'),
  ]),
  treefern: mergeGeometries([
    paint(at(new THREE.CylinderGeometry(0.14, 0.2, 3, 6), 0, 1.5, 0), '#4E3B26'),
    paint(at(new THREE.ConeGeometry(2.1, 1.1, 9).rotateX(Math.PI), 0, 3.15, 0), '#5D7A33'),
  ]),
  cycad: paint(at(new THREE.IcosahedronGeometry(0.8, 0), 0, 0.25, 0, 1.4, 0.6, 1.4), '#6C7C3B'),
  broadleaf: mergeGeometries([
    paint(at(new THREE.CylinderGeometry(0.22, 0.36, 6, 7), 0, 3, 0), '#4A3626'),
    paint(at(new THREE.IcosahedronGeometry(3, 1), 0, 7, 0, 1, 0.8, 1), '#3B5228'),
    paint(at(new THREE.IcosahedronGeometry(2.1, 1), 1.6, 6.1, 0.6), '#46602D'),
  ]),
  shrub: paint(at(new THREE.IcosahedronGeometry(0.75, 1), 0, 0.4, 0, 1, 0.75, 1), '#FFFFFF'),
  deadTrunk: paint(at(new THREE.CylinderGeometry(0.16, 0.34, 5, 6), 0, 2.2, 0), '#1E1917'),
  stump: paint(at(new THREE.CylinderGeometry(0.3, 0.45, 1.4, 6), 0, 0.5, 0), '#221C19'),
  fern: paint(at(new THREE.ConeGeometry(0.45, 0.7, 6), 0, 0.3, 0), '#6E9A3A'),
};
const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, envMapIntensity: 0.4 });

function scatter(n, z0, z1, { xmin = 6, xmax = 80, s = [1, 1.4], seed = 1, pow = 1.3, zpow = 1, tilt = 0 } = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const z = lerp(z0, z1, Math.pow(r(), zpow));
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (xmin + (xmax - xmin) * Math.pow(r(), pow));
    out.push([x, z, lerp(s[0], s[1], r()), r() * TAU, (r() - 0.5) * tilt]);
  }
  return out;
}

function plant(geo, items, tint = []) {
  const m = new THREE.InstancedMesh(geo, plantMat, items.length);
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  const r = rng(items.length + 3);
  items.forEach(([x, z, s, ry, tilt], i) => {
    d.position.set(x, H(x, z) - 0.15, z);
    d.rotation.set(tilt, ry, tilt * 0.6);
    d.scale.setScalar(s);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    if (tint.length) c.set(tint[Math.floor(r() * tint.length)]);
    else c.setScalar(1);
    c.multiplyScalar(0.85 + r() * 0.3);
    m.setColorAt(i, c);
  });
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  world.add(m);
  return m;
}

// Triassic: sparse conifers on the desert, cycads in the dry washes
plant(PLANTS.conifer, scatter(70, 40, -70, { xmin: 7, xmax: 70, s: [0.7, 1.6], seed: 2 }));
plant(PLANTS.cycad, scatter(90, 40, -70, { xmin: 4, xmax: 40, s: [0.6, 1.3], seed: 3 }));
// Jurassic: araucaria stands, tree ferns by the water, ferns everywhere
plant(PLANTS.araucaria, scatter(110, -66, -158, { xmin: 15, xmax: 90, s: [0.85, 1.5], seed: 4 }));
plant(PLANTS.treefern, scatter(150, -70, -156, { xmin: 7, xmax: 50, s: [0.8, 1.5], seed: 5 }));
plant(PLANTS.cycad, scatter(220, -66, -160, { xmin: 3.5, xmax: 46, s: [0.8, 1.6], seed: 6 }));
// Cretaceous: broadleaf forest edge and flowering shrubs
plant(PLANTS.broadleaf, scatter(150, -150, -258, { xmin: 15, xmax: 90, s: [0.9, 1.6], seed: 7 }));
plant(PLANTS.treefern, scatter(50, -150, -250, { xmin: 11, xmax: 50, s: [0.8, 1.3], seed: 8 }));
plant(PLANTS.shrub, scatter(320, -148, -262, { xmin: 4.5, xmax: 50, s: [0.45, 1.05], seed: 9 }),
  ['#5E7B35', '#6A8A3A', '#E9D8C4', '#E7B9C0', '#F3EBD8', '#4E6B2E', '#D9C27A']);
// after: burnt trunks, stumps, then the fern spike
plant(PLANTS.deadTrunk, scatter(120, -262, -400, { xmin: 5, xmax: 80, s: [0.8, 1.6], seed: 10, tilt: 0.9 }));
plant(PLANTS.stump, scatter(90, -262, -400, { xmin: 3, xmax: 60, s: [0.7, 1.4], seed: 11 }));
plant(PLANTS.fern, scatter(420, -300, -392, { xmin: 1.6, xmax: 46, s: [0.5, 1.5], seed: 12, zpow: 0.7 }),
  ['#6E9A3A', '#7DAA44', '#5C8A33', '#8FB352']);

/* ---------- dinosaurs: stylised, built from primitives, walking circuits ---------- */

function taperTube(points, r0, r1, seg = 16, rad = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, seg, 1, rad, false);
  const pos = geo.attributes.position;
  const P = new THREE.Vector3(), V = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    curve.getPointAt(u, P);
    const r = lerp(r0, r1, Math.pow(u, 0.85));
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j;
      V.fromBufferAttribute(pos, k).sub(P).multiplyScalar(r).add(P);
      pos.setXYZ(k, V.x, V.y, V.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function ellipsoid(rx, ry, rz, seg = 14) {
  return new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)).scale(rx, ry, rz);
}

const skin = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, flatShading: true, envMapIntensity: 0.4 });

/* A creature faces +x. Neck and tail are pivoting groups so they can sway;
   legs pivot at the hip. Coordinates are metres before `scale`. */
function creature(spec) {
  const mat = skin(spec.color);
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const body = new THREE.Mesh(ellipsoid(...spec.body.r), mat);
  body.position.set(...spec.body.p);
  body.rotation.z = spec.body.tilt || 0;
  rig.add(body);

  const limb = (points, r0, r1, extra) => {
    const g = new THREE.Group();
    const base = points[0];
    g.position.set(...base);
    const rel = points.map((p) => [p[0] - base[0], p[1] - base[1], p[2] - base[2]]);
    g.add(new THREE.Mesh(taperTube(rel, r0, r1), mat));
    if (extra) extra(g, rel[rel.length - 1], mat);
    rig.add(g);
    return g;
  };

  const neck = limb(spec.neck.pts, spec.neck.r0, spec.neck.r1, (g, end) => {
    const head = new THREE.Mesh(ellipsoid(...spec.head.r, 10), spec.head.mat ? skin(spec.head.mat) : mat);
    head.position.set(end[0] + (spec.head.o || 0), end[1], end[2]);
    head.rotation.z = spec.head.tilt || 0;
    g.add(head);
    if (spec.head.jaw) {
      const jaw = new THREE.Mesh(ellipsoid(...spec.head.jaw, 8), mat);
      jaw.position.set(end[0] + (spec.head.o || 0) + spec.head.r[0] * 0.15, end[1] - spec.head.r[1] * 0.6, end[2]);
      g.add(jaw);
    }
  });
  const tail = limb(spec.tail.pts, spec.tail.r0, spec.tail.r1);

  const legs = spec.legs.map(([x, y, z, len, rt, rb, phase]) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, 7), mat);
    leg.position.y = -len / 2;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(rb * 2.6, rb * 0.7, rb * 2.2), mat);
    foot.position.set(rb * 0.5, -len + rb * 0.3, 0);
    g.add(leg, foot);
    g.userData.phase = phase;
    rig.add(g);
    return g;
  });

  if (spec.extras) spec.extras(rig, mat);
  root.scale.setScalar(spec.scale || 1);
  return { root, rig, neck, tail, legs, spec };
}

const SPECIES = {
  // small early theropod (Eoraptor / Coelophysis), about 1 m before scale
  runner: (color = '#9A5A36') => ({
    color,
    body: { p: [0, 0.62, 0], r: [0.34, 0.17, 0.14], tilt: 0.1 },
    neck: { pts: [[0.25, 0.68, 0], [0.42, 0.86, 0], [0.5, 0.98, 0]], r0: 0.08, r1: 0.045 },
    head: { r: [0.1, 0.05, 0.045], o: 0.06, tilt: -0.1 },
    tail: { pts: [[-0.28, 0.62, 0], [-0.6, 0.6, 0], [-0.95, 0.52, 0], [-1.25, 0.48, 0]], r0: 0.1, r1: 0.008 },
    legs: [[-0.04, 0.58, 0.09, 0.56, 0.06, 0.025, 0], [-0.04, 0.58, -0.09, 0.56, 0.06, 0.025, Math.PI]],
    gait: 9, swing: 0.55, bob: 0.03,
  }),
  // Plateosaurus: a big early long-neck, mostly on two legs
  prosauropod: () => ({
    color: '#7D6A48', scale: 2.4,
    body: { p: [0, 1.25, 0], r: [0.95, 0.55, 0.45], tilt: 0.18 },
    neck: { pts: [[0.7, 1.45, 0], [1.2, 1.8, 0], [1.55, 2.1, 0]], r0: 0.28, r1: 0.12 },
    head: { r: [0.22, 0.11, 0.1], o: 0.12 },
    tail: { pts: [[-0.8, 1.2, 0], [-1.6, 1.05, 0], [-2.4, 0.85, 0], [-3.0, 0.75, 0]], r0: 0.3, r1: 0.02 },
    legs: [[-0.1, 1.1, 0.25, 1.1, 0.16, 0.08, 0], [-0.1, 1.1, -0.25, 1.1, 0.16, 0.08, Math.PI],
      [0.55, 1.0, 0.22, 0.95, 0.09, 0.05, Math.PI], [0.55, 1.0, -0.22, 0.95, 0.09, 0.05, 0]],
    gait: 4.2, swing: 0.4, bob: 0.03,
  }),
  // Brachiosaurus: front legs longer, neck raised high
  sauropod: () => ({
    color: '#6E6D5E', scale: 0.78,
    body: { p: [0, 7, 0], r: [5.4, 2.7, 2.5], tilt: 0.16 },
    neck: { pts: [[4, 8.2, 0], [6.4, 11.2, 0], [7.8, 14.6, 0], [8.6, 17.2, 0]], r0: 1.35, r1: 0.42 },
    head: { r: [0.95, 0.5, 0.45], o: 0.5, tilt: -0.25 },
    tail: { pts: [[-4.8, 7, 0], [-8.6, 6.1, 0], [-12.6, 4.6, 0], [-17, 3.6, 0]], r0: 1.35, r1: 0.06 },
    legs: [[3.0, 7.0, 1.4, 7.0, 0.75, 0.55, 0], [3.0, 7.0, -1.4, 7.0, 0.75, 0.55, Math.PI],
      [-3.0, 6.0, 1.5, 6.0, 0.85, 0.6, Math.PI], [-3.0, 6.0, -1.5, 6.0, 0.85, 0.6, 0]],
    gait: 1.1, swing: 0.22, bob: 0.08,
  }),
  // Stegosaurus with plates and a spiked tail
  stego: () => ({
    color: '#6B6A3C', scale: 1,
    body: { p: [0, 2.3, 0], r: [2.6, 1.45, 1.15], tilt: -0.08 },
    neck: { pts: [[2.2, 2.0, 0], [3.0, 1.6, 0], [3.5, 1.3, 0]], r0: 0.5, r1: 0.22 },
    head: { r: [0.38, 0.2, 0.18], o: 0.2, tilt: -0.3 },
    tail: { pts: [[-2.3, 2.5, 0], [-3.6, 2.4, 0], [-5.0, 2.0, 0], [-6.2, 1.7, 0]], r0: 0.55, r1: 0.06 },
    legs: [[1.5, 1.6, 0.6, 1.6, 0.3, 0.22, 0], [1.5, 1.6, -0.6, 1.6, 0.3, 0.22, Math.PI],
      [-1.5, 2.4, 0.65, 2.4, 0.38, 0.26, Math.PI], [-1.5, 2.4, -0.65, 2.4, 0.38, 0.26, 0]],
    gait: 2.6, swing: 0.3, bob: 0.04,
    extras: (rig) => {
      const parts = [];
      for (let i = 0; i < 9; i++) {
        const u = i / 8, x = lerp(1.9, -3.4, u);
        const hgt = 0.5 + Math.sin(u * Math.PI) * 0.75;
        const yb = 2.3 + 1.35 * Math.sqrt(Math.max(0, 1 - (x / 2.8) ** 2)) - 0.1 + (x < -2.3 ? 0.25 : 0);
        const g = new THREE.ConeGeometry(hgt * 0.62, hgt * 1.4, 4).scale(1, 1, 0.12);
        g.translate(x, yb + hgt * 0.55, (i % 2 ? 0.16 : -0.16));
        parts.push(paint(g, '#B0652F'));
      }
      [[-5.6, 1.85, 0.25, 0.6], [-5.6, 1.85, -0.25, -0.6], [-6.0, 1.75, 0.22, 0.5], [-6.0, 1.75, -0.22, -0.5]].forEach(([x, y, z, a]) => {
        const g = new THREE.ConeGeometry(0.07, 0.7, 5).rotateX(a + Math.sign(a) * 0.4).rotateZ(0.5);
        g.translate(x, y + 0.15, z);
        parts.push(paint(g, '#D8C9A6'));
      });
      rig.add(new THREE.Mesh(mergeGeometries(parts), plantMat));
    },
  }),
  // Tyrannosaurus rex
  rex: () => ({
    color: '#4E3E2C', scale: 1,
    body: { p: [0, 3.5, 0], r: [2.7, 1.45, 1.15], tilt: 0.05 },
    neck: { pts: [[2.0, 3.9, 0], [2.7, 4.5, 0], [3.1, 4.75, 0]], r0: 0.85, r1: 0.6 },
    head: { r: [1.05, 0.52, 0.48], o: 0.75, tilt: -0.05, jaw: [0.85, 0.22, 0.38] },
    tail: { pts: [[-2.3, 3.7, 0], [-4.6, 3.45, 0], [-7.0, 2.95, 0], [-9.0, 2.6, 0]], r0: 1.05, r1: 0.05 },
    legs: [[-0.3, 3.2, 0.75, 3.2, 0.55, 0.24, 0], [-0.3, 3.2, -0.75, 3.2, 0.55, 0.24, Math.PI]],
    gait: 2.4, swing: 0.42, bob: 0.1,
    extras: (rig, mat) => {
      [0.4, -0.4].forEach((z) => {
        const arm = new THREE.Mesh(taperTube([[1.9, 3.3, z], [2.25, 3.0, z * 1.2], [2.45, 3.05, z * 1.25]], 0.13, 0.05, 6, 5), mat);
        rig.add(arm);
      });
    },
  }),
  // Triceratops
  trike: () => ({
    color: '#7A6648', scale: 1,
    body: { p: [0, 2.0, 0], r: [2.7, 1.4, 1.35] },
    neck: { pts: [[2.2, 2.0, 0], [2.8, 1.95, 0], [3.1, 1.9, 0]], r0: 0.85, r1: 0.7 },
    head: { r: [0.95, 0.62, 0.6], o: 0.45, tilt: -0.3 },
    tail: { pts: [[-2.4, 2.1, 0], [-3.6, 1.85, 0], [-4.8, 1.4, 0]], r0: 0.6, r1: 0.06 },
    legs: [[1.6, 1.4, 0.75, 1.4, 0.36, 0.3, 0], [1.6, 1.4, -0.75, 1.4, 0.36, 0.3, Math.PI],
      [-1.5, 1.7, 0.8, 1.7, 0.45, 0.32, Math.PI], [-1.5, 1.7, -0.8, 1.7, 0.45, 0.32, 0]],
    gait: 2.2, swing: 0.28, bob: 0.03,
    extras: (rig) => {
      const frill = new THREE.CylinderGeometry(1.45, 1.45, 0.14, 14, 1, false, -Math.PI / 2 - 1.3, 2.6 + Math.PI)
        .rotateZ(Math.PI / 2).rotateZ(-0.55);
      frill.translate(3.05, 2.6, 0);
      const parts = [paint(frill, '#9A6A3E')];
      [[0.32, 1], [-0.32, 1]].forEach(([z]) => {
        const g = new THREE.ConeGeometry(0.12, 1.15, 6).rotateZ(-1.0);
        g.translate(4.05, 2.55, z);
        parts.push(paint(g, '#E2D6B8'));
      });
      const nose = new THREE.ConeGeometry(0.1, 0.45, 6).rotateZ(-0.6);
      nose.translate(4.45, 2.0, 0);
      parts.push(paint(nose, '#E2D6B8'));
      rig.add(new THREE.Mesh(mergeGeometries(parts), plantMat));
    },
  }),
  // hadrosaur, the ones that look up at the end
  hadro: () => ({
    color: '#5D5446', scale: 1,
    body: { p: [0, 2.6, 0], r: [2.4, 1.2, 0.95], tilt: 0.12 },
    neck: { pts: [[1.8, 3.0, 0], [2.5, 3.8, 0], [2.9, 4.4, 0]], r0: 0.55, r1: 0.32 },
    head: { r: [0.6, 0.28, 0.24], o: 0.35, tilt: 0.25 },
    tail: { pts: [[-2.0, 2.7, 0], [-3.8, 2.6, 0], [-5.6, 2.3, 0], [-6.8, 2.2, 0]], r0: 0.75, r1: 0.05 },
    legs: [[-0.4, 2.3, 0.55, 2.3, 0.42, 0.18, 0], [-0.4, 2.3, -0.55, 2.3, 0.42, 0.18, Math.PI],
      [1.5, 2.0, 0.45, 2.0, 0.16, 0.1, Math.PI], [1.5, 2.0, -0.45, 2.0, 0.16, 0.1, 0]],
    gait: 2.4, swing: 0.25, bob: 0.03,
  }),
};

const herd = [];
// [species, centreX, centreZ, radius, speed m/s, phase, scale override, graze]
const PLACEMENTS = [
  // Triassic: a small runner near the path, a Coelophysis pack, two Plateosaurus
  ['runner', -2.5, -13, 3.2, 1.8, 0, 1],
  ['runner', 9, -22, 6, 3.4, 0.2, 2.4, false, '#8A4E2E'],
  ['runner', 9, -22, 6, 3.4, 0.9, 2.2, false, '#9C6038'],
  ['runner', 9, -22, 6.8, 3.4, 1.6, 2.5, false, '#7E4A2C'],
  ['prosauropod', -14, -44, 6, 1.2, 0],
  ['prosauropod', -14, -44, 6, 1.2, 1.4],
  // Jurassic: giants by the river, stegosaurs nearer the path
  ['sauropod', -17, -102, 13, 1.1, 0.4],
  ['sauropod', -7, -126, 0, 0, 0.3, null, true],
  ['sauropod', -30, -136, 9, 0.9, 2.5],
  ['stego', 11, -92, 5, 0.9, 0],
  ['stego', 14, -98, 0, 0, 2.2, null, true],
  // Cretaceous: Triceratops grazing, a T. rex crossing the clearing
  ['trike', -13, -168, 0, 0, 0.4, null, true],
  ['trike', -19, -176, 0, 0, 2.6, null, true],
  ['trike', -10, -182, 3, 0.7, 1.3],
  ['trike', 18, -206, 0, 0, 4.1, null, true],
  ['rex', 5, -164, 8, 1.9, 4.4],
  // the plain where they watch the sky
  ['hadro', -9, -262, 0, 0, 0.3, null, true],
  ['hadro', -4, -271, 0, 0, 5.6, null, true],
  ['hadro', 7, -267, 0, 0, 3.6, null, true],
];
PLACEMENTS.forEach(([kind, cx, cz, r, speed, phase, scale, graze, color]) => {
  const spec = SPECIES[kind](color);
  if (scale) spec.scale = scale;
  const c = creature(spec);
  Object.assign(c, { cx, cz, r, speed, phase, graze: !!graze, kind });
  if (!r) {
    c.root.position.set(cx, H(cx, cz), cz);
    c.root.rotation.y = phase;
  }
  world.add(c.root);
  herd.push(c);
});

const tmpV = new THREE.Vector3();
function animateHerd(t, lookUp) {
  herd.forEach((c) => {
    const { spec } = c;
    let moving = 0;
    if (c.r) {
      const a = c.phase + (t * c.speed) / c.r;
      const x = c.cx + Math.cos(a) * c.r, z = c.cz + Math.sin(a) * c.r;
      const dx = -Math.sin(a), dz = Math.cos(a);
      c.root.position.set(x, H(x, z), z);
      c.root.rotation.y = Math.atan2(-dz, dx);
      moving = 1;
    }
    const f = t * spec.gait + c.phase * 3;
    c.legs.forEach((g) => { g.rotation.z = Math.sin(f + g.userData.phase) * spec.swing * moving; });
    c.rig.position.y = Math.abs(Math.sin(f)) * spec.bob * moving;
    c.tail.rotation.y = Math.sin(f * 0.5) * 0.12;
    if (c.graze) {
      // grazers dip to feed; on the last plain they lift their heads to the sky
      const dip = (0.5 + 0.5 * Math.sin(t * 0.35 + c.phase * 2)) * (1 - lookUp);
      c.neck.rotation.z = -dip * 0.5 + lookUp * 0.35;
      c.neck.rotation.y = Math.sin(t * 0.4 + c.phase) * 0.15;
    } else {
      c.neck.rotation.y = Math.sin(t * 0.6 + c.phase) * 0.08;
      c.neck.rotation.z = Math.sin(f) * 0.03;
    }
  });
}

/* ---------- birds: the ones that made it ---------- */

const BIRDS = isMobile ? 26 : 40;
const birdMat = new THREE.MeshStandardMaterial({ color: '#2B2620', roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
const birdBody = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.55, 5).rotateZ(-Math.PI / 2), birdMat, BIRDS);
const wingGeo = new THREE.BufferGeometry();
wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0.16, 0, 0, -0.14, 0, 0, -0.06, 0, 0.62], 3));
wingGeo.computeVertexNormals();
const wingGeoR = wingGeo.clone().scale(1, 1, -1);
const wingL = new THREE.InstancedMesh(wingGeo, birdMat, BIRDS);
const wingR = new THREE.InstancedMesh(wingGeoR, birdMat, BIRDS);
const flock = new THREE.Group();
flock.add(birdBody, wingL, wingR);
[birdBody, wingL, wingR].forEach((m) => { m.frustumCulled = false; });
world.add(flock);
const birdData = Array.from({ length: BIRDS }, (_, i) => {
  const r = rng(i + 40);
  return { r: 8 + r() * 22, h: 6 + r() * 14, a: r() * TAU, w: (0.12 + r() * 0.12) * (r() < 0.5 ? 1 : -1), flap: 7 + r() * 4, ph: r() * TAU, s: 1.4 + r() * 1.2, cz: -366 + r() * 14 };
});
const bq = new THREE.Quaternion(), fq = new THREE.Quaternion(), bm = new THREE.Matrix4(), bs = new THREE.Vector3(), bp = new THREE.Vector3();
const axisY = new THREE.Vector3(0, 1, 0), axisX = new THREE.Vector3(1, 0, 0);
function animateBirds(t, rise) {
  flock.visible = rise > 0.001;
  if (!flock.visible) return;
  birdData.forEach((b, i) => {
    const a = b.a + t * b.w;
    bp.set(Math.cos(a) * b.r, 1.2 + b.h * rise + Math.sin(t * 0.7 + b.ph) * 0.8, b.cz + Math.sin(a) * b.r * 0.6);
    const heading = Math.atan2(-Math.cos(a) * 0.6 * b.w, -Math.sin(a) * b.w);
    bq.setFromAxisAngle(axisY, heading);
    bs.setScalar(b.s);
    bm.compose(bp, bq, bs);
    birdBody.setMatrixAt(i, bm);
    const flap = Math.sin(t * b.flap + b.ph) * 0.7;
    fq.setFromAxisAngle(axisX, -flap).premultiply(bq);
    bm.compose(bp, fq, bs);
    wingL.setMatrixAt(i, bm);
    fq.setFromAxisAngle(axisX, flap).premultiply(bq);
    bm.compose(bp, fq, bs);
    wingR.setMatrixAt(i, bm);
  });
  birdBody.instanceMatrix.needsUpdate = wingL.instanceMatrix.needsUpdate = wingR.instanceMatrix.needsUpdate = true;
}

/* ---------- the impact: fireball, glow on the horizon, falling ash ---------- */

function glowTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const fireTex = glowTexture([[0, 'rgba(255,255,245,1)'], [0.18, 'rgba(255,236,190,1)'], [0.4, 'rgba(255,150,60,.55)'], [1, 'rgba(255,90,20,0)']]);
const emberTex = glowTexture([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]);

const IMPACT_FROM = new THREE.Vector3(-210, 170, -720);
const IMPACT_AT = new THREE.Vector3(70, 0, -720);
const fireball = new THREE.Group();
const fireCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true }));
fireCore.scale.setScalar(34);
fireball.add(fireCore);
const trail = Array.from({ length: 12 }, (_, i) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true, opacity: 0.55 * (1 - i / 12) }));
  s.scale.setScalar(28 * (1 - i / 14));
  scene.add(s);
  return s;
});
scene.add(fireball);

const dome = new THREE.Mesh(
  new THREE.SphereGeometry(1, 40, 16, 0, TAU, 0, Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#FF7A2A', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
);
dome.position.copy(IMPACT_AT);
scene.add(dome);
const horizonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, color: '#FF6A2A', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true }));
horizonGlow.position.copy(IMPACT_AT);
horizonGlow.scale.set(700, 260, 1);
scene.add(horizonGlow);

const ASH = isMobile ? 900 : 1800;
const ashGeo = new THREE.BufferGeometry();
const ashPos = new Float32Array(ASH * 3);
const ashBox = { x: 50, y: 22, z: 50 };
{
  const r = rng(77);
  for (let i = 0; i < ASH; i++) ashPos.set([(r() - 0.5) * ashBox.x * 2, r() * ashBox.y, (r() - 0.5) * ashBox.z * 2], i * 3);
}
ashGeo.setAttribute('position', new THREE.BufferAttribute(ashPos, 3));
const ashMat = new THREE.PointsMaterial({ map: emberTex, size: 0.16, transparent: true, depthWrite: false, color: '#9A928A', opacity: 0 });
const ash = new THREE.Points(ashGeo, ashMat);
ash.frustumCulled = false;
scene.add(ash);

function animateAsh(dt, amount, ember, time) {
  ash.visible = amount > 0.01;
  if (!ash.visible) return;
  ashMat.opacity = amount;
  ashMat.color.set('#A49B92').lerp(new THREE.Color('#FF8A3A'), ember);
  ashMat.blending = ember > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending;
  const cx = camera.position.x, cz = camera.position.z;
  for (let i = 0; i < ASH; i++) {
    const k = i * 3;
    let x = ashPos[k], y = ashPos[k + 1], z = ashPos[k + 2];
    y -= dt * (0.6 + (i % 7) * 0.12) * (1 - ember * 0.4);
    if (ember > 0.5) y += dt * 1.4; // embers drift up on the heat
    x += Math.sin(time * 0.6 + i) * dt * 0.4;
    if (y < 0) y += ashBox.y;
    if (y > ashBox.y) y -= ashBox.y;
    // keep the box centred on the camera
    if (x - cx > ashBox.x) x -= ashBox.x * 2; else if (x - cx < -ashBox.x) x += ashBox.x * 2;
    if (z - cz > ashBox.z) z -= ashBox.z * 2; else if (z - cz < -ashBox.z) z += ashBox.z * 2;
    ashPos[k] = x; ashPos[k + 1] = y; ashPos[k + 2] = z;
  }
  ash.position.y = camera.position.y - 6;
  ashGeo.attributes.position.needsUpdate = true;
}

/* ---------- lights ---------- */

const hemi = new THREE.HemisphereLight(0xffe7c8, 0xa45f3a, 1.5);
const sun = new THREE.DirectionalLight(0xffd9a8, 1.6);
sun.position.set(-30, 40, 25);
const impactLight = new THREE.DirectionalLight(0xff8a40, 0);
scene.add(hemi, sun, impactLight, impactLight.target);

/* ---------- moods: one per chapter ---------- */

const MOODS = {
  triassic:   { fog: '#E8C9A2', density: 0.018, hemi: 1.55, sky: '#FFE6C6', ground: '#A45F3A', sun: 1.7, sunCol: '#FFD6A2', env: 0.35, exposure: 1.0, ash: 0, ember: 0, glow: 0 },
  jurassic:   { fog: '#CDD1AE', density: 0.019, hemi: 1.45, sky: '#EEF2D6', ground: '#4E5A2E', sun: 1.35, sunCol: '#FFF0C6', env: 0.4, exposure: 1.0, ash: 0, ember: 0, glow: 0 },
  cretaceous: { fog: '#E9BC7E', density: 0.0145, hemi: 1.35, sky: '#FFE0AE', ground: '#5A4A2A', sun: 1.9, sunCol: '#FFC27A', env: 0.32, exposure: 1.0, ash: 0, ember: 0, glow: 0 },
  impact:     { fog: '#2B1519', density: 0.02, hemi: 0.5, sky: '#7A4253', ground: '#1A0E0C', sun: 0.15, sunCol: '#FF7A3A', env: 0.1, exposure: 1.0, ash: 1, ember: 1, glow: 1 },
  ash:        { fog: '#2A2726', density: 0.034, hemi: 0.6, sky: '#8C8580', ground: '#2A2624', sun: 0.3, sunCol: '#D8C8B8', env: 0.12, exposure: 1.05, ash: 0.85, ember: 0.12, glow: 0.45 },
  dawn:       { fog: '#EEE3D2', density: 0.0115, hemi: 1.65, sky: '#FFF4E4', ground: '#7D8A5A', sun: 1.7, sunCol: '#FFE0B8', env: 0.38, exposure: 1.02, ash: 0, ember: 0, glow: 0 },
};
const moodKeys = ['density', 'hemi', 'sun', 'env', 'exposure', 'ash', 'ember', 'glow'];
const colKeys = ['fog', 'sky', 'ground', 'sunCol'];
const parsed = Object.fromEntries(Object.entries(MOODS).map(([k, m]) => [k, {
  ...m, ...Object.fromEntries(colKeys.map((c) => [c, new THREE.Color(m[c])])),
}]));
const cloneMood = (m) => ({ ...m, ...Object.fromEntries(colKeys.map((c) => [c, m[c].clone()])) });
const mood = cloneMood(parsed.triassic);

function blendMood(target, from, to, k) {
  moodKeys.forEach((key) => { target[key] = lerp(from[key], to[key], k); });
  colKeys.forEach((key) => target[key].copy(from[key]).lerp(to[key], k));
}

/* ---------- camera rail, keyed to sections ---------- */

const KEYS = [
  [0.000, [0, 2.6, 16], [0, 2.3, -10]],
  [0.040, [0, 2.2, 12], [1, 1.6, -10]],
  [0.140, [1.5, 1.7, -4], [6, 0.9, -20]],
  [0.240, [-1, 2.4, -26], [-12, 3.2, -44]],
  [0.320, [0, 3.0, -64], [-5, 6, -98]],
  [0.360, [1.5, 2.0, -92], [-6, 7.5, -118]],
  [0.440, [-1, 2.2, -114], [6, 5, -132]],
  [0.520, [0, 2.4, -144], [-3, 2.4, -166]],
  [0.600, [1, 1.9, -170], [6, 3, -188]],
  [0.680, [0, 3.2, -208], [6, 8, -258]],
  [0.760, [0, 3.4, -226], [6, 7, -276]],
  [0.840, [0, 3.0, -252], [5, 4, -300]],
  [0.860, [0, 2.2, -284], [2, 0.6, -304]],
  [0.930, [0, 2.4, -310], [0, 2.0, -334]],
  [0.960, [0, 2.8, -328], [0, 7, -356]],
  [1.000, [0, 3.2, -336], [0, 10.5, -360]],
];
const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal');
const lookCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[2])), false, 'centripetal');

function railParam(t) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (t <= KEYS[i + 1][0]) {
      const f = (t - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]);
      return (i + clamp(f, 0, 1)) / (KEYS.length - 1);
    }
  }
  return 1;
}

const sections = [...document.querySelectorAll('[data-t]')];
let anchors = [];
function measure() {
  const vh = innerHeight;
  anchors = sections.map((s) => ({
    y: s.getBoundingClientRect().top + scrollY,
    t: parseFloat(s.dataset.t),
    mood: parsed[s.dataset.mood],
    vh,
  }));
  anchors.push({ y: document.documentElement.scrollHeight - vh, t: 1, mood: parsed.dawn, vh });
}

function scrollState(y) {
  let t = 1;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (y < b.y) { t = a.t + (b.t - a.t) * clamp((y - a.y) / (b.y - a.y), 0, 1); break; }
  }
  // each chapter holds its mood and cross-fades in before its text arrives
  let from = anchors[0].mood;
  blendMood(mood, from, from, 0);
  for (let i = 1; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const k = ss(a.y - a.vh * 1.0, a.y - a.vh * 0.4, y);
    if (k <= 0) break;
    blendMood(mood, from, a.mood, k);
    from = cloneMood(mood);
  }
  return t;
}

/* ---------- pointer: parallax and the trackway ---------- */

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
const ndc = new THREE.Vector2();
const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
const walker = { last: null, side: 1, t: 0 };
let printIndex = 0;

function groundHit(clientX, clientY) {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let h = 0;
  for (let i = 0; i < 4; i++) { // refine against the real height field
    groundPlane.constant = -h;
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
    h = H(hit.x, hit.z);
  }
  hit.y = h;
  return hit.distanceTo(camera.position) < 70 ? hit : null;
}

function addPrint(x, z, angle, scale) {
  prints[printIndex].set(x, z, printUniforms.uTime.value, angle);
  printScale[printIndex] = scale;
  printIndex = (printIndex + 1) % MAX_PRINTS;
}

// touch screens have no hover trail, only taps
if (matchMedia('(hover: none)').matches) {
  document.querySelector('.hero__meta').textContent = "Tap the ground. You'll leave tracks.";
}

const NO_TRACKS = 'a, button, .survivors__stage, .forests__card, .impact__film, .giants__frame';
addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = (e.clientY / innerHeight) * 2 - 1;
  if (e.target.closest && e.target.closest(NO_TRACKS)) { walker.last = null; return; }
  const p = groundHit(e.clientX, e.clientY);
  if (!p) { walker.last = null; return; }
  if (!walker.last) { walker.last = p.clone(); return; }
  const dx = p.x - walker.last.x, dz = p.z - walker.last.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 9) { walker.last.copy(p); return; }
  const now = performance.now();
  if (dist > 1.25 && now - walker.t > 70) {
    const a = Math.atan2(dx, dz);
    const off = 0.3 * walker.side;
    addPrint(p.x + Math.cos(a) * off, p.z - Math.sin(a) * off, a, 1.0);
    walker.side *= -1;
    walker.last.copy(p);
    walker.t = now;
  }
}, { passive: true });

addEventListener('pointerdown', (e) => {
  if (e.target.closest && e.target.closest(NO_TRACKS)) return;
  const p = groundHit(e.clientX, e.clientY);
  if (!p) return;
  addPrint(p.x, p.z, Math.atan2(p.x - camera.position.x, p.z - camera.position.z), 1.7);
});

/* ---------- loop ---------- */

const clock = new THREE.Clock();
const intro = { lift: reduced ? 0 : 1 };
const impact = { q: 0 }; // 0..1 across the impact chapter (from its top entering view)
const closeState = { p: 0 };
let camT = 0;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const flashEl = document.querySelector('.flash');
let lastFlash = -1;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  printUniforms.uTime.value = time;

  const targetT = scrollState(scrollY);
  camT += (targetT - camT) * (1 - Math.pow(0.0009, dt));
  const u = railParam(camT);
  posCurve.getPoint(u, camPos);
  lookCurve.getPoint(u, camLook);

  pointer.sx += (pointer.x - pointer.sx) * 0.05;
  pointer.sy += (pointer.y - pointer.sy) * 0.05;
  const breathe = reduced ? 0 : Math.sin(time * 0.6) * 0.05;
  camera.position.set(
    camPos.x + pointer.sx * 0.4,
    camPos.y - pointer.sy * 0.2 + breathe + intro.lift * 14,
    camPos.z + intro.lift * 18,
  );
  camLook.x += pointer.sx * 1.4;
  camLook.y -= pointer.sy * 0.7 + intro.lift * 4;
  camera.lookAt(camLook);

  // mood
  scene.fog.color.copy(mood.fog);
  scene.fog.density = mood.density;
  scene.background.copy(mood.fog);
  hemi.intensity = mood.hemi;
  hemi.color.copy(mood.sky);
  hemi.groundColor.copy(mood.ground);
  sun.intensity = mood.sun;
  sun.color.copy(mood.sunCol);
  scene.environmentIntensity = mood.env;
  renderer.toneMappingExposure = mood.exposure;

  // impact choreography, keyed to impact.q; flash at q = 0.62
  const q = impact.q;
  const fall = Math.pow(ss(0.0, 0.62, q), 1.6);
  const inFlight = q > 0.005 && q < 0.622;
  fireball.visible = inFlight;
  trail.forEach((s, i) => {
    s.visible = inFlight;
    s.position.lerpVectors(IMPACT_FROM, IMPACT_AT, Math.max(0, fall - (i + 1) * 0.012));
  });
  fireball.position.lerpVectors(IMPACT_FROM, IMPACT_AT, fall);
  fireCore.scale.setScalar(26 + fall * 26 + Math.sin(time * 30) * 1.5);
  const boom = ss(0.62, 0.95, q);
  const after = q >= 0.62 ? 1 : 0;
  dome.visible = horizonGlow.visible = after === 1 && mood.glow > 0.01;
  dome.scale.set(30 + boom * 190, (30 + boom * 190) * 0.55, 30 + boom * 190);
  dome.material.opacity = (0.95 - boom * 0.7) * mood.glow;
  horizonGlow.material.opacity = (0.35 + (1 - boom) * 0.6) * mood.glow;
  const flash = ss(0.585, 0.62, q) * (1 - ss(0.63, 0.75, q));
  if (Math.abs(flash - lastFlash) > 0.002) { flashEl.style.opacity = (flash * 0.92).toFixed(3); lastFlash = flash; }
  impactLight.position.copy(after ? IMPACT_AT : fireball.position).sub(camera.position).normalize().multiplyScalar(50).add(camera.position);
  impactLight.target.position.copy(camera.position);
  impactLight.intensity = (after ? 4 * (1 - ss(0.62, 0.85, q)) + 0.5 : 0.3 + 4 * Math.pow(fall, 3)) * mood.glow;
  const ashAmt = mood.ash * ss(0.6, 0.72, q);
  printUniforms.uEmber.value = mood.ember * ss(0.6, 0.72, q);
  animateAsh(dt, ashAmt, mood.ember * ss(0.6, 0.7, q), time);

  animateHerd(time, ss(0.25, 0.55, q));
  animateBirds(time, closeState.p);

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ page motion */

function splitWords(el) {
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(' '); return; }
          const w = document.createElement('span');
          w.className = 'w';
          const inner = document.createElement('span');
          inner.textContent = part;
          w.append(inner);
          frag.append(w);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === 1) {
        walk(child);
      }
    });
  };
  walk(el);
  return el.querySelectorAll('.w > span');
}

const heroWords = splitWords(document.querySelector('#hero h1'));
document.querySelectorAll('.split').forEach((el) => {
  if (el.closest('#hero')) return;
  const words = splitWords(el);
  if (reduced) return;
  gsap.from(words, {
    yPercent: 110, duration: 1.2, ease: 'expo.out', stagger: 0.05,
    scrollTrigger: { trigger: el, start: 'top 82%' },
  });
});

function heroIntro() {
  if (reduced) return;
  const tl = gsap.timeline();
  tl.to(intro, { lift: 0, duration: 3.6, ease: 'power3.inOut' }, 0)
    .from(heroWords, { yPercent: 115, duration: 1.4, ease: 'expo.out', stagger: 0.08 }, 1.1)
    .from('#hero .lede, #hero .hero__meta', { opacity: 0, y: 20, duration: 1.2, ease: 'power2.out', stagger: 0.14 }, 1.7);
}

if (!reduced) {
  // origins: one sentence at a time while the camera crosses the desert
  const lines = gsap.utils.toArray('.origins__line');
  const otl = gsap.timeline({ scrollTrigger: { trigger: '#origins', start: 'top top', end: 'bottom bottom', scrub: 0.8 } });
  lines.forEach((line, i) => {
    const last = i === lines.length - 1;
    otl.fromTo(line, { opacity: 0, yPercent: 30, filter: 'blur(10px)' },
      { opacity: 1, yPercent: 0, filter: 'blur(0px)', duration: 1, ease: 'power2.out' }, i * 2.2);
    if (!last) otl.to(line, { opacity: 0, yPercent: -25, filter: 'blur(8px)', duration: 0.9, ease: 'power2.in' }, i * 2.2 + 1.5);
  });
  otl.to({}, { duration: 1.2 });

  // giants: the plate wipes open from the top, image settles inside
  gsap.to('.giants__frame', {
    clipPath: 'inset(0% 0% 0% 0% round 4px)', ease: 'none',
    scrollTrigger: { trigger: '.giants__frame', start: 'top 85%', end: 'top 35%', scrub: 0.6 },
  });
  gsap.fromTo('.giants__frame img', { yPercent: -12 }, {
    yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: '.giants__frame', start: 'top bottom', end: 'bottom top', scrub: true },
  });

  // forests: a small card grows until the forest fills the screen
  gsap.set('.forests__caption', { y: 40 });
  const ftl = gsap.timeline({ scrollTrigger: { trigger: '#forests', start: 'top top', end: 'bottom bottom', scrub: 0.7 } });
  ftl.to({}, { duration: 0.35 })
    .to('.forests__title', { opacity: 0, yPercent: -60, duration: 0.6, ease: 'power2.in' }, 0.45)
    .to('.forests__card', { clipPath: 'inset(0% 0% 0% 0% round 0px)', duration: 1.5, ease: 'power2.inOut' }, 0.35)
    .to('.forests__card img', { scale: 1, duration: 1.5, ease: 'power2.inOut' }, 0.35)
    .to('.forests__caption', { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 1.75)
    .to({}, { duration: 0.9 });

  // impact: the film opens, then the story arrives line by line
  const itl = gsap.timeline({ scrollTrigger: { trigger: '#impact', start: 'top top', end: 'bottom bottom', scrub: 0.5 } });
  itl.to('.impact__film', { clipPath: 'inset(0% 0% 0% 0%)', duration: 1, ease: 'power2.inOut' }, 0)
    .to('.impact__p', { opacity: 1, y: 0, duration: 0.8, stagger: 1.5, ease: 'power2.out' }, 0.6)
    .to({}, { duration: 1.4 });
}

// one progress value for the whole impact chapter, from its top entering view
ScrollTrigger.create({
  trigger: '#impact', start: 'top bottom', end: 'bottom bottom',
  onUpdate: (self) => { impact.q = self.progress; },
  onRefresh: (self) => { impact.q = self.progress; },
});
// the survivors and the close sit after the impact, keep q at its end there
ScrollTrigger.create({
  trigger: '#survivors', start: 'top bottom', end: 'max',
  onToggle: (self) => { if (self.isActive) impact.q = 1; },
});

// scrub the film: flash in the film (its midpoint) lines up with q = 0.62
const video = document.querySelector('.impact__film video');
let videoTarget = 0;
ScrollTrigger.create({
  trigger: '#impact', start: 'top bottom', end: 'bottom bottom',
  onUpdate: (self) => {
    const p = clamp((self.progress - 0.28) / 0.68, 0, 1);
    if (video.duration) videoTarget = p * (video.duration - 0.05);
  },
});
gsap.ticker.add(() => {
  if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - videoTarget) > 0.02) {
    video.currentTime += (videoTarget - video.currentTime) * 0.35;
  }
});
// iOS will not seek a video that has never played
addEventListener('touchstart', () => { video.play().then(() => video.pause()).catch(() => {}); }, { once: true, passive: true });

// nav flips to light ink through the dark chapters
ScrollTrigger.create({
  trigger: '#impact', start: 'top 45%', endTrigger: '#survivors', end: 'bottom 55%',
  toggleClass: { targets: document.body, className: 'is-dark' },
});

// birds lift as the close arrives
ScrollTrigger.create({
  trigger: '#close', start: 'top 95%', end: 'bottom bottom',
  onUpdate: (self) => { closeState.p = self.progress; },
  onRefresh: (self) => { closeState.p = self.progress; },
});

/* ------------------------------------------------------------------ the amber */

initAmber(document.getElementById('amber'));

function initAmber(cv) {
  const stage = cv.parentElement;
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  sc.background = new THREE.Color('#15110F');
  const pm = new THREE.PMREMGenerator(r);
  sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  sc.environmentIntensity = 0.7;
  const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 50);
  cam.position.set(0, 0.5, 6.4);
  cam.lookAt(0, 0, 0);
  sc.add(new THREE.HemisphereLight(0xfff0d8, 0x2a1a10, 0.8));
  const key = new THREE.DirectionalLight(0xffe2b0, 2.2);
  key.position.set(3, 4, 4);
  sc.add(key);

  // the light it is held up to: a warm glow behind, which the amber refracts
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(14, 10),
    new THREE.MeshBasicMaterial({ map: glowTexture([[0, '#FFD490'], [0.25, '#C27028'], [0.6, '#3A2214'], [1, '#15110F']]), toneMapped: false }));
  backdrop.position.z = -3.2;
  sc.add(backdrop);

  const piece = new THREE.Group();
  sc.add(piece);

  const geo = mergeVertices(new THREE.IcosahedronGeometry(1.25, 12).deleteAttribute('normal').deleteAttribute('uv'));
  {
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 2.1 + 1.3) * Math.sin(v.y * 1.7 + 0.4) * Math.sin(v.z * 2.3 + 2.1) * 0.16
        + Math.sin(v.x * 4.7 + v.y * 3.9) * 0.025;
      v.multiplyScalar(1 + n);
      v.y *= 0.72;
      v.x *= 1.18;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
  }
  const amberMat = new THREE.MeshPhysicalMaterial({
    color: '#FFD98A', transmission: 1, thickness: 1.2, roughness: 0.06, ior: 1.54,
    attenuationColor: new THREE.Color('#E8962E'), attenuationDistance: 3.6,
    clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, envMapIntensity: 1.3,
  });
  const amber = new THREE.Mesh(geo, amberMat);
  piece.add(amber);

  // the feathered tail inside
  const tailPts = [[-0.95, -0.22, 0.05], [-0.4, 0.02, 0.12], [0.2, 0.06, -0.02], [0.75, 0.24, 0.04], [1.05, 0.34, 0]];
  const tailCurve = new THREE.CatmullRomCurve3(tailPts.map((p) => new THREE.Vector3(...p)));
  const tailMat = new THREE.MeshStandardMaterial({ color: '#4A2A12', roughness: 0.6 });
  piece.add(new THREE.Mesh(taperTube(tailPts, 0.075, 0.018, 30, 7), tailMat));
  const barbs = 72;
  const barbGeo = new THREE.PlaneGeometry(0.034, 0.4).translate(0, 0.2, 0);
  const barbMesh = new THREE.InstancedMesh(barbGeo, new THREE.MeshStandardMaterial({ color: '#7A4A1E', roughness: 0.7, side: THREE.DoubleSide }), barbs);
  const d = new THREE.Object3D(), P = new THREE.Vector3(), T = new THREE.Vector3();
  for (let i = 0; i < barbs; i++) {
    const uu = 0.04 + (Math.floor(i / 2) / (barbs / 2)) * 0.92;
    tailCurve.getPointAt(uu, P);
    tailCurve.getTangentAt(uu, T);
    const side = i % 2 ? 1 : -1;
    d.position.copy(P);
    d.rotation.set(side * (1.0 + Math.sin(i) * 0.15), 0, Math.atan2(T.y, T.x) - Math.PI / 2 - 0.55);
    d.scale.set(1, 0.6 + Math.sin(uu * Math.PI) * 0.6, 1);
    d.updateMatrix();
    barbMesh.setMatrixAt(i, d.matrix);
  }
  piece.add(barbMesh);
  const bubbleMat = new THREE.MeshStandardMaterial({ color: '#FFF2D6', roughness: 0, metalness: 0.1, emissive: '#8A5A20' });
  const rb = rng(5);
  for (let i = 0; i < 16; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.012 + rb() * 0.035, 10, 8), bubbleMat);
    b.position.set((rb() - 0.5) * 1.8, (rb() - 0.5) * 0.9, (rb() - 0.5) * 1.1);
    piece.add(b);
  }
  piece.rotation.set(0.25, -0.5, 0.05);

  const st = { lift: 0, liftT: 0, rx: 0, ry: -0.5, vx: 0, vy: 0, drag: false, px: 0, py: 0, visible: false };
  stage.addEventListener('pointerenter', () => { st.liftT = 1; });
  stage.addEventListener('pointerleave', () => { st.liftT = 0; st.drag = false; });
  stage.addEventListener('pointerdown', (e) => { st.drag = true; st.px = e.clientX; st.py = e.clientY; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointerup', () => { st.drag = false; });
  stage.addEventListener('pointermove', (e) => {
    if (!st.drag) return;
    st.vy += (e.clientX - st.px) * 0.004;
    st.vx += (e.clientY - st.py) * 0.004;
    st.px = e.clientX; st.py = e.clientY;
  });

  new IntersectionObserver(([en]) => { st.visible = en.isIntersecting; }).observe(stage);

  function size() {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    r.setSize(width, height, false);
    cam.aspect = width / height;
    cam.fov = cam.aspect < 1.1 ? 38 : 30;
    cam.updateProjectionMatrix();
  }
  size();
  addEventListener('resize', size);

  const c2 = new THREE.Clock();
  const draw = () => {
    const t = c2.getElapsedTime();
    st.lift += (st.liftT - st.lift) * 0.07;
    st.ry += st.vy + (reduced ? 0 : 0.0025);
    st.rx += st.vx;
    st.vx *= 0.92; st.vy *= 0.92;
    st.rx *= 0.965; // it settles back toward you
    piece.rotation.set(0.25 + st.rx + Math.sin(t * 0.7) * 0.04, st.ry, 0.05 + Math.cos(t * 0.6) * 0.03);
    piece.position.y = Math.sin(t * 1.1) * 0.04 + st.lift * 0.25;
    piece.scale.setScalar(1 + st.lift * 0.08);
    backdrop.material.color.setScalar(0.38 + st.lift * 0.85);
    key.intensity = 2.2 - st.lift * 0.8;
    r.render(sc, cam);
  };
  gsap.ticker.add(() => { if (st.visible) draw(); });
  draw();
}

/* ------------------------------------------------------------------ boot */

function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);
ScrollTrigger.addEventListener('refresh', measure);
measure();

gsap.ticker.add(frame);

Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]).then(() => {
  ScrollTrigger.refresh();
  measure();
  frame(); // compile shaders before revealing the page
  setTimeout(() => {
    document.documentElement.classList.add('is-ready');
    heroIntro();
  }, 60);
});
