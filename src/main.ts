import * as THREE from "three";
import AABB from "aabb-3d";
import { GameLog } from "./gamelog";
import sweep from "voxel-aabb-sweep";
import {
  DEFAULT_SERVER_PORT,
  SERVER_TICK_RATE,
  type RemotePlayerState,
  type ServerMessage,
} from "./multiplayerProtocol";
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

interface RemoteAvatar {
  id: string;
  name: string;
  appearanceSeed: number;
  root: THREE.Group;
  headPitch: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  heldPivot: THREE.Group;
  heldItemMesh: THREE.Object3D | null;
  label: THREE.Sprite;
  bubble: THREE.Sprite;
  targetPosition: THREE.Vector3;
  targetYaw: number;
  targetPitch: number;
  heldItemId: string;
  lastVisualPosition: THREE.Vector3;
  walkPhase: number;
  bubbleExpiresAt: number;
  dead: boolean;
  deathTime: number;
  soul: THREE.Group | null;
}

interface TitleScreenUi {
  overlay: HTMLDivElement;
  subtitle: HTMLDivElement;
  form: HTMLDivElement;
  nameInput: HTMLInputElement;
  serverInput: HTMLInputElement;
  button: HTMLButtonElement;
  note: HTMLDivElement;
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
const SAFE_FALL_RESET_Y = -8;
const SWEEP_EPSILON = 1e-4;
const REMOTE_SMOOTHING = 14;
const CHAT_BUBBLE_DURATION_MS = 7000;
const MAX_CHAT_LENGTH = 120;
const ARROW_SPEED = 48;
const ARROW_MAX_DISTANCE = CHUNK_SIZE * (RENDER_DISTANCE + 2);
const ARROW_GRAVITY = 14;
const MAX_STUCK_ARROWS = 20;
const BOW_COOLDOWN = 0.5;
const MAX_HP = 100;
const RESPAWN_COUNTDOWN = 5;
const ARROW_HIT_RADIUS = 0.8;
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
const remotePlayersLayer = new THREE.Group();
scene.add(remotePlayersLayer);
const arrowsLayer = new THREE.Group();
scene.add(arrowsLayer);

interface FlyingArrow {
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  origin: THREE.Vector3;
  alive: boolean;
  shooterId: string;
}

interface StuckArrow {
  mesh: THREE.Group;
  expiresAt: number;
}

const flyingArrows: FlyingArrow[] = [];
const stuckArrows: StuckArrow[] = [];
const STUCK_ARROW_LIFETIME = 30;

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
let lastShotTime = 0;
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
  hp: MAX_HP,
  dead: false,
  deathCountdown: 0,
};
player.lastSafePosition.copy(player.position);

const moveInput = new THREE.Vector3();
const groundMin = new THREE.Vector3();
const groundMax = new THREE.Vector3();
const bodyMin = new THREE.Vector3();
const bodyMax = new THREE.Vector3();
const headMin = new THREE.Vector3();
const headMax = new THREE.Vector3();
const tempHslB = { h: 0, s: 0, l: 0 };

const remotePlayers = new Map<string, RemoteAvatar>();
const networkState = {
  ws: null as WebSocket | null,
  connected: false,
  connecting: false,
  started: false,
  myId: "",
  playerName: "",
  appearanceSeed: 0,
  serverUrl: getDefaultServerUrl(),
  serverCandidates: [] as string[],
  currentServerIndex: 0,
  reconnectTimer: 0 as number,
  pageActive: document.visibilityState === "visible" && document.hasFocus(),
  lastError: "",
};
const chatState = {
  open: false,
  restorePointerLock: false,
};

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
document.body.appendChild(hud.deathOverlay);
renderHotbar();
setHeldItem(hotbarItems[selectedSlot]);
updateHpBar();

const title: TitleScreenUi = createTitleScreen();
document.body.appendChild(title.overlay);
updateTitleScreen();

wireInput();
window.addEventListener("resize", onResize);

const clock = new THREE.Clock();
window.setInterval(() => sendLocalPlayerState(false), Math.round(1000 / SERVER_TICK_RATE));
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

  updateDeathState(frameDt);
  updateHeldItem(frameDt);
  updateArrows(frameDt);
  updateStuckArrows();
  updateRemotePlayers(frameDt);
  updateRemoteDeathAnimations(frameDt);
  updateCamera();
  updateDebugColliders();
  updateHud();

  renderer.render(scene, camera);
}

