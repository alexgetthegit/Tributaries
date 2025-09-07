import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { XRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/XRButton.js';
import { XRControllerModelFactory } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/XRControllerModelFactory.js';

// --- Renderer & scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// WebXR UI button
document.body.appendChild(XRButton.createButton(renderer, { requiredFeatures: ['local-floor'] }));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101114);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);

// Non‑VR fallback: Orbit to inspect the scene on desktop
const orbit = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 1.6, 3);
orbit.target.set(0, 1.5, 0);
orbit.update();

// Lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(5, 10, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 1.0 })
);
ground.rotation.x = -Math.PI/2;
ground.receiveShadow = true;
scene.add(ground);

// Some reference objects
function pillar(x, z, color) {
  const m = new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.6 });
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 2.0, 8, 16), m);
  mesh.position.set(x, 1.5, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
}
pillar(-2.5, -2, 0x8ec5ff);
pillar( 2.5, -2, 0xffc98e);
pillar(-2.5,  2, 0xc98eff);
pillar( 2.5,  2, 0x8effc9);

// A simple grabbable cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x86e1ff, metalness: 0, roughness: 0.3 })
);
cube.position.set(0, 1.0, -1.2);
cube.castShadow = cube.receiveShadow = true;
scene.add(cube);

// Player rig (we'll move this group for locomotion)
const rig = new THREE.Group();
rig.position.set(0, 0, 0);
scene.add(rig);
rig.add(camera);

// Controllers
const controllerModelFactory = new XRControllerModelFactory();

const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);
rig.add(controller1);
rig.add(controller2);

const grip1 = renderer.xr.getControllerGrip(0);
const grip2 = renderer.xr.getControllerGrip(1);
grip1.add(controllerModelFactory.createControllerModel(grip1));
grip2.add(controllerModelFactory.createControllerModel(grip2));
rig.add(grip1);
rig.add(grip2);

// Simple "grab" logic for the cube using distance + grip press
let grabbedBy = null;
function tryGrab(ctrl) {
  if (grabbedBy) return;
  const p = new THREE.Vector3();
  ctrl.getWorldPosition(p);
  if (p.distanceTo(cube.position) < 0.25) {
    grabbedBy = ctrl;
  }
}
function tryRelease(ctrl) {
  if (grabbedBy === ctrl) {
    grabbedBy = null;
  }
}

// Bind squeeze (grip) events
[controller1, controller2].forEach((ctrl) => {
  ctrl.addEventListener('squeezestart', () => tryGrab(ctrl));
  ctrl.addEventListener('squeezeend',   () => tryRelease(ctrl));
});

// Locomotion via thumbstick (left controller): axes[2] (x), axes[3] (y) on Quest Touch
function applyThumbstickLocomotion(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;

  const speed = 2.0; // meters per second
  for (const source of session.inputSources) {
    if (!source.gamepad || !source.handedness) continue;
    if (source.handedness !== 'left') continue;
    const [x0, y0, x1, y1] = source.gamepad.axes; // touch controllers often map x1/y1 for thumbstick
    const sx = (Math.abs(x1) > Math.abs(x0) ? x1 : x0) || 0;
    const sy = (Math.abs(y1) > Math.abs(y0) ? y1 : y0) || 0;

    // Move in the direction the headset is facing (camera yaw)
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    const yaw = euler.y;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-sy * speed * dt);
    const strafe  = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(sx * speed * dt);
    rig.position.add(forward).add(strafe);
  }
}

// Animate
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();

  // Keep grabbed cube attached to controller
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
  }

  renderer.render(scene, camera);
});

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
