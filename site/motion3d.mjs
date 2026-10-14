// R Project — 3D hero scene and smooth motion layer.
// Progressive enhancement: if anything here fails, the page stays exactly as it was.

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const BPM = 120;
const doc = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const small = matchMedia('(max-width: 640px)').matches;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function start() {
  doc.classList.add('m3d');
  setupProgressAndHeader();
  setupReveal();
  if (!reduceMotion) {
    if (finePointer) { setupTilt(); setupMagnetic(); }
  }
  const hero = document.querySelector('.hero');
  if (hero) setupHero(hero);
  // Let the first frame paint with hidden hero items, then animate them in.
  requestAnimationFrame(() => requestAnimationFrame(() => doc.classList.add('m3d-in')));
}

/* ---------------- Header glass + scroll progress ---------------- */
function setupProgressAndHeader() {
  const bar = document.createElement('div');
  bar.className = 'm3d-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = doc.scrollHeight - innerHeight;
    const p = max > 0 ? scrollY / max : 0;
    bar.style.transform = `scaleX(${p.toFixed(4)})`;
    doc.classList.toggle('m3d-scrolled', scrollY > 24);
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

/* ---------------- Reveal on scroll ---------------- */
function setupReveal() {
  const selectors = [
    '.playground', '.section-head', '.feature-grid article', '.workflow-row',
    '.price-card', '.faq > div', '.faq details', '.closing > *', '.resources > *',
    '#downloads > *', '#multicam-workflows > *', '#start-checklist > *', '#demo > *', '#podcast-ai > *'
  ];
  const seen = new Set();
  const items = [];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el) || el.closest('.hero, dialog, header, footer')) continue;
      seen.add(el);
      items.push(el);
    }
  }
  // Stagger siblings that enter together.
  for (const el of items) {
    const siblings = [...el.parentElement.children].filter((c) => seen.has(c));
    const i = siblings.indexOf(el);
    el.style.setProperty('--m3d-delay', `${Math.min(i, 6) * 0.07}s`);
    el.setAttribute('data-m3d-reveal', '');
  }
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
  // Anything already above the fold (or jumped to via #hash) shows immediately.
  addEventListener('hashchange', () => items.forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in');
  }));
}

/* ---------------- 3D tilt cards ---------------- */
function setupTilt() {
  const cards = document.querySelectorAll('.feature-grid article, .price-card');
  for (const card of cards) {
    card.setAttribute('data-m3d-tilt', '');
    let rx = 0, ry = 0, tx = 0, ty = 0, raf = 0, hovering = false;
    const loop = () => {
      rx = lerp(rx, tx, 0.12);
      ry = lerp(ry, ty, 0.12);
      card.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(0)`;
      if (hovering || Math.abs(rx - tx) > 0.01 || Math.abs(ry - ty) > 0.01) raf = requestAnimationFrame(loop);
      else { raf = 0; if (!hovering) card.style.transform = ''; }
    };
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      tx = (0.5 - py) * 7;
      ty = (px - 0.5) * 9;
      card.style.setProperty('--m3d-x', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--m3d-y', `${(py * 100).toFixed(1)}%`);
      if (!raf) raf = requestAnimationFrame(loop);
    });
    card.addEventListener('pointerenter', () => { hovering = true; });
    card.addEventListener('pointerleave', () => { hovering = false; tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop); });
  }
}

/* ---------------- Magnetic buttons ---------------- */
function setupMagnetic() {
  for (const btn of document.querySelectorAll('.hero .button, .closing .button')) {
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${(dx * 0.18).toFixed(1)}px, ${(dy * 0.28).toFixed(1)}px)`;
    });
    btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
  }
}

/* ---------------- Hero 3D scene ---------------- */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function setupHero(hero) {
  const stage = document.createElement('div');
  stage.className = 'm3d-stage';
  stage.setAttribute('aria-hidden', 'true');
  hero.prepend(stage);
  if (!small) {
    const hint = document.createElement('span');
    hint.className = 'm3d-scroll';
    hint.setAttribute('aria-hidden', 'true');
    hero.appendChild(hint);
  }
  if (reduceMotion || !webglAvailable()) return; // static glow fallback stays
  const go = () => import(THREE_URL).then((THREE) => buildScene(THREE, stage, hero)).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1200 });
  else setTimeout(go, 200);
}