function updatePlayer(dt: number) {
  if (player.dead) return;

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
  // Try pushing upward to escape placed blocks
  const probe = player.position.clone();
  for (let dy = 1; dy <= 8; dy++) {
    probe.y = player.position.y + dy;
    if (isPositionSafe(probe)) {
      player.position.copy(probe);
      player.lastSafePosition.copy(probe);
      player.velocity.set(0, 0, 0);
      player.onGround = false;
      physicsAccumulator = 0;
      return;
    }
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

function openChatInput() {
  if (chatState.open || !networkState.started) return;
  chatState.open = true;
  chatState.restorePointerLock = pointerLocked;
  if (pointerLocked) {
    document.exitPointerLock();
  }
  hud.chatWrap.style.display = "block";
  hud.chatInput.value = "";
  window.setTimeout(() => {
    hud.chatInput.focus();
    hud.chatInput.select();
  }, 0);
  updateTitleScreen();
}

function closeChatInput(restorePointerLock = chatState.restorePointerLock) {
  chatState.open = false;
  chatState.restorePointerLock = false;
  hud.chatWrap.style.display = "none";
  hud.chatInput.blur();
  hud.chatInput.value = "";
  updateTitleScreen();
  if (restorePointerLock && networkState.started) {
    renderer.domElement.requestPointerLock();
  }
}

function sendChatMessage(text: string) {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LENGTH);
  if (!trimmed) return;
  if (!networkState.connected || !networkState.ws || networkState.ws.readyState !== WebSocket.OPEN) {
    gameLog.warn("Chat unavailable while offline.");
    return;
  }
  networkState.ws.send(JSON.stringify({ type: "chat", text: trimmed }));
}

function isTypingInUi(target: EventTarget | null) {
  const element = target instanceof Element ? target : document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}

function wireInput() {
  hud.chatInput.addEventListener("keydown", (event) => {
    if (event.code === "Enter") {
      event.preventDefault();
      const text = hud.chatInput.value;
      closeChatInput(true);
      sendChatMessage(text);
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      closeChatInput(true);
    }
  });

  renderer.domElement.addEventListener("click", () => {
    renderer.domElement.focus();
    if (!pointerLocked) renderer.domElement.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    updateTitleScreen();
  });

  window.addEventListener("blur", () => {
    networkState.pageActive = false;
    updateTitleScreen();
  });

  window.addEventListener("focus", () => {
    networkState.pageActive = document.visibilityState === "visible";
    updateTitleScreen();
  });

  document.addEventListener("visibilitychange", () => {
    networkState.pageActive = document.visibilityState === "visible" && document.hasFocus();
    updateTitleScreen();
  });

  window.addEventListener("mousemove", (event) => {
    if (!pointerLocked) return;
    yaw -= event.movementX * LOOK_SENSITIVITY;
    pitch -= event.movementY * LOOK_SENSITIVITY;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  });

  window.addEventListener("keydown", (event) => {
    if (isTypingInUi(event.target)) return;

    switch (event.code) {
      case "KeyW":
      case "ArrowUp":
        if (!pointerLocked) break;
        input.forward = true;
        event.preventDefault();
        break;
      case "KeyS":
      case "ArrowDown":
        if (!pointerLocked) break;
        input.back = true;
        event.preventDefault();
        break;
      case "KeyA":
      case "ArrowLeft":
        if (!pointerLocked) break;
        input.left = true;
        event.preventDefault();
        break;
      case "KeyD":
      case "ArrowRight":
        if (!pointerLocked) break;
        input.right = true;
        event.preventDefault();
        break;
      case "ShiftLeft":
      case "ShiftRight":
        if (!pointerLocked) break;
        input.sprint = true;
        break;
      case "Space":
        if (pointerLocked) input.jumpQueued = true;
        if (pointerLocked) event.preventDefault();
        break;
      case "Enter":
      case "NumpadEnter":
        if (pointerLocked) {
          openChatInput();
          event.preventDefault();
        }
        break;
      case "Digit1":
        if (pointerLocked) selectSlot(0);
        break;
      case "Digit2":
        if (pointerLocked) selectSlot(1);
        break;
      case "Digit3":
        if (pointerLocked) selectSlot(2);
        break;
      case "Digit4":
        if (pointerLocked) selectSlot(3);
        break;
      case "Digit5":
        if (pointerLocked) selectSlot(4);
        break;
      case "Digit6":
        if (pointerLocked) selectSlot(5);
        break;
      case "Digit7":
        if (pointerLocked) selectSlot(6);
        break;
      case "Digit8":
        if (pointerLocked) selectSlot(7);
        break;
      case "Digit9":
        if (pointerLocked) selectSlot(8);
        break;
      case "F3":
        toggleDebugColliders();
        event.preventDefault();
        break;
      case "Escape":
        if (chatState.open) {
          closeChatInput(false);
        } else {
          document.exitPointerLock();
        }
        break;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (isTypingInUi(event.target)) return;

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
    if (!pointerLocked || isTypingInUi(event.target)) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    const next = (selectedSlot + direction + hotbarItems.length) % hotbarItems.length;
    selectSlot(next);
  }, { passive: true });

  window.addEventListener("mousedown", (event) => {
    if (!pointerLocked || player.dead) return;
    if (event.button === 0) {
      const selected = hotbarItems[selectedSlot];
      if (selected.id === "bow") {
        shootArrow();
      } else {
        breakBlock();
      }
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
  const block = world.getBlock(hit.block.x, hit.block.y, hit.block.z);
  if (block === BlockId.Bedrock) return;
  world.setBlock(hit.block.x, hit.block.y, hit.block.z, BlockId.Air);
  sendBlockUpdate(hit.block.x, hit.block.y, hit.block.z, BlockId.Air);
}

function placeBlock() {
  const selected = hotbarItems[selectedSlot];
  if (selected.kind !== "block" || selected.block === undefined) return;

  const hit = getTargetedBlock();
  if (!hit) return;
  const place = hit.place;

  if (intersectsPlayer(place)) return;
  world.setBlock(place.x, place.y, place.z, selected.block);
  sendBlockUpdate(place.x, place.y, place.z, selected.block);
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
  sendLocalPlayerState(true);
}

function setHeldItem(item: HotbarItem) {
  if (heldItemMesh) {
    heldItemPivot.remove(heldItemMesh);
    heldItemMesh = null;
  }

  const mesh = createHeldMeshFromToken(heldItemTokenForItem(item));
  heldItemMesh = mesh;
  heldItemPivot.add(mesh);
}

function heldItemTokenForItem(item: HotbarItem) {
  if (item.kind === "block" && item.block !== undefined) {
    return `block:${item.block}`;
  }
  return item.id;
}

function getCurrentHeldItemToken() {
  return heldItemTokenForItem(hotbarItems[selectedSlot]);
}

function createHeldMeshFromToken(token: string) {
  let mesh: THREE.Object3D;
  if (token.startsWith("block:")) {
    const block = Number(token.slice(6)) as BlockId;
    mesh = world.createBlockPreview(block);
    mesh.rotation.set(0.35, 0.65, 0);
    mesh.position.set(0.1, -0.1, 0);
    return mesh;
  }

  if (token === "axe") {
    mesh = createAxeMesh();
  } else if (token === "pickaxe") {
    mesh = createPickaxeMesh();
  } else {
    mesh = createBowMesh();
  }
  return mesh;
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

function createArrowMesh() {
  const group = new THREE.Group();
  const shaftMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
  const tipMat = new THREE.MeshLambertMaterial({ color: 0xaab0b8 });
  const fletchMat = new THREE.MeshLambertMaterial({ color: 0xd4d0c8 });

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), shaftMat);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.18), tipMat);
  tip.position.z = 0.55;
  const fletch1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.2), fletchMat);
  fletch1.position.z = -0.4;
  const fletch2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.2), fletchMat);
  fletch2.position.z = -0.4;

  group.add(shaft, tip, fletch1, fletch2);
  return group;
}

function shootArrow() {
  if (player.dead) return;
  const now = performance.now() / 1000;
  if (now - lastShotTime < BOW_COOLDOWN) return;
  lastShotTime = now;
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  spawnArrow(origin, direction, networkState.myId);

  if (networkState.connected && networkState.ws && networkState.ws.readyState === WebSocket.OPEN) {
    networkState.ws.send(JSON.stringify({
      type: "shoot_arrow",
      ox: origin.x, oy: origin.y, oz: origin.z,
      dx: direction.x, dy: direction.y, dz: direction.z,
    }));
  }
}

