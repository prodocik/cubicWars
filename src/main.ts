import * as THREE from "three";
import AABB from "aabb-3d";
import { GameLog } from "./gamelog";
import sweep from "voxel-aabb-sweep";
import {
  BlockId,
  CHUNK_SIZE,
  EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RENDER_DISTANCE,
  VoxelWorld,
} from "./voxelWorld";

interface HotbarItem {
  id: string;
  label: string;
  kind: "block" | "tool";
  block?: BlockId;
  icon?: string;
}

const MOVE_SPEED = 4.35;
const SPRINT_MULTIPLIER = 1.3;
const GRAVITY = 31;
const JUMP_VELOCITY = 8.45;
const LOOK_SENSITIVITY = 0.0022;
const INTERACT_DISTANCE = 6;
const PHYSICS_STEP = 1 / 120;
const MAX_PHYSICS_STEPS = 8;
const GROUND_CHECK = 0.05;
const SAFE_FALL_RESET_Y = -16;
const SWEEP_EPSILON = 1e-4;
const BODY_WIDTH = PLAYER_RADIUS * 2;
const BODY_HEIGHT = PLAYER_HEIGHT;
const BODY_RADIUS = PLAYER_RADIUS;
const HEAD_RADIUS = 0.24;
const HEAD_HALF_HEIGHT = 0.16;

const world = new VoxelWorld();
const gameLog = new GameLog();
const scene = new THREE.Scene();
scene.background = new THREE.Color("#87c7ff");
scene.fog = new THREE.Fog("#87c7ff", CHUNK_SIZE * (RENDER_DISTANCE + 1), CHUNK_SIZE * (RENDER_DISTANCE + 3));
scene.add(world.scene);

const cameraRig = new THREE.Group();
const cameraPitch = new THREE.Group();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 500);
camera.position.set(0, 0, 0);
cameraPitch.add(camera);
cameraRig.add(cameraPitch);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.tabIndex = 1;
document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.background = "#101418";
document.body.appendChild(renderer.domElement);

const light = new THREE.HemisphereLight(0xffffff, 0x496039, 0.95);
scene.add(light);
const sun = new THREE.DirectionalLight(0xffffff, 1.45);
sun.position.set(25, 60, 10);
scene.add(sun);

const debugMaterial = new THREE.LineBasicMaterial({
  color: 0xff5f5f,
  depthTest: false,
  transparent: true,
  opacity: 0.95,
});
const debugHeadMaterial = new THREE.LineBasicMaterial({
  color: 0x55d8ff,
  depthTest: false,
  transparent: true,
  opacity: 0.95,
});
const debugBodyBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_WIDTH)),
  debugMaterial
);
const debugHeadBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(HEAD_RADIUS * 2, HEAD_HALF_HEIGHT * 2, HEAD_RADIUS * 2)),
  debugHeadMaterial
);
debugBodyBox.visible = false;
debugHeadBox.visible = false;
scene.add(debugBodyBox);
scene.add(debugHeadBox);
let debugCollidersVisible = false;

const heldItemPivot = new THREE.Group();
heldItemPivot.position.set(0.58, -0.55, -0.75);
camera.add(heldItemPivot);
let heldItemMesh: THREE.Object3D | null = null;
let swingTime = 0;
let physicsAccumulator = 0;

const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  sprint: false,
  jumpQueued: false,
};

const player = {
  position: world.getSpawnPosition(),
  velocity: new THREE.Vector3(),
  onGround: false,
  lastSafePosition: new THREE.Vector3(),
};
player.lastSafePosition.copy(player.position);

const moveInput = new THREE.Vector3();
const groundMin = new THREE.Vector3();
const groundMax = new THREE.Vector3();
const bodyMin = new THREE.Vector3();
const bodyMax = new THREE.Vector3();
const headMin = new THREE.Vector3();
const headMax = new THREE.Vector3();

