import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { XRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/XRButton.js';
import { XRControllerModelFactory } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/XRControllerModelFactory.js';

// ===== Renderer & scene =====
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// WebXR UI button (permissive features for broader compatibility)
document.body.appendChild(
  XRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'local']
  })
);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0c10);
scene.fog = new THREE.FogExp2(0x0a0c10, 0.03);

// ===== Camera & non-VR orbit (desktop preview) =====
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
const orbit = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 1.6, 5);
orbit.target.set(0, 1.4, 0);
orbit.update();

// ===== Lighting =====
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x0a0c10, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(10, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// ===== Sky dome (simple gradient) =====
const skyGeo = new THREE.SphereGeometry(200, 32, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    topColor:    { value: new THREE.Color(0x153b6d) },
    bottomColor: { value: new THREE.Color(0x0a0c10) },
    offset:      { value: 0.0 },
    exponent:    { value: 0.8 },
  },
  vertexShader: `varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }`,
  fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent;
  varying vec3 vWorldPosition;
  void main() {
    float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
    float f = max(pow(max(h, 0.0), exponent), 0.0);
    gl_FragColor = vec4(mix(bottomColor, topColor, f), 1.0);
  }`
});
scene.add(new THREE.Mesh(skyGeo, skyMat));

// ===== Ground (gentle undulation) =====
const GROUND_SIZE = 200;
const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 200, 200);
groundGeo.rotateX(-Math.PI / 2);
const pos = groundGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  const h = 0.3 * Math.sin(x * 0.05) * Math.cos(z * 0.05); // subtle rolling hills
  pos.setY(i, h);
}
pos.needsUpdate = true;
groundGeo.computeVertexNormals();
const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshStandardMaterial({ color: 0x1e232b, roughness: 0.95, metalness: 0.0 })
);
ground.receiveShadow = true;
scene.add(ground);

// ===== Helper spline & ribbon for rivers =====
function makeCurve(points) {
  return new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.1);
}
function makeRibbonFromCurve(curve, halfWidth, color) {
  const segments = 200;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const normals = new Float32Array((segments + 1) * 2 * 3);
  const indices = [];
  const up = new THREE.Vector3(0,1,0);
  const binormal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const left = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPoint(t);
    const pNext = curve.getPoint(Math.min(1, t + 1/segments));
    tangent.copy(pNext).sub(p).normalize();
    binormal.crossVectors(up, tangent).normalize();
    left.copy(binormal).multiplyScalar(halfWidth);
    const r = p.clone().add(left);
    const l = p.clone().addScaledVector(left, -1);
    const ii = i * 2 * 3;
    positions[ii+0] = l.x; positions[ii+1] = l.y + 0.02; positions[ii+2] = l.z;
    positions[ii+3] = r.x; positions[ii+4] = r.y + 0.02; positions[ii+5] = r.z;
    normals[ii+0] = 0; normals[ii+1] = 1; normals[ii+2] = 0;
    normals[ii+3] = 0; normals[ii+4] = 1; normals[ii+5] = 0;
    if (i < segments) {
      const a = i*2, b = i*2+1, c = i*2+2, d = i*2+3;
      indices.push(a,b,c, b,d,c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// ===== Rivers (two tributaries merging into a lake) =====
const calmCurve = makeCurve([
  [-40, 0.0, -40], [-25, 0.0, -25], [-12, 0.0, -14], [-4, 0.0, -8], [-1, 0.0, -3], [0, 0.0, 0]
]);
const rushCurve = makeCurve([
  [ 40, 0.0, -42], [ 24, 0.0, -26], [ 10, 0.0, -16], [ 4, 0.0, -9], [ 1, 0.0, -4], [0, 0.0, 0]
]);
const calmRiver = makeRibbonFromCurve(calmCurve, 2.6, 0x2b6c99);
const rushRiver = makeRibbonFromCurve(rushCurve, 3.2, 0x2a4c7a);
scene.add(calmRiver, rushRiver);

// Lake at the merge point
const lake = new THREE.Mesh(
  new THREE.CircleGeometry(10, 64),
  new THREE.MeshStandardMaterial({ color: 0x224463, roughness: 0.3, metalness: 0.05 })
);
lake.rotation.x = -Math.PI / 2;
lake.position.set(0, 0.015, 2);
lake.receiveShadow = true;
scene.add(lake);

// ===== Trees (instanced low-poly) =====
function makeTreePrototype() {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.9, 6),
    new THREE.MeshStandardMaterial({ color: 0x6d4b3b, roughness: 0.9 })
  );
  trunk.position.y = 0.45;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d6b4e, roughness: 0.7 })
  );
  crown.position.y = 1.5;
  const g = new THREE.Group();
  g.add(trunk, crown);
  return g;
}

function nearestDistanceToCurve(curve, x, z) {
  let best = 1e9;
  for (let i = 0; i <= 100; i++) {
    const p = curve.getPoint(i/100);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) best = d;
  }
  return best;
}
function notInWaterOrBank(x,z) {
  const distLake = Math.hypot(x - 0, z - 2);
  if (distLake < 12) return false;
  const nearCalm = nearestDistanceToCurve(calmCurve, x, z);
  const nearRush = nearestDistanceToCurve(rushCurve, x, z);
  return (nearCalm > 4 && nearRush > 5);
}

function scatterTrees(count) {
  const proto = makeTreePrototype();
  const dummy = new THREE.Object3D();
  const crowns = new THREE.InstancedMesh(proto.children[1].geometry, proto.children[1].material, count);
  const trunks = new THREE.InstancedMesh(proto.children[0].geometry, proto.children[0].material, count);
  let placed = 0;
  while (placed < count) {
    const x = (Math.random()-0.5) * 160;
    const z = (Math.random()-0.5) * 160;
    if (!notInWaterOrBank(x, z)) continue;
    const s = 0.8 + Math.random()*0.6;
    dummy.position.set(x, 0, z);
    dummy.scale.setScalar(s);
    dummy.rotation.y = Math.random()*Math.PI*2;
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    trunks.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  crowns.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  scene.add(crowns, trunks);
}
scatterTrees(400);

// ===== Player rig & controllers =====
const rig = new THREE.Group();
rig.position.set(0, 0, 8);
scene.add(rig);
rig.add(camera);

const controllerModelFactory = new XRControllerModelFactory();
const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);
rig.add(controller1, controller2);
const grip1 = renderer.xr.getControllerGrip(0);
const grip2 = renderer.xr.getControllerGrip(1);
grip1.add(controllerModelFactory.createControllerModel(grip1));
grip2.add(controllerModelFactory.createControllerModel(grip2));
rig.add(grip1, grip2);

// ===== Grabbable test cube =====
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x86e1ff, metalness: 0, roughness: 0.3 })
);
cube.position.set(0.5, 1.0, 6.5);
cube.castShadow = cube.receiveShadow = true;
scene.add(cube);

let grabbedBy = null;
function tryGrab(ctrl) {
  if (grabbedBy) return;
  const p = new THREE.Vector3();
  ctrl.getWorldPosition(p);
  if (p.distanceTo(cube.position) < 0.25) grabbedBy = ctrl;
}
function tryRelease(ctrl) { if (grabbedBy === ctrl) grabbedBy = null; }
[controller1, controller2].forEach((c)=>{
  c.addEventListener('squeezestart', ()=>tryGrab(c));
  c.addEventListener('squeezeend', ()=>tryRelease(c));
});

// ===== Locomotion (left stick) =====
function applyThumbstickLocomotion(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;
  const speed = 2.0;
  for (const source of session.inputSources) {
    if (!source.gamepad || source.handedness !== 'left') continue;
    const [x0, y0, x1, y1] = source.gamepad.axes;
    const sx = (Math.abs(x1) > Math.abs(x0) ? x1 : x0) || 0;
    const sy = (Math.abs(y1) > Math.abs(y0) ? y1 : y0) || 0;
    const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-sy * speed * dt);
    const strafe  = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(sx * speed * dt);
    rig.position.add(forward).add(strafe);
  }
}

// ===== Audio crossfade between zones (optional if you add /audio files) =====
const listener = new THREE.AudioListener();
camera.add(listener);
const calmAudio = new THREE.Audio(listener);
const rushAudio = new THREE.Audio(listener);
const audioLoader = new THREE.AudioLoader();

// Load if present (won't error if 404, it just won't play)
audioLoader.load('audio/calm.mp3', buffer => { calmAudio.setBuffer(buffer); calmAudio.setLoop(true); calmAudio.setVolume(0.0); }, undefined, ()=>{});
audioLoader.load('audio/rushing.mp3', buffer => { rushAudio.setBuffer(buffer); rushAudio.setLoop(true); rushAudio.setVolume(0.0); }, undefined, ()=>{});

let audioStarted = false;
function ensureAudioStarted() {
  if (audioStarted || !renderer.xr.isPresenting) return;
  const ctx = listener.context;
  if (ctx.state === 'suspended') ctx.resume();
  if (calmAudio.buffer && !calmAudio.isPlaying) calmAudio.play();
  if (rushAudio.buffer && !rushAudio.isPlaying) rushAudio.play();
  audioStarted = true;
}
function distanceToCurveXZ(curve, x, z) {
  let best = 1e9;
  for (let i = 0; i <= 100; i++) {
    const p = curve.getPoint(i/100);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) best = d;
  }
  return best;
}
function updateAudio(dt) {
  if (!audioStarted) return;
  const pos = rig.position;
  const dCalm = distanceToCurveXZ(calmCurve, pos.x, pos.z);
  const dRush = distanceToCurveXZ(rushCurve, pos.x, pos.z);
  const wCalm = 1.0 / (0.001 + dCalm);
  const wRush = 1.0 / (0.001 + dRush);
  const sum = wCalm + wRush;
  const tCalm = wCalm / sum;
  const tRush = wRush / sum;
  const fade = 1.5; // seconds
  calmAudio.setVolume(THREE.MathUtils.damp(calmAudio.getVolume(), tCalm, fade, dt));
  rushAudio.setVolume(THREE.MathUtils.damp(rushAudio.getVolume(), tRush, fade, dt));
}

// ===== Animate =====
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();

  // Grabbed cube follows controller
  if (grabbedBy) {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    grabbedBy.getWorldPosition(p);
    grabbedBy.getWorldQuaternion(q);
    cube.position.copy(p);
    cube.quaternion.copy(q);
  }

  if (renderer.xr.isPresenting) {
    applyThumbstickLocomotion(dt);
    ensureAudioStarted();
    updateAudio(dt);
  }

  renderer.render(scene, camera);
});

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