function spawnArrow(origin: THREE.Vector3, direction: THREE.Vector3, shooterId: string) {
  const mesh = createArrowMesh();
  mesh.position.copy(origin).addScaledVector(direction, 0.8);
  mesh.lookAt(mesh.position.clone().add(direction));
  arrowsLayer.add(mesh);

  flyingArrows.push({
    mesh,
    velocity: direction.clone().multiplyScalar(ARROW_SPEED),
    origin: origin.clone(),
    alive: true,
    shooterId,
  });
}

function updateArrows(dt: number) {
  const step = new THREE.Vector3();

  for (const arrow of flyingArrows) {
    if (!arrow.alive) continue;

    arrow.velocity.y -= ARROW_GRAVITY * dt;
    step.copy(arrow.velocity).multiplyScalar(dt);

    const prevPos = arrow.mesh.position.clone();
    const nextPos = prevPos.clone().add(step);

    // Raycast along movement to detect block hit
    const moveDir = step.clone();
    const moveLen = moveDir.length();
    if (moveLen > 0) {
      moveDir.divideScalar(moveLen);
      const hit = world.raycast(prevPos, moveDir, moveLen + 0.15);
      if (hit) {
        arrow.mesh.position.copy(prevPos).addScaledVector(moveDir, hit.distance - 0.05);
        arrow.mesh.lookAt(arrow.mesh.position.clone().add(arrow.velocity));
        stickArrow(arrow);
        continue;
      }
    }

    arrow.mesh.position.copy(nextPos);
    arrow.mesh.lookAt(nextPos.clone().add(arrow.velocity));

    // Check hit against local player (arrows from others)
    if (arrow.shooterId !== networkState.myId && !player.dead) {
      const dx = nextPos.x - player.position.x;
      const dz = nextPos.z - player.position.z;
      const dy = nextPos.y - (player.position.y + PLAYER_HEIGHT * 0.5);
      if (dx * dx + dz * dz < ARROW_HIT_RADIUS * ARROW_HIT_RADIUS && Math.abs(dy) < PLAYER_HEIGHT * 0.6) {
        sendHitPlayer(networkState.myId, arrow.shooterId);
        stickArrowToPlayer(arrow, cameraRig);
        continue;
      }
    }

    // Check hit against remote players (arrows from local player)
    if (arrow.shooterId === networkState.myId) {
      for (const avatar of remotePlayers.values()) {
        if (avatar.dead) continue;
        const ax = nextPos.x - avatar.root.position.x;
        const az = nextPos.z - avatar.root.position.z;
        const ay = nextPos.y - (avatar.root.position.y + PLAYER_HEIGHT * 0.5);
        if (ax * ax + az * az < ARROW_HIT_RADIUS * ARROW_HIT_RADIUS && Math.abs(ay) < PLAYER_HEIGHT * 0.6) {
          sendHitPlayer(avatar.id, arrow.shooterId);
          stickArrowToPlayer(arrow, avatar.root);
          break;
        }
      }
      if (!arrow.alive) continue;
    }

    // Remove if too far
    if (prevPos.distanceTo(arrow.origin) > ARROW_MAX_DISTANCE) {
      arrowsLayer.remove(arrow.mesh);
      disposeObject3D(arrow.mesh);
      arrow.alive = false;
    }
  }

  // Clean up dead flying arrows
  for (let i = flyingArrows.length - 1; i >= 0; i--) {
    if (!flyingArrows[i].alive) flyingArrows.splice(i, 1);
  }
}

function sendHitPlayer(targetId: string, _attackerId: string) {
  if (!networkState.connected || !networkState.ws || networkState.ws.readyState !== WebSocket.OPEN) return;
  networkState.ws.send(JSON.stringify({ type: "hit_player", targetId }));
}

function stickArrow(arrow: FlyingArrow) {
  arrow.alive = false;
  const now = performance.now() / 1000;
  stuckArrows.push({ mesh: arrow.mesh, expiresAt: now + STUCK_ARROW_LIFETIME });
  pruneStuckArrows();
}

function stickArrowToPlayer(arrow: FlyingArrow, target: THREE.Object3D) {
  arrow.alive = false;
  // Convert arrow world position to target's local space
  const localPos = target.worldToLocal(arrow.mesh.position.clone());
  arrowsLayer.remove(arrow.mesh);
  arrow.mesh.position.copy(localPos);
  // Convert world rotation to local
  const worldQuat = new THREE.Quaternion();
  arrow.mesh.getWorldQuaternion(worldQuat);
  const parentQuat = new THREE.Quaternion();
  target.getWorldQuaternion(parentQuat);
  arrow.mesh.quaternion.copy(parentQuat.invert().multiply(worldQuat));

  target.add(arrow.mesh);
  const now = performance.now() / 1000;
  stuckArrows.push({ mesh: arrow.mesh, expiresAt: now + STUCK_ARROW_LIFETIME });
  pruneStuckArrows();
}

function pruneStuckArrows() {
  while (stuckArrows.length > MAX_STUCK_ARROWS) {
    const old = stuckArrows.shift()!;
    old.mesh.removeFromParent();
    disposeObject3D(old.mesh);
  }
}

function updateStuckArrows() {
  const now = performance.now() / 1000;
  for (let i = stuckArrows.length - 1; i >= 0; i--) {
    if (now >= stuckArrows[i].expiresAt) {
      const sa = stuckArrows[i];
      sa.mesh.removeFromParent();
      disposeObject3D(sa.mesh);
      stuckArrows.splice(i, 1);
    }
  }
}

function updateHpBar() {
  const pct = Math.max(0, Math.min(100, player.hp));
  hud.hpFill.style.width = `${pct}%`;
  hud.hpFill.style.background = pct > 50 ? "#4ae64a" : pct > 25 ? "#e6c040" : "#e64040";
  hud.hpText.textContent = `HP ${pct}/${MAX_HP}`;
}

function updateDeathState(dt: number) {
  if (!player.dead) return;
  player.deathCountdown -= dt;
  const remaining = Math.max(0, Math.ceil(player.deathCountdown));
  hud.deathTimer.textContent = `Воскрешение через ${remaining}...`;
}

function localPlayerDie() {
  player.dead = true;
  player.deathCountdown = RESPAWN_COUNTDOWN;
  player.velocity.set(0, 0, 0);
  hud.deathOverlay.style.display = "flex";
  renderer.domElement.style.filter = "grayscale(1) brightness(0.5)";
}