const hotbarItems: HotbarItem[] = [
  { id: "grass", label: "Grass", kind: "block", block: BlockId.Grass },
  { id: "dirt", label: "Dirt", kind: "block", block: BlockId.Dirt },
  { id: "stone", label: "Stone", kind: "block", block: BlockId.Stone },
  { id: "log", label: "Log", kind: "block", block: BlockId.Log },
  { id: "leaves", label: "Leaves", kind: "block", block: BlockId.Leaves },
  { id: "axe", label: "Axe", kind: "tool", icon: "🪓" },
  { id: "pickaxe", label: "Pickaxe", kind: "tool", icon: "⛏️" },
  { id: "bow", label: "Bow", kind: "tool", icon: "🏹" },
  { id: "grass2", label: "Grass", kind: "block", block: BlockId.Grass },
];
let selectedSlot = 0;
let yaw = 0;
let pitch = 0;
let pointerLocked = false;

const hud = createHud();
document.body.appendChild(hud.root);
renderHotbar();
setHeldItem(hotbarItems[selectedSlot]);

const title = createTitleScreen();
document.body.appendChild(title.overlay);

wireInput();
window.addEventListener("resize", onResize);

const clock = new THREE.Clock();
animate();

function animate() {
  requestAnimationFrame(animate);
  const frameDt = Math.min(clock.getDelta(), 0.1);

  world.update(player.position.x, player.position.z);
  physicsAccumulator = Math.min(physicsAccumulator + frameDt, PHYSICS_STEP * MAX_PHYSICS_STEPS);
  let physicsSteps = 0;
  while (physicsAccumulator >= PHYSICS_STEP && physicsSteps < MAX_PHYSICS_STEPS) {
    updatePlayer(PHYSICS_STEP);
    physicsAccumulator -= PHYSICS_STEP;
    physicsSteps++;
  }
  if (physicsSteps === MAX_PHYSICS_STEPS) physicsAccumulator = 0;

  updateHeldItem(frameDt);
  updateCamera();
  updateDebugColliders();
  updateHud();

  renderer.render(scene, camera);
}