function roundedRect(THREE, w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ShapeGeometry(s, 8);
  // Map UVs to 0..1 across the rectangle so textures fill the card.
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h);
  return g;
}

function buildScene(THREE, stage, hero) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0c0c10, 14, 30);
  const camera = new THREE.PerspectiveCamera(small ? 48 : 36, 1, 0.1, 60);
  let camZ = small ? 11 : 10;
  camera.position.set(0, 0.4, camZ);

  const rig = new THREE.Group();
  scene.add(rig);

  /* Camera screens */
  const loader = new THREE.TextureLoader();
  const SW = 3.1, SH = SW * 9 / 16;
  const screenGeo = roundedRect(THREE, SW, SH, 0.14);
  const frameGeo = roundedRect(THREE, SW + 0.08, SH + 0.08, 0.17);
  const radius = small ? 6 : 9.5;
  const spread = small ? 0.42 : 0.36; // radians between screens
  const screens = [];
  for (let i = 0; i < 4; i++) {
    const tex = loader.load(`/assets/practice-cam-${i + 1}.webp`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, color: 0x9a9aaa });
    const frameMat = new THREE.MeshBasicMaterial({ color: 0xa18bff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
    const g = new THREE.Group();
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.z = -0.01;
    const screen = new THREE.Mesh(screenGeo, mat);
    g.add(frame, screen);
    const a = (i - 1.5) * spread;
    const baseX = Math.sin(a) * radius;
    const baseZ = Math.cos(a) * radius - radius - 2.2;
    const outer = i === 0 || i === 3;
    const baseY = small ? (outer ? 4.3 : 5.3) : (outer ? 0.5 : 2.5);
    g.position.set(baseX, baseY, baseZ);
    g.rotation.y = -a * 0.9;
    rig.add(g);
    screens.push({ g, mat, frameMat, baseX, baseY, baseZ, phase: i * 1.7, live: 0 });
  }

  /* Equalizer ring */
  const BARS = small ? 64 : 112;
  const barGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
  barGeo.translate(0, 0.5, 0);
  const barMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const bars = new THREE.InstancedMesh(barGeo, barMat, BARS);
  const ringR = small ? 3.4 : 5.6;
  const ring = new THREE.Group();
  ring.position.set(0, small ? -3.4 : -3.1, -6.5);
  ring.rotation.x = 0.12;
  ring.add(bars);
  rig.add(ring);
  const cA = new THREE.Color(0xa18bff), cB = new THREE.Color(0x6af5e3), tmpC = new THREE.Color();
  for (let i = 0; i < BARS; i++) {
    const t = Math.abs(Math.sin((i / BARS) * Math.PI));
    tmpC.copy(cA).lerp(cB, t);
    bars.setColorAt(i, tmpC);
  }
  bars.instanceColor.needsUpdate = true;
  const dummy = new THREE.Object3D();

  /* Floor ring line */
  const circlePts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    circlePts.push(new THREE.Vector3(Math.cos(a) * (ringR + 0.35), 0, Math.sin(a) * (ringR + 0.35)));
  }
  const circle = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(circlePts),
    new THREE.LineBasicMaterial({ color: 0xa18bff, transparent: true, opacity: 0.25 })
  );
  ring.add(circle);

  /* Particles */
  const P = small ? 260 : 700;
  const pPos = new Float32Array(P * 3);
  const pSeed = new Float32Array(P);
  for (let i = 0; i < P; i++) {
    pPos[i * 3] = (Math.random() - 0.5) * 26;
    pPos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    pPos[i * 3 + 2] = -Math.random() * 16 + 2;
    pSeed[i] = Math.random() * Math.PI * 2;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dctx = dot.getContext('2d');
  const grd = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.4, '#c9bcffaa'); grd.addColorStop(1, '#00000000');
  dctx.fillStyle = grd; dctx.fillRect(0, 0, 32, 32);
  const pMat = new THREE.PointsMaterial({
    size: 0.09, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending, color: 0xc9bcff
  });
  const points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  /* Sizing */
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull the camera back on narrow screens so the whole rig stays in frame.
    camZ = (small ? 11 : 10) * Math.min(Math.pow(Math.max(1, 1.7 / camera.aspect), 0.75), small ? 1.45 : 2.2);
    scene.fog.near = camZ + 4;
    scene.fog.far = camZ + 20;
    camera.updateProjectionMatrix();
  };
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else addEventListener('resize', resize);

  /* Input: pointer parallax + scroll */
  let mx = 0, my = 0, cx = 0, cy = 0;
  addEventListener('pointermove', (e) => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });
  let scrollP = 0, scrollS = 0;
  const onScroll = () => {
    const r = hero.getBoundingClientRect();
    scrollP = clamp(-r.top / Math.max(1, r.height), 0, 1);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Visibility: only render while the hero is on screen and the tab is visible */
  let visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }, { threshold: 0 }).observe(stage);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  /* Beat-driven camera switching */
  const beatLen = 60 / BPM;
  const pattern = [0, 2, 1, 3, 0, 1, 2, 3, 1, 0, 3, 2];
  let live = 0;

  const clock = new THREE.Clock();
  let raf = 0;
  const kick = () => { if (!raf) { clock.getDelta(); raf = requestAnimationFrame(frame); } };

  function frame() {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const beat = t / beatLen;
    const beatFrac = beat % 1;
    const kickEnv = Math.pow(1 - beatFrac, 3);           // sharp attack each beat
    const bar = Math.floor(beat / 2);
    live = pattern[bar % pattern.length];

    // Smooth pointer + scroll
    cx = lerp(cx, mx, 1 - Math.pow(0.001, dt));
    cy = lerp(cy, my, 1 - Math.pow(0.001, dt));
    scrollS = lerp(scrollS, scrollP, 1 - Math.pow(0.0005, dt));

    rig.rotation.y = cx * 0.12 + Math.sin(t * 0.15) * 0.04;
    rig.rotation.x = cy * 0.06;
    rig.position.y = scrollS * 3.2;
    rig.position.z = scrollS * -2.5;
    camera.position.x = cx * 0.35;
    camera.position.y = 0.4 - cy * 0.2;
    camera.position.z = camZ;
    camera.lookAt(0, 0, -3);

    // Screens float; the "live" camera steps forward and glows
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      s.live = lerp(s.live, i === live ? 1 : 0, 1 - Math.pow(0.0004, dt));
      const bob = Math.sin(t * 0.8 + s.phase) * 0.12;
      s.g.position.set(s.baseX, s.baseY + bob + s.live * 0.12, s.baseZ + s.live * 0.9);
      const sc = 1 + s.live * 0.06 + (i === live ? kickEnv * 0.012 : 0);
      s.g.scale.setScalar(sc);
      s.mat.opacity = 0.7 + s.live * 0.3;
      s.mat.color.setScalar(0.62 + s.live * 0.38);
      s.frameMat.opacity = 0.18 + s.live * (0.55 + kickEnv * 0.3);
    }

    // Equalizer: layered sines + kick envelope, like a music analyser
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2;
      const n = 0.5 + 0.5 * Math.sin(a * 3 + t * 2.1) * Math.sin(a * 5 - t * 1.3);
      const h = 0.08 + n * 0.42 + kickEnv * (0.25 + 0.35 * Math.abs(Math.sin(a * 2 + t)));
      dummy.position.set(Math.cos(a) * ringR, 0, Math.sin(a) * ringR);
      dummy.rotation.set(0, -a, 0);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      bars.setMatrixAt(i, dummy.matrix);
    }
    bars.instanceMatrix.needsUpdate = true;
    ring.rotation.y = t * 0.08;
    circle.material.opacity = 0.15 + kickEnv * 0.3;

    // Particles drift upward slowly
    const arr = pGeo.attributes.position.array;
    for (let i = 0; i < P; i++) {
      arr[i * 3 + 1] += dt * (0.12 + (pSeed[i] % 1) * 0.1);
      arr[i * 3] += Math.sin(t * 0.3 + pSeed[i]) * dt * 0.05;
      if (arr[i * 3 + 1] > 7) arr[i * 3 + 1] = -7;
    }
    pGeo.attributes.position.needsUpdate = true;
    pMat.size = 0.08 + kickEnv * 0.025;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  // Wait until at least the first texture is ready so the fade-in shows the full scene.
  setTimeout(() => stage.classList.add('is-ready'), 250);
  kick();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