function localPlayerRespawn(x: number, y: number, z: number) {
  player.dead = false;
  player.hp = MAX_HP;
  player.position.set(x, y, z);
  player.lastSafePosition.set(x, y, z);
  player.velocity.set(0, 0, 0);
  player.onGround = hasGroundContact(player.position);
  physicsAccumulator = 0;
  hud.deathOverlay.style.display = "none";
  renderer.domElement.style.filter = "";
  updateHpBar();
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

  const status = document.createElement("div");
  status.style.cssText = "font-size:12px;color:#a8d8ff";

  const hint = document.createElement("div");
  hint.style.cssText = "position:absolute;left:50%;bottom:88px;transform:translateX(-50%);padding:6px 10px;border-radius:10px;background:rgba(0,0,0,0.38);font-size:12px;color:#deedde";
  hint.textContent = "WASD move, Space jump, Enter chat, LMB break, RMB place, wheel or 1-9 select";

  const hotbar = document.createElement("div");
  hotbar.style.cssText = "position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:6px;pointer-events:none";

  const chatWrap = document.createElement("div");
  chatWrap.style.cssText = "position:absolute;left:50%;bottom:150px;transform:translateX(-50%);display:none;pointer-events:auto";

  const chatInput = document.createElement("input");
  chatInput.type = "text";
  chatInput.maxLength = MAX_CHAT_LENGTH;
  chatInput.placeholder = "Chat...";
  chatInput.autocomplete = "off";
  chatInput.style.cssText = [
    "width:min(70vw,420px)",
    "padding:10px 14px",
    "border-radius:12px",
    "border:1px solid rgba(255,255,255,0.18)",
    "background:rgba(10,14,18,0.92)",
    "box-shadow:0 10px 30px rgba(0,0,0,0.35)",
    "color:#fff",
    "font:14px monospace",
    "outline:none"
  ].join(";");
  chatWrap.appendChild(chatInput);

  const hpBar = document.createElement("div");
  hpBar.style.cssText = "position:absolute;bottom:52px;left:50%;transform:translateX(-50%);width:220px;height:8px;background:rgba(0,0,0,0.5);border-radius:4px;overflow:hidden";
  const hpFill = document.createElement("div");
  hpFill.style.cssText = "width:100%;height:100%;background:#e64040;border-radius:4px;transition:width 0.2s";
  hpBar.appendChild(hpFill);

  const hpText = document.createElement("div");
  hpText.style.cssText = "position:absolute;bottom:62px;left:50%;transform:translateX(-50%);font-size:11px;color:#ff8888;text-shadow:0 1px 3px rgba(0,0,0,0.8)";

  const deathOverlay = document.createElement("div");
  deathOverlay.style.cssText = "position:fixed;inset:0;display:none;z-index:100;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;flex-direction:column;gap:20px";
  const deathTitle = document.createElement("div");
  deathTitle.style.cssText = "font-size:48px;font-weight:bold;color:#e64040;font-family:monospace;text-shadow:0 4px 20px rgba(230,64,64,0.5)";
  deathTitle.textContent = "ВЫ ПОГИБЛИ";
  const deathTimer = document.createElement("div");
  deathTimer.style.cssText = "font-size:22px;color:#ccc;font-family:monospace";
  deathOverlay.append(deathTitle, deathTimer);

  info.append(coords, chunk, status);
  root.append(crosshair, info, hint, hotbar, chatWrap, hpBar, hpText);

  return { root, coords, chunk, status, hint, hotbar, chatWrap, chatInput, hpFill, hpText, deathOverlay, deathTimer };
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
  const remoteCount = remotePlayers.size;
  const serverLabel = networkState.connected
    ? `Online ${networkState.playerName} | players ${remoteCount + 1}`
    : networkState.connecting
      ? "Connecting..."
      : "Offline";
  const details = networkState.lastError && !networkState.connected ? ` | ${networkState.lastError}` : "";
  hud.status.textContent = `${serverLabel} | ${networkState.serverUrl.replace(/^wss?:\/\//, "")}${details}`;
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
  subtitle.textContent = "Voxel multiplayer prototype: shared world, mining, placing, other players visible";
  subtitle.style.cssText = "font-size:13px;color:#c1d9f1;line-height:1.5;margin-bottom:18px";

  const form = document.createElement("div");
  form.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-bottom:16px";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.value = localStorage.getItem("cubic.playerName") || `Player${Math.floor(100 + Math.random() * 900)}`;
  nameInput.placeholder = "Player name";
  nameInput.style.cssText = "padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:rgba(12,18,24,0.8);color:#fff;font:14px monospace;outline:none";

  const serverInput = document.createElement("input");
  serverInput.type = "text";
  serverInput.value = localStorage.getItem("cubic.serverUrl") || getDefaultServerUrl();
  serverInput.placeholder = "ws://host:3002";
  serverInput.style.cssText = "padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:rgba(12,18,24,0.8);color:#fff;font:14px monospace;outline:none";

  const button = document.createElement("button");
  button.textContent = "Start Multiplayer";
  button.style.cssText = "padding:14px 18px;width:100%;border:none;border-radius:12px;background:linear-gradient(135deg,#5ab95f,#2d89c8);color:#fff;font:600 15px monospace;cursor:pointer";
  button.onclick = () => {
    if (networkState.started) {
      renderer.domElement.requestPointerLock();
      return;
    }
    const playerName = nameInput.value.trim() || "Player";
    const serverUrl = normalizeServerUrl(serverInput.value.trim() || getDefaultServerUrl());
    localStorage.setItem("cubic.playerName", playerName);
    localStorage.setItem("cubic.serverUrl", serverUrl);
    startMultiplayer(playerName, serverUrl);
    renderer.domElement.requestPointerLock();
  };

  const note = document.createElement("div");
  note.textContent = "Другие игроки видны как 3D-аватары. Ломание и установка блоков синхронизируются через сервер.";
  note.style.cssText = "margin-top:14px;font-size:11px;color:#9fb0bd";

  form.append(nameInput, serverInput);
  box.append(title, subtitle, form, button, note);
  overlay.appendChild(box);
  return { overlay, subtitle, form, nameInput, serverInput, button, note };
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

function updateTitleScreen() {
  if (chatState.open) {
    title.overlay.style.display = "none";
    return;
  }

  if (pointerLocked) {
    title.overlay.style.display = "none";
    return;
  }

  if (!networkState.pageActive && networkState.started) {
    title.overlay.style.display = "none";
    return;
  }

  title.overlay.style.display = "flex";

  if (!networkState.started) {
    title.subtitle.textContent = "Voxel multiplayer prototype: shared world, mining, placing, other players visible";
    title.form.style.display = "flex";
    title.nameInput.disabled = false;
    title.serverInput.disabled = false;
    title.button.textContent = "Start Multiplayer";
    title.note.textContent = "Другие игроки видны как 3D-аватары. Ломание и установка блоков синхронизируются через сервер.";
    return;
  }

  title.form.style.display = "none";
  title.nameInput.disabled = true;
  title.serverInput.disabled = true;
  title.button.textContent = "Resume";
  const reconnecting = networkState.connecting || Boolean(networkState.reconnectTimer);
  title.subtitle.textContent = networkState.connected
    ? "Сессия активна. Потеря фокуса больше не переподключает тебя к серверу."
    : reconnecting
      ? "Соединение восстанавливается автоматически..."
      : "Сессия неактивна. Нажми Resume, чтобы вернуться в игру.";
  title.note.textContent = networkState.lastError && !networkState.connected
    ? `Сервер: ${networkState.lastError}`
    : "Чтобы открыть второе окно, просто открой ещё одну вкладку или окно игры и запусти его отдельно.";
}

function getDefaultServerUrl() {
  const fallback = getPreferredServerUrl();
  const query = new URLSearchParams(window.location.search).get("server");
  if (query) return normalizeServerUrl(query, fallback);
  return fallback;
}

function normalizeServerUrl(value: string, fallback = getPreferredServerUrl()) {
  let raw = value.trim();
  if (!raw) raw = fallback;
  if (raw.startsWith("/")) {
    return makeSameOriginServerUrl(raw);
  }
  if (/^https?:\/\//i.test(raw)) {
    raw = raw.replace(/^http/i, "ws");
  } else if (!/^wss?:\/\//i.test(raw)) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    raw = `${protocol}://${raw}`;
  }

  try {
    const url = new URL(raw);
    url.hostname = normalizeWsHost(url.hostname);
    if (!url.port) {
      url.port = String(DEFAULT_SERVER_PORT);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function normalizeWsHost(host: string) {
  if (!host || host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "localhost";
  }
  return host;
}

function makeServerUrlForHost(host: string) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${normalizeWsHost(host)}:${DEFAULT_SERVER_PORT}`;
}

function makeSameOriginServerUrl(path = "/ws") {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = normalizeWsHost(window.location.hostname || "localhost");
  const port = window.location.port ? `:${window.location.port}` : "";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}://${host}${port}${normalizedPath}`;
}

function isViteDevClient() {
  return window.location.port === "5174";
}

function getPreferredServerUrl() {
  if (isViteDevClient()) {
    return makeServerUrlForHost(window.location.hostname || "localhost");
  }
  return makeSameOriginServerUrl("/ws");
}

function buildServerCandidates(preferredUrl: string) {
  const candidates = new Set<string>();
  const preferred = normalizeServerUrl(preferredUrl);
  candidates.add(preferred);

  if (!isViteDevClient()) {
    candidates.add(makeSameOriginServerUrl("/ws"));
  }

  const currentHost = normalizeWsHost(window.location.hostname || "localhost");
  candidates.add(makeServerUrlForHost(currentHost));

  if (currentHost !== "localhost") {
    candidates.add(makeServerUrlForHost("localhost"));
  }

  return Array.from(candidates);
}

function startMultiplayer(playerName: string, serverUrl: string) {
  networkState.started = true;
  networkState.playerName = playerName;
  networkState.appearanceSeed = createAppearanceSeed();
  networkState.lastError = "";
  networkState.serverCandidates = buildServerCandidates(serverUrl);
  networkState.currentServerIndex = 0;
  networkState.serverUrl = networkState.serverCandidates[0] || getDefaultServerUrl();
  updateTitleScreen();
  if (networkState.reconnectTimer) {
    window.clearTimeout(networkState.reconnectTimer);
    networkState.reconnectTimer = 0;
  }
  if (networkState.ws) {
    networkState.ws.close();
  }
  clearRemotePlayers();
  connectMultiplayer();
}

function connectMultiplayer() {
  if (!networkState.started) return;
  if (networkState.connecting) return;

  networkState.serverUrl = networkState.serverCandidates[networkState.currentServerIndex] || getDefaultServerUrl();
  networkState.lastError = "";
  networkState.connecting = true;
  const ws = new WebSocket(networkState.serverUrl);
  networkState.ws = ws;

  ws.onopen = () => {
    if (networkState.ws !== ws) return;
    networkState.connecting = false;
    networkState.connected = true;
    networkState.lastError = "";
    updateTitleScreen();
    ws.send(JSON.stringify({
      type: "join",
      name: networkState.playerName,
      appearanceSeed: networkState.appearanceSeed,
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw,
      pitch,
      heldItemId: getCurrentHeldItemToken(),
    }));
    gameLog.success(`Connected to ${networkState.serverUrl}`);
  };

  ws.onmessage = (event) => {
    let message: ServerMessage | null = null;
    try {
      message = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      return;
    }
    handleServerMessage(message);
  };

  ws.onclose = () => {
    if (networkState.ws !== ws) return;
    networkState.ws = null;
    networkState.connecting = false;
    const wasConnected = networkState.connected;
    networkState.connected = false;
    networkState.myId = "";
    clearRemotePlayers();
    updateTitleScreen();
    if (networkState.started) {
      if (wasConnected && networkState.pageActive) {
        gameLog.warn("Server connection lost. Reconnecting...");
      }
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    networkState.lastError = `no connection to ${networkState.serverUrl.replace(/^wss?:\/\//, "")}`;
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
  };
}

function scheduleReconnect() {
  if (networkState.reconnectTimer) return;
  networkState.reconnectTimer = window.setTimeout(() => {
    networkState.reconnectTimer = 0;
    if (!networkState.connected && networkState.serverCandidates.length > 1) {
      networkState.currentServerIndex = (networkState.currentServerIndex + 1) % networkState.serverCandidates.length;
    }
    connectMultiplayer();
  }, 2000);
}

function handleServerMessage(message: ServerMessage) {
  switch (message.type) {
    case "init": {
      networkState.myId = message.id;
      networkState.connected = true;
      clearRemotePlayers();
      for (const edit of message.blocks) {
        world.setBlock(edit.x, edit.y, edit.z, edit.block as BlockId);
      }
      for (const state of message.players) {
        if (state.id !== networkState.myId) {
          upsertRemotePlayer(state, true);
        }
      }
      sendLocalPlayerState(true);
      break;
    }
    case "player_join":
      if (message.player.id !== networkState.myId) {
        upsertRemotePlayer(message.player, true);
        gameLog.system(`${message.player.name} joined`);
      }
      break;
    case "player_leave":
      removeRemotePlayer(message.id);
      break;
    case "snapshot": {
      const seen = new Set<string>();
      for (const state of message.players) {
        if (state.id === networkState.myId) continue;
        seen.add(state.id);
        upsertRemotePlayer(state, false);
      }
      for (const id of remotePlayers.keys()) {
        if (!seen.has(id)) removeRemotePlayer(id);
      }
      break;
    }
    case "set_block":
      world.setBlock(message.x, message.y, message.z, message.block as BlockId);
      if (!isPositionSafe(player.position)) {
        recoverPlayer();
      }
      break;
    case "chat":
      gameLog.chat(message.name, message.text);
      if (message.id !== networkState.myId) {
        showRemotePlayerChat(message.id, message.text);
      }
      break;
    case "shoot_arrow": {
      const dir = new THREE.Vector3(message.dx, message.dy, message.dz).normalize();
      const orig = new THREE.Vector3(message.ox, message.oy, message.oz);
      spawnArrow(orig, dir, message.id);
      break;
    }
    case "damage":
      if (message.targetId === networkState.myId) {
        player.hp = message.hp;
        updateHpBar();
        renderer.domElement.style.filter = "brightness(2)";
        setTimeout(() => { if (!player.dead) renderer.domElement.style.filter = ""; }, 120);
      }
      break;
    case "death": {
      if (message.targetId === networkState.myId) {
        localPlayerDie();
      }
      const deadAvatar = remotePlayers.get(message.targetId);
      if (deadAvatar) {
        startRemoteDeathAnimation(deadAvatar);
      }
      const killerName = message.killerId === networkState.myId ? "You" : getRemotePlayerName(message.killerId);
      const victimName = message.targetId === networkState.myId ? "You" : getRemotePlayerName(message.targetId);
      gameLog.system(`${killerName} killed ${victimName}`);
      break;
    }
    case "respawn":
      if (message.targetId === networkState.myId) {
        localPlayerRespawn(message.x, message.y, message.z);
      } else {
        const avatar = remotePlayers.get(message.targetId);
        if (avatar) {
          endRemoteDeathAnimation(avatar);
          avatar.targetPosition.set(message.x, message.y, message.z);
          avatar.root.position.set(message.x, message.y, message.z);
          avatar.lastVisualPosition.set(message.x, message.y, message.z);
        }
      }
      break;
  }
}

function getRemotePlayerName(id: string) {
  const avatar = remotePlayers.get(id);
  return avatar ? avatar.name : "Player";
}

function sendLocalPlayerState(_force: boolean) {
  if (!networkState.connected || !networkState.ws || networkState.ws.readyState !== WebSocket.OPEN) return;

  networkState.ws.send(JSON.stringify({
    type: "player_state",
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    yaw,
    pitch,
    heldItemId: getCurrentHeldItemToken(),
  }));
}

function sendBlockUpdate(x: number, y: number, z: number, block: BlockId) {
  if (!networkState.connected || !networkState.ws) return;
  networkState.ws.send(JSON.stringify({ type: "set_block", x, y, z, block }));
}

function showRemotePlayerChat(id: string, text: string) {
  const avatar = remotePlayers.get(id);
  if (!avatar) return;
  setBubbleText(avatar.bubble, text);
  avatar.bubble.visible = true;
  avatar.bubbleExpiresAt = performance.now() + CHAT_BUBBLE_DURATION_MS;
}

function updateRemotePlayers(dt: number) {
  const blend = 1 - Math.exp(-REMOTE_SMOOTHING * dt);
  const limbBlend = 1 - Math.exp(-18 * dt);
  const now = performance.now();
  for (const avatar of remotePlayers.values()) {
    if (avatar.dead) continue;
    avatar.root.position.lerp(avatar.targetPosition, blend);
    avatar.root.rotation.y = lerpAngle(avatar.root.rotation.y, avatar.targetYaw, blend);
    avatar.headPitch.rotation.x = lerpAngle(avatar.headPitch.rotation.x, avatar.targetPitch, blend);

    const dx = avatar.root.position.x - avatar.lastVisualPosition.x;
    const dz = avatar.root.position.z - avatar.lastVisualPosition.z;
    const horizontalSpeed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    avatar.lastVisualPosition.copy(avatar.root.position);

    const strideStrength = Math.min(1, horizontalSpeed / (MOVE_SPEED * 0.72));
    if (strideStrength > 0.03) {
      avatar.walkPhase += horizontalSpeed * dt * 4.4;
    }

    const swing = Math.sin(avatar.walkPhase) * 0.82 * strideStrength;
    const armSwing = swing * 0.74;
    const settle = (value: number, target: number) => THREE.MathUtils.lerp(value, target, limbBlend);

    avatar.leftLeg.rotation.x = settle(avatar.leftLeg.rotation.x, swing);
    avatar.rightLeg.rotation.x = settle(avatar.rightLeg.rotation.x, -swing);
    avatar.leftArm.rotation.x = settle(avatar.leftArm.rotation.x, -armSwing + 0.06);
    avatar.rightArm.rotation.x = settle(avatar.rightArm.rotation.x, armSwing - 0.26);
    avatar.leftArm.rotation.z = settle(avatar.leftArm.rotation.z, -0.04);
    avatar.rightArm.rotation.z = settle(avatar.rightArm.rotation.z, 0.08);

    if (avatar.bubble.visible && avatar.bubbleExpiresAt > 0 && now >= avatar.bubbleExpiresAt) {
      avatar.bubble.visible = false;
      avatar.bubbleExpiresAt = 0;
    }
  }
}

function startRemoteDeathAnimation(avatar: RemoteAvatar) {
  avatar.dead = true;
  avatar.deathTime = 0;

  // Create soul (clone of root, semi-transparent)
  const soul = avatar.root.clone(true);
  soul.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.Material).clone();
    if (mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshBasicMaterial) {
      mat.transparent = true;
      mat.opacity = 0.35;
    }
    mesh.material = mat;
  });
  // Remove label and bubble sprites from soul
  const toRemove: THREE.Object3D[] = [];
  soul.traverse((child) => { if (child instanceof THREE.Sprite) toRemove.push(child); });
  toRemove.forEach((s) => s.removeFromParent());

  soul.position.copy(avatar.root.position);
  soul.rotation.copy(avatar.root.rotation);
  remotePlayersLayer.add(soul);
  avatar.soul = soul;
}

function endRemoteDeathAnimation(avatar: RemoteAvatar) {
  avatar.dead = false;
  avatar.deathTime = 0;
  avatar.root.rotation.x = 0;
  avatar.root.visible = true;
  if (avatar.soul) {
    remotePlayersLayer.remove(avatar.soul);
    disposeObject3D(avatar.soul);
    avatar.soul = null;
  }
}

function updateRemoteDeathAnimations(dt: number) {
  for (const avatar of remotePlayers.values()) {
    if (!avatar.dead) continue;
    avatar.deathTime += dt;

    // Body falls to horizontal
    const fallProgress = Math.min(1, avatar.deathTime / 0.6);
    avatar.root.rotation.x = fallProgress * (Math.PI / 2);

    // Soul rises and fades
    if (avatar.soul) {
      const soulPhase = Math.max(0, avatar.deathTime - 0.4);
      avatar.soul.position.y = avatar.root.position.y + soulPhase * 1.2;
      const soulOpacity = Math.max(0, 0.35 - soulPhase * 0.08);
      avatar.soul.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
        if (mat.opacity !== undefined) mat.opacity = soulOpacity;
      });
      if (soulOpacity <= 0) {
        remotePlayersLayer.remove(avatar.soul);
        disposeObject3D(avatar.soul);
        avatar.soul = null;
      }
    }
  }
}