function updatePlayer(dt: number) {
  if (player.position.y < SAFE_FALL_RESET_Y) {
    respawnPlayer();
    return;
  }

  if (!isPositionSafe(player.position)) {
    recoverPlayer();
    return;
  }

  player.onGround = hasGroundContact(player.position);

  moveInput.set(0, 0, 0);
  if (input.forward) moveInput.z -= 1;
  if (input.back) moveInput.z += 1;
  if (input.left) moveInput.x -= 1;
  if (input.right) moveInput.x += 1;

  if (moveInput.lengthSq() > 0) {
    moveInput.normalize();
    const yawMatrix = new THREE.Matrix4().makeRotationY(yaw);
    moveInput.applyMatrix4(yawMatrix);
    const speed = MOVE_SPEED * (input.sprint ? SPRINT_MULTIPLIER : 1);
    player.velocity.x = moveInput.x * speed;
    player.velocity.z = moveInput.z * speed;
  } else {
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  if (input.jumpQueued && player.onGround) {
    player.velocity.y = JUMP_VELOCITY;
    player.onGround = false;
  }
  input.jumpQueued = false;

  player.velocity.y -= GRAVITY * dt;

  moveWithSweep(player.velocity.x * dt, player.velocity.y * dt, player.velocity.z * dt);

  if (player.velocity.y <= 0 && hasGroundContact(player.position)) {
    player.onGround = true;
    player.velocity.y = 0;
  } else {
    player.onGround = false;
  }

  if (isPositionSafe(player.position)) {
    player.lastSafePosition.copy(player.position);
  } else {
    recoverPlayer();
  }
}

function moveWithSweep(dx: number, dy: number, dz: number) {
  if (dx === 0 && dy === 0 && dz === 0) return;

  const box = getPlayerBox(player.position);
  const vec = [dx, dy, dz] as [number, number, number];

  sweep(getSolidVoxel, box, vec, (_dist: number, axis: number, dir: number, remaining: number[]) => {
    remaining[axis] = 0;
    if (axis === 0) {
      player.velocity.x = 0;
    } else if (axis === 1) {
      player.velocity.y = 0;
      if (dir < 0) player.onGround = true;
    } else if (axis === 2) {
      player.velocity.z = 0;
    }
    return false;
  }, false, SWEEP_EPSILON);

  player.position.set(
    box.base[0] + BODY_RADIUS,
    box.base[1],
    box.base[2] + BODY_RADIUS
  );
}

function respawnPlayer() {
  const spawn = world.getSpawnPosition();
  player.position.copy(spawn);
  player.lastSafePosition.copy(spawn);
  player.velocity.set(0, 0, 0);
  player.onGround = hasGroundContact(spawn);
  physicsAccumulator = 0;
  gameLog.warn("Player reset to safe spawn.");
}

function recoverPlayer() {
  if (isPositionSafe(player.lastSafePosition)) {
    player.position.copy(player.lastSafePosition);
    player.velocity.set(0, 0, 0);
    player.onGround = hasGroundContact(player.position);
    physicsAccumulator = 0;
    return;
  }
  respawnPlayer();
}

function isPositionSafe(position: THREE.Vector3) {
  return !bodyCollidesAt(position) && !headCollidesAt(position);
}

function updateCamera() {
  cameraRig.position.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  cameraRig.rotation.y = yaw;
  cameraPitch.rotation.x = pitch;
  camera.position.set(0, 0, 0);
}

function hasGroundContact(position: THREE.Vector3) {
  groundMin.set(
    position.x - BODY_RADIUS + SWEEP_EPSILON,
    position.y - GROUND_CHECK,
    position.z - BODY_RADIUS + SWEEP_EPSILON
  );
  groundMax.set(
    position.x + BODY_RADIUS - SWEEP_EPSILON,
    position.y,
    position.z + BODY_RADIUS - SWEEP_EPSILON
  );
  return world.collides(groundMin, groundMax);
}

function getPlayerBox(position: THREE.Vector3) {
  return new AABB(
    [position.x - BODY_RADIUS, position.y, position.z - BODY_RADIUS],
    [BODY_RADIUS * 2, BODY_HEIGHT, BODY_RADIUS * 2]
  );
}

function getSolidVoxel(x: number, y: number, z: number) {
  return world.isCollidable(world.getBlock(x, y, z));
}

function bodyCollidesAt(position: THREE.Vector3) {
  bodyMin.set(
    position.x - BODY_RADIUS + SWEEP_EPSILON,
    position.y + SWEEP_EPSILON,
    position.z - BODY_RADIUS + SWEEP_EPSILON
  );
  bodyMax.set(
    position.x + BODY_RADIUS - SWEEP_EPSILON,
    position.y + BODY_HEIGHT - SWEEP_EPSILON,
    position.z + BODY_RADIUS - SWEEP_EPSILON
  );
  return world.collides(bodyMin, bodyMax);
}

function headCollidesAt(position: THREE.Vector3) {
  const centerY = position.y + EYE_HEIGHT;
  headMin.set(
    position.x - HEAD_RADIUS + SWEEP_EPSILON,
    centerY - HEAD_HALF_HEIGHT + SWEEP_EPSILON,
    position.z - HEAD_RADIUS + SWEEP_EPSILON
  );
  headMax.set(
    position.x + HEAD_RADIUS - SWEEP_EPSILON,
    centerY + HEAD_HALF_HEIGHT - SWEEP_EPSILON,
    position.z + HEAD_RADIUS - SWEEP_EPSILON
  );
  return world.collides(headMin, headMax);
}

function updateHeldItem(dt: number) {
  if (!heldItemMesh) return;

  const moveAmount = Number(input.forward || input.back || input.left || input.right);
  const bob = moveAmount ? Math.sin(performance.now() * 0.01) * 0.03 : 0;
  swingTime = Math.max(0, swingTime - dt * 6);
  const swing = Math.sin((1 - swingTime) * Math.PI);

  heldItemPivot.position.set(0.58, -0.55 + bob, -0.75 + Math.abs(bob) * 0.5);
  heldItemPivot.rotation.set(-0.25 - swing * 0.6, 0.55 + swing * 0.45, 0.12 + swing * 0.25);
}

function wireInput() {
  renderer.domElement.addEventListener("click", () => {
    renderer.domElement.focus();
    if (!pointerLocked) renderer.domElement.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    title.overlay.style.display = pointerLocked ? "none" : "flex";
  });

  window.addEventListener("mousemove", (event) => {
    if (!pointerLocked) return;
    yaw -= event.movementX * LOOK_SENSITIVITY;
    pitch -= event.movementY * LOOK_SENSITIVITY;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  });

  window.addEventListener("keydown", (event) => {
    switch (event.code) {
      case "KeyW":
      case "ArrowUp":
        input.forward = true;
        event.preventDefault();
        break;
      case "KeyS":
      case "ArrowDown":
        input.back = true;
        event.preventDefault();
        break;
      case "KeyA":
      case "ArrowLeft":
        input.left = true;
        event.preventDefault();
        break;
      case "KeyD":
      case "ArrowRight":
        input.right = true;
        event.preventDefault();
        break;
      case "ShiftLeft":
      case "ShiftRight":
        input.sprint = true;
        break;
      case "Space":
        if (pointerLocked) input.jumpQueued = true;
        event.preventDefault();
        break;
      case "Digit1": selectSlot(0); break;
      case "Digit2": selectSlot(1); break;
      case "Digit3": selectSlot(2); break;
      case "Digit4": selectSlot(3); break;
      case "Digit5": selectSlot(4); break;
      case "Digit6": selectSlot(5); break;
      case "Digit7": selectSlot(6); break;
      case "Digit8": selectSlot(7); break;
      case "Digit9": selectSlot(8); break;
      case "F3":
        toggleDebugColliders();
        event.preventDefault();
        break;
      case "Escape":
        document.exitPointerLock();
        break;
    }
  });

  window.addEventListener("keyup", (event) => {
    switch (event.code) {
      case "KeyW":
      case "ArrowUp":
        input.forward = false;
        break;
      case "KeyS":
      case "ArrowDown":
        input.back = false;
        break;
      case "KeyA":
      case "ArrowLeft":
        input.left = false;
        break;
      case "KeyD":
      case "ArrowRight":
        input.right = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        input.sprint = false;
        break;
    }
  });

  window.addEventListener("wheel", (event) => {
    const direction = event.deltaY > 0 ? 1 : -1;
    const next = (selectedSlot + direction + hotbarItems.length) % hotbarItems.length;
    selectSlot(next);
  }, { passive: true });

  window.addEventListener("mousedown", (event) => {
    if (!pointerLocked) return;
    if (event.button === 0) {
      breakBlock();
    } else if (event.button === 2) {
      placeBlock();
    }
    swingTime = 1;
  });

  window.addEventListener("contextmenu", (event) => event.preventDefault());
}

function breakBlock() {
  const hit = getTargetedBlock();
  if (!hit) return;
  world.setBlock(hit.block.x, hit.block.y, hit.block.z, BlockId.Air);
}

function placeBlock() {
  const selected = hotbarItems[selectedSlot];
  if (selected.kind !== "block" || selected.block === undefined) return;

  const hit = getTargetedBlock();
  if (!hit) return;
  const place = hit.place;

  if (intersectsPlayer(place)) return;
  world.setBlock(place.x, place.y, place.z, selected.block);
}

function getTargetedBlock() {
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return world.raycast(origin, direction, INTERACT_DISTANCE);
}

function intersectsPlayer(block: THREE.Vector3) {
  const min = new THREE.Vector3(block.x, block.y, block.z);
  const max = new THREE.Vector3(block.x + 1, block.y + 1, block.z + 1);
  const playerMin = new THREE.Vector3(player.position.x - BODY_RADIUS, player.position.y, player.position.z - BODY_RADIUS);
  const playerMax = new THREE.Vector3(player.position.x + BODY_RADIUS, player.position.y + BODY_HEIGHT, player.position.z + BODY_RADIUS);
  return (
    min.x < playerMax.x && max.x > playerMin.x &&
    min.y < playerMax.y && max.y > playerMin.y &&
    min.z < playerMax.z && max.z > playerMin.z
  );
}

function selectSlot(index: number) {
  selectedSlot = index;
  renderHotbar();
  setHeldItem(hotbarItems[index]);
  gameLog.system(`Selected: ${hotbarItems[index].label}`);
}

function setHeldItem(item: HotbarItem) {
  if (heldItemMesh) {
    heldItemPivot.remove(heldItemMesh);
    heldItemMesh = null;
  }

  let mesh: THREE.Object3D;
  if (item.kind === "block" && item.block !== undefined) {
    mesh = world.createBlockPreview(item.block);
    mesh.rotation.set(0.35, 0.65, 0);
    mesh.position.set(0.1, -0.1, 0);
  } else if (item.id === "axe") {
    mesh = createAxeMesh();
  } else if (item.id === "pickaxe") {
    mesh = createPickaxeMesh();
  } else {
    mesh = createBowMesh();
  }

  heldItemMesh = mesh;
  heldItemPivot.add(mesh);
}

function createAxeMesh() {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.75, 0.09), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
  handle.rotation.z = -0.35;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.12), new THREE.MeshLambertMaterial({ color: 0xc4c9d1 }));
  head.position.set(0.12, 0.28, 0);
  head.rotation.z = 0.2;
  group.add(handle, head);
  group.rotation.set(0.4, 0.85, 0.2);
  return group;
}

function createPickaxeMesh() {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, 0.09), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
  handle.rotation.z = -0.22;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0xc4c9d1 }));
  head.position.set(0.02, 0.28, 0);
  head.rotation.z = 0.2;
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.1), new THREE.MeshLambertMaterial({ color: 0xc4c9d1 }));
  tip.position.set(0.22, 0.28, 0);
  tip.rotation.z = 0.55;
  group.add(handle, head, tip);
  group.rotation.set(0.4, 0.95, 0.15);
  return group;
}

function createBowMesh() {
  const group = new THREE.Group();
  const bowMat = new THREE.MeshLambertMaterial({ color: 0x7b542c });
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xe7e1c8 });
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), bowMat);
  left.position.set(-0.1, 0.05, 0);
  left.rotation.z = 0.4;
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), bowMat);
  right.position.set(0.1, 0.05, 0);
  right.rotation.z = -0.4;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.09), bowMat);
  const string = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.95, 0.01), stringMat);
  string.position.set(0, 0.03, -0.04);
  group.add(left, right, grip, string);
  group.rotation.set(0.5, 1.05, 0.25);
  return group;
}

function createHud() {
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;font-family:monospace;color:#fff";

  const crosshair = document.createElement("div");
  crosshair.style.cssText = "position:absolute;left:50%;top:50%;width:16px;height:16px;transform:translate(-50%,-50%)";
  crosshair.innerHTML = '<div style="position:absolute;left:7px;top:0;width:2px;height:16px;background:#fff"></div><div style="position:absolute;left:0;top:7px;width:16px;height:2px;background:#fff"></div>';

  const info = document.createElement("div");
  info.style.cssText = "position:absolute;top:12px;left:12px;display:flex;flex-direction:column;gap:4px;text-shadow:0 2px 6px rgba(0,0,0,0.75)";

  const coords = document.createElement("div");
  coords.style.cssText = "font-size:12px";

  const chunk = document.createElement("div");
  chunk.style.cssText = "font-size:12px;color:#d3f1d5";

  const hint = document.createElement("div");
  hint.style.cssText = "position:absolute;left:50%;bottom:88px;transform:translateX(-50%);padding:6px 10px;border-radius:10px;background:rgba(0,0,0,0.38);font-size:12px;color:#deedde";
  hint.textContent = "WASD move, Space jump, LMB break, RMB place, wheel or 1-9 select";

  const hotbar = document.createElement("div");
  hotbar.style.cssText = "position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:6px;pointer-events:none";

  info.append(coords, chunk);
  root.append(crosshair, info, hint, hotbar);

  return { root, coords, chunk, hint, hotbar };
}