function upsertRemotePlayer(state: RemotePlayerState, snapNow: boolean) {
  let avatar = remotePlayers.get(state.id);
  if (avatar && avatar.appearanceSeed !== state.appearanceSeed) {
    removeRemotePlayer(state.id);
    avatar = undefined;
  }

  if (!avatar) {
    avatar = createRemotePlayer(state);
    remotePlayers.set(state.id, avatar);
  }

  avatar.name = state.name;
  avatar.appearanceSeed = state.appearanceSeed;
  avatar.targetPosition.set(state.x, state.y, state.z);
  avatar.targetYaw = state.yaw + Math.PI;
  avatar.targetPitch = -state.pitch;

  if (avatar.heldItemId !== state.heldItemId) {
    setRemoteHeldItem(avatar, state.heldItemId);
  }

  if (snapNow) {
    avatar.root.position.copy(avatar.targetPosition);
    avatar.root.rotation.y = avatar.targetYaw;
    avatar.headPitch.rotation.x = avatar.targetPitch;
    avatar.lastVisualPosition.copy(avatar.root.position);
  }
}

function createRemotePlayer(state: RemotePlayerState) {
  const root = new THREE.Group();
  const headPitch = new THREE.Group();
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  const heldPivot = new THREE.Group();
  const palette = createAvatarPalette(state.appearanceSeed);
  const shirtMaterial = new THREE.MeshLambertMaterial({ color: palette.shirt });
  const shirtAccentMaterial = new THREE.MeshLambertMaterial({ color: palette.shirtAccent });
  const sleeveMaterial = new THREE.MeshLambertMaterial({ color: palette.sleeve });
  const pantsMaterial = new THREE.MeshLambertMaterial({ color: palette.pants });
  const shoeMaterial = new THREE.MeshLambertMaterial({ color: palette.shoes });
  const skinMaterial = new THREE.MeshLambertMaterial({ color: palette.skin });
  const hairMaterial = new THREE.MeshLambertMaterial({ color: palette.hair });
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x1f2631 });
  const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x8b5343 });
  const blushMaterial = new THREE.MeshBasicMaterial({ color: 0xffb29f });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.28), shirtMaterial);
  torso.position.y = 1.24;
  const shirtStripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.3), shirtAccentMaterial);
  shirtStripe.position.set(0, 1.33, 0);
  const shirtHem = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.3), shirtAccentMaterial);
  shirtHem.position.set(0, 0.91, 0);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.31), skinMaterial);
  collar.position.set(0, 1.53, 0);

  leftLeg.position.set(-0.14, 0.88, 0);
  rightLeg.position.set(0.14, 0.88, 0);
  const leftThigh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.24), pantsMaterial);
  leftThigh.position.y = -0.36;
  const rightThigh = leftThigh.clone();
  const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.28), shoeMaterial);
  leftShoe.position.set(0, -0.78, 0.02);
  const rightShoe = leftShoe.clone();
  const leftKnee = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.02), shirtAccentMaterial);
  leftKnee.position.set(0, -0.38, 0.13);
  const rightKnee = leftKnee.clone();
  leftLeg.add(leftThigh, leftShoe, leftKnee);
  rightLeg.add(rightThigh, rightShoe, rightKnee);

  leftArm.position.set(-0.4, 1.5, 0);
  rightArm.position.set(0.4, 1.5, 0);
  const leftSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.48, 0.18), sleeveMaterial);
  leftSleeve.position.y = -0.24;
  const rightSleeve = leftSleeve.clone();
  const leftForearm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), skinMaterial);
  leftForearm.position.y = -0.6;
  const rightForearm = leftForearm.clone();
  const leftCuff = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.19), shirtAccentMaterial);
  leftCuff.position.y = -0.46;
  const rightCuff = leftCuff.clone();
  leftArm.add(leftSleeve, leftForearm, leftCuff);
  rightArm.add(rightSleeve, rightForearm, rightCuff);

  heldPivot.position.set(0.02, -0.64, 0.14);
  heldPivot.rotation.set(-0.12, 0.3, 0.7);
  rightArm.add(heldPivot);

  headPitch.position.y = 1.45;
  const head = new THREE.Group();
  head.position.y = 0.24;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.48), skinMaterial);
  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), hairMaterial);
  hairCap.position.y = 0.15;
  const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.08), hairMaterial);
  fringe.position.set(0, 0.05, 0.2);
  const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), eyeMaterial);
  leftEye.position.set(-0.1, 0.04, 0.25);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.1;
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), mouthMaterial);
  mouth.position.set(0, -0.08, 0.25);
  const leftCheek = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), blushMaterial);
  leftCheek.position.set(-0.14, -0.06, 0.25);
  const rightCheek = leftCheek.clone();
  rightCheek.position.x = 0.14;
  head.add(skull, hairCap, fringe, leftEye, rightEye, mouth, leftCheek, rightCheek);
  headPitch.add(head);

  const label = createNameSprite(state.name);
  label.position.set(0, 2.22, 0);
  const bubble = createBubbleSprite();
  bubble.position.set(0, 2.78, 0);

  root.add(torso, shirtStripe, shirtHem, collar, leftLeg, rightLeg, leftArm, rightArm, headPitch, label, bubble);
  root.position.set(state.x, state.y, state.z);
  root.rotation.y = state.yaw + Math.PI;
  headPitch.rotation.x = -state.pitch;
  remotePlayersLayer.add(root);

  const avatar: RemoteAvatar = {
    id: state.id,
    name: state.name,
    appearanceSeed: state.appearanceSeed,
    root,
    headPitch,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    heldPivot,
    heldItemMesh: null,
    label,
    bubble,
    targetPosition: new THREE.Vector3(state.x, state.y, state.z),
    targetYaw: state.yaw + Math.PI,
    targetPitch: -state.pitch,
    heldItemId: "",
    lastVisualPosition: new THREE.Vector3(state.x, state.y, state.z),
    walkPhase: Math.random() * Math.PI * 2,
    bubbleExpiresAt: 0,
    dead: false,
    deathTime: 0,
    soul: null,
  };
  setRemoteHeldItem(avatar, state.heldItemId);
  return avatar;
}