function renderHotbar() {
  hud.hotbar.innerHTML = "";
  for (let i = 0; i < hotbarItems.length; i++) {
    const item = hotbarItems[i];
    const slot = document.createElement("div");
    slot.style.cssText = [
      "width:58px;height:58px;border-radius:10px;display:flex;align-items:center;justify-content:center;position:relative",
      i === selectedSlot ? "border:3px solid #f2d472;background:rgba(32,34,24,0.92)" : "border:2px solid rgba(255,255,255,0.2);background:rgba(10,14,18,0.7)"
    ].join(";");

    const key = document.createElement("span");
    key.textContent = String((i + 1) % 10 || 0);
    key.style.cssText = "position:absolute;top:3px;left:5px;font-size:9px;color:#9db0bc";
    slot.appendChild(key);

    if (item.kind === "block" && item.block !== undefined) {
      const icon = document.createElement("canvas");
      icon.width = 32;
      icon.height = 32;
      const ctx = icon.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const atlas = world.atlas.image as HTMLCanvasElement;
      const tile = tileIndexForBlock(item.block);
      ctx.drawImage(atlas, tile * 16, 0, 16, 16, 0, 0, 32, 32);
      slot.appendChild(icon);
    } else {
      const icon = document.createElement("div");
      icon.textContent = item.icon || "?";
      icon.style.cssText = "font-size:28px;line-height:1";
      slot.appendChild(icon);
    }

    hud.hotbar.appendChild(slot);
  }
}