function setRemoteHeldItem(avatar: RemoteAvatar, token: string) {
  if (avatar.heldItemMesh) {
    avatar.heldPivot.remove(avatar.heldItemMesh);
    avatar.heldItemMesh = null;
  }

  const mesh = createHeldMeshFromToken(token);
  mesh.traverse((child) => {
    const candidate = child as THREE.Mesh;
    if (!candidate.isMesh) return;
    if (candidate.material === world.material) {
      const cloned = world.material.clone();
      cloned.map = world.atlas;
      candidate.material = cloned;
    }
  });
  mesh.position.set(0, 0, 0);
  mesh.scale.multiplyScalar(0.72);
  avatar.heldPivot.add(mesh);
  avatar.heldItemMesh = mesh;
  avatar.heldItemId = token;
}

function removeRemotePlayer(id: string) {
  const avatar = remotePlayers.get(id);
  if (!avatar) return;
  remotePlayersLayer.remove(avatar.root);
  disposeObject3D(avatar.root);
  remotePlayers.delete(id);
}

function clearRemotePlayers() {
  for (const id of Array.from(remotePlayers.keys())) {
    removeRemotePlayer(id);
  }
}

function createSpriteWithMaterial() {
  return new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
}

function applyCanvasToSprite(sprite: THREE.Sprite, canvas: HTMLCanvasElement, scaleX: number, scaleY: number) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = sprite.material as THREE.SpriteMaterial;
  material.map?.dispose();
  material.map = texture;
  material.needsUpdate = true;
  sprite.scale.set(scaleX, scaleY, 1);
}

function createNameSprite(name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(10, 12, 236, 40);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 1);
  const sprite = createSpriteWithMaterial();
  applyCanvasToSprite(sprite, canvas, 1.8, 0.45);
  return sprite;
}

function createBubbleSprite() {
  const sprite = createSpriteWithMaterial();
  sprite.visible = false;
  return sprite;
}

function setBubbleText(sprite: THREE.Sprite, text: string) {
  const lines = wrapChatText(text, 22, 3);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 42 + lines.length * 28;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  roundRect(ctx, 12, 10, canvas.width - 24, canvas.height - 20, 16);
  ctx.fill();
  ctx.fillStyle = "rgba(18, 24, 30, 0.94)";
  roundRect(ctx, 16, 14, canvas.width - 32, canvas.height - 28, 12);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], canvas.width / 2, 32 + i * 26);
  }

  const aspect = canvas.width / canvas.height;
  applyCanvasToSprite(sprite, canvas, 1.5 * aspect, 1.5);
}

function wrapChatText(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const chunks = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, "g")) || [word] : [word];
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      current = chunk;
      if (lines.length >= maxLines - 1) break;
    }
    if (lines.length >= maxLines - 1) break;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === 0) {
    lines.push(text.slice(0, maxChars));
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  const lastIndex = lines.length - 1;
  if (lastIndex >= 0 && text.length > lines.join(" ").length) {
    lines[lastIndex] = lines[lastIndex].slice(0, Math.max(0, maxChars - 1)) + "…";
  }

  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const withGeometry = child as { geometry?: THREE.BufferGeometry };
    if (withGeometry.geometry) withGeometry.geometry.dispose();
    const material = (child as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        const textured = entry as THREE.Material & { map?: THREE.Texture | null };
        textured.map?.dispose();
        entry.dispose();
      });
    } else if (material) {
      const textured = material as THREE.Material & { map?: THREE.Texture | null };
      textured.map?.dispose();
      material.dispose();
    }
  });
}

function createAppearanceSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return Math.max(1, values[0] & 0x7fffffff);
}

function createAvatarPalette(seed: number) {
  const random = createSeededRandom(seed);

  const shirt = new THREE.Color();
  shirt.setHSL(random(), 0.55 + random() * 0.22, 0.43 + random() * 0.16);

  const pants = new THREE.Color();
  pants.setHSL(0.52 + random() * 0.18, 0.28 + random() * 0.24, 0.23 + random() * 0.16);

  const hair = new THREE.Color();
  hair.setHSL(0.05 + random() * 0.08, 0.16 + random() * 0.24, 0.08 + random() * 0.24);

  const skin = new THREE.Color();
  skin.setHSL(0.05 + random() * 0.05, 0.45 + random() * 0.18, 0.6 + random() * 0.18);

  return {
    shirt: shirt.getHex(),
    shirtAccent: shiftColor(shirt.getHex(), 1.22),
    sleeve: shiftColor(shirt.getHex(), 0.82),
    pants: pants.getHex(),
    shoes: shiftColor(pants.getHex(), 0.5),
    skin: skin.getHex(),
    hair: hair.getHex(),
  };
}

function createSeededRandom(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shiftColor(hex: number, lightnessScale: number) {
  const color = new THREE.Color(hex);
  color.getHSL(tempHslB);
  color.setHSL(tempHslB.h, tempHslB.s, Math.max(0, Math.min(1, tempHslB.l * lightnessScale)));
  return color.getHex();
}

function lerpAngle(from: number, to: number, t: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}