function tileIndexForBlock(block: BlockId) {
  if (block === BlockId.Grass) return 0;
  if (block === BlockId.Dirt) return 2;
  if (block === BlockId.Stone) return 3;
  if (block === BlockId.Log) return 4;
  if (block === BlockId.Leaves) return 6;
  return 3;
}

function updateHud() {
  hud.coords.textContent = `XYZ ${player.position.x.toFixed(1)} ${player.position.y.toFixed(1)} ${player.position.z.toFixed(1)}`;
  hud.chunk.textContent = `Chunk ${Math.floor(player.position.x / CHUNK_SIZE)}, ${Math.floor(player.position.z / CHUNK_SIZE)}${debugCollidersVisible ? " | debug hitbox" : ""}`;
}

function createTitleScreen() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at top,#284664 0%,#0b1118 62%);z-index:30;font-family:monospace;color:#fff";

  const box = document.createElement("div");
  box.style.cssText = "width:min(92vw,460px);padding:28px;border-radius:18px;background:rgba(7,11,16,0.78);border:1px solid rgba(255,255,255,0.14);box-shadow:0 20px 80px rgba(0,0,0,0.45)";

  const title = document.createElement("div");
  title.textContent = "Cubic";
  title.style.cssText = "font-size:38px;font-weight:bold;letter-spacing:0.08em;margin-bottom:8px";

  const subtitle = document.createElement("div");
  subtitle.textContent = "Minecraft-first prototype: infinite chunks, mining, placing, FPS camera";
  subtitle.style.cssText = "font-size:13px;color:#c1d9f1;line-height:1.5;margin-bottom:18px";

  const button = document.createElement("button");
  button.textContent = "Start";
  button.style.cssText = "padding:14px 18px;width:100%;border:none;border-radius:12px;background:linear-gradient(135deg,#5ab95f,#2d89c8);color:#fff;font:600 15px monospace;cursor:pointer";
  button.onclick = () => renderer.domElement.requestPointerLock();

  const note = document.createElement("div");
  note.textContent = "Render distance: 7x7 chunks. Textured blocks, held items, block break/place included.";
  note.style.cssText = "margin-top:14px;font-size:11px;color:#9fb0bd";

  box.append(title, subtitle, button, note);
  overlay.appendChild(box);
  return { overlay };
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function toggleDebugColliders() {
  debugCollidersVisible = !debugCollidersVisible;
  debugBodyBox.visible = debugCollidersVisible;
  debugHeadBox.visible = debugCollidersVisible;
  gameLog.system(`Debug hitbox ${debugCollidersVisible ? "ON" : "OFF"}`);
}

function updateDebugColliders() {
  if (!debugCollidersVisible) return;

  debugBodyBox.position.set(player.position.x, player.position.y + BODY_HEIGHT / 2, player.position.z);
  debugHeadBox.position.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
}
