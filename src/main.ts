import * as THREE from "three";
import AABB from "aabb-3d";
import { GameLog } from "./gamelog";
import sweep from "voxel-aabb-sweep";
import {
  SERVER_TICK_RATE,
  type ServerMessage,
} from "./multiplayerProtocol";
import {
  BlockId,
  CHUNK_SIZE,
  EYE_HEIGHT,
  RENDER_DISTANCE,
  VoxelWorld,
} from "./voxelWorld";
import {
  MOVE_SPEED, SPRINT_MULTIPLIER, GRAVITY, JUMP_VELOCITY,
  LOOK_SENSITIVITY, INTERACT_DISTANCE, PHYSICS_STEP, MAX_PHYSICS_STEPS,
  GROUND_CHECK, SAFE_FALL_RESET_Y, SWEEP_EPSILON,
  MAX_CHAT_LENGTH, MAX_HP, RESPAWN_COUNTDOWN,
  BODY_WIDTH, BODY_HEIGHT, BODY_RADIUS,
  HEAD_RADIUS, HEAD_HALF_HEIGHT,
} from "./constants";
import { hotbarItems, heldItemTokenForItem, createHeldMeshFromToken } from "./items";
import {
  createMiningState, resetMining, updateCrackOverlay, crackOverlay,
  getRequiredHits, spawnBreakParticles, updateBreakParticles, updateMining,
  type BreakParticle,
} from "./mining";
import {
  createCombatState, spawnArrow, canShoot, markShot,
  updateArrows, updateStuckArrows,
} from "./combat";
import {
  type RemoteAvatar, initRemotePlayers,
  upsertRemotePlayer, removeRemotePlayer, clearRemotePlayers,
  updateRemotePlayers, showRemotePlayerChat,
  startRemoteDeathAnimation, endRemoteDeathAnimation, updateRemoteDeathAnimations,
  getRemotePlayerName,
} from "./remotePlayers";
import {
  createHud, renderHotbar, updateHpBar, updateHudInfo,
  createTitleScreen, updateTitleScreen,
  type HudElements, type TitleScreenUi,
} from "./hud";
import { getDefaultServerUrl, normalizeServerUrl, buildServerCandidates } from "./connection";
import { createAppearanceSeed, isTypingInUi } from "./utils";

// --- Scene setup ---
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
scene.add(crackOverlay);

initRemotePlayers(world);

// --- Water constants ---
const SWIM_SPEED = 2.8;
const WATER_GRAVITY = 4;
const WATER_BUOYANCY = 5;
const WATER_DRAG = 0.85;

// --- State ---
const combat = createCombatState();
const miningState = createMiningState();
const breakParticles: BreakParticle[] = [];

// Underwater overlay
const underwaterOverlay = document.createElement("div");
underwaterOverlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:15;background:rgba(20,60,140,0.35);display:none";
document.body.appendChild(underwaterOverlay);
const defaultBgColor = new THREE.Color("#87c7ff");
const waterBgColor = new THREE.Color("#1a3860");
const defaultFogColor = new THREE.Color("#87c7ff");
const waterFogColor = new THREE.Color("#1a3860");

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

const debugMaterial = new THREE.LineBasicMaterial({ color: 0xff5f5f, depthTest: false, transparent: true, opacity: 0.95 });
const debugHeadMaterial = new THREE.LineBasicMaterial({ color: 0x55d8ff, depthTest: false, transparent: true, opacity: 0.95 });
const debugBodyBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_WIDTH)), debugMaterial);
const debugHeadBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(HEAD_RADIUS * 2, HEAD_HALF_HEIGHT * 2, HEAD_RADIUS * 2)), debugHeadMaterial);
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

let selectedSlot = 0;
let yaw = 0;
let pitch = 0;
let pointerLocked = false;

// --- HUD & Title ---
const hud: HudElements = createHud();
document.body.appendChild(hud.root);
document.body.appendChild(hud.deathOverlay);
renderHotbar(hud, selectedSlot, world);
setHeldItem(hotbarItems[selectedSlot]);
updateHpBar(hud, player.hp);

const title: TitleScreenUi = createTitleScreen(
  getDefaultServerUrl(),
  (playerName, serverUrl) => {
    if (networkState.started) {
      renderer.domElement.requestPointerLock();
      return;
    }
    const url = normalizeServerUrl(serverUrl || getDefaultServerUrl());
    localStorage.setItem("cubic.playerName", playerName);
    localStorage.setItem("cubic.serverUrl", url);
    startMultiplayer(playerName, url);
  },
  () => renderer.domElement.requestPointerLock()
);
document.body.appendChild(title.overlay);
refreshTitleScreen();

wireInput();
window.addEventListener("resize", onResize);

const clock = new THREE.Clock();
window.setInterval(() => sendLocalPlayerState(), Math.round(1000 / SERVER_TICK_RATE));
animate();

// --- Game loop ---
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
  updateMining(frameDt, miningState, player.dead, hitBlock, () => { swingTime = 1; });
  updateBreakParticles(frameDt, scene, breakParticles, player.position);
  updateHeldItem(frameDt);
  updateArrows(
    frameDt, combat, world, arrowsLayer,
    networkState.myId, player.dead, player.position,
    cameraRig, remotePlayers, sendHitPlayer
  );
  updateStuckArrows(combat);
  updateRemotePlayers(frameDt, remotePlayers);
  updateRemoteDeathAnimations(frameDt, remotePlayers, remotePlayersLayer);
  updateCamera();
  updateDebugColliders();
  updateHud();

  renderer.render(scene, camera);
}

// --- Player physics ---
function isInWater(pos: THREE.Vector3) {
  return world.isBlockInWater(Math.floor(pos.x), Math.floor(pos.y + 0.4), Math.floor(pos.z));
}

function isHeadUnderwater(pos: THREE.Vector3) {
  return world.isBlockInWater(Math.floor(pos.x), Math.floor(pos.y + EYE_HEIGHT), Math.floor(pos.z));
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

  const inWater = isInWater(player.position);
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
    const speed = inWater ? SWIM_SPEED : MOVE_SPEED * (input.sprint ? SPRINT_MULTIPLIER : 1);
    player.velocity.x = moveInput.x * speed;
    player.velocity.z = moveInput.z * speed;
  } else {
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  if (inWater) {
    // Water physics: swim up with Space, sink slowly without
    if (input.jumpQueued || input.sprint) {
      player.velocity.y = WATER_BUOYANCY;
    } else {
      player.velocity.y -= WATER_GRAVITY * dt;
      player.velocity.y *= WATER_DRAG;
    }
    input.jumpQueued = false;
  } else {
    if (input.jumpQueued && player.onGround) {
      player.velocity.y = JUMP_VELOCITY;
      player.onGround = false;
    }
    input.jumpQueued = false;
    player.velocity.y -= GRAVITY * dt;
  }

  moveWithSweep(player.velocity.x * dt, player.velocity.y * dt, player.velocity.z * dt);

  if (player.velocity.y <= 0 && hasGroundContact(player.position)) {
    player.onGround = true;
    player.velocity.y = 0;
  } else {
    player.onGround = false;
  }

  // Update underwater visual effect
  const headUnderwater = isHeadUnderwater(player.position);
  underwaterOverlay.style.display = headUnderwater ? "block" : "none";
  if (headUnderwater) {
    (scene.background as THREE.Color).copy(waterBgColor);
    (scene.fog as THREE.Fog).color.copy(waterFogColor);
    (scene.fog as THREE.Fog).near = 2;
    (scene.fog as THREE.Fog).far = CHUNK_SIZE * 2;
  } else {
    (scene.background as THREE.Color).copy(defaultBgColor);
    (scene.fog as THREE.Fog).color.copy(defaultFogColor);
    (scene.fog as THREE.Fog).near = CHUNK_SIZE * (RENDER_DISTANCE + 1);
    (scene.fog as THREE.Fog).far = CHUNK_SIZE * (RENDER_DISTANCE + 3);
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
    if (axis === 0) player.velocity.x = 0;
    else if (axis === 1) { player.velocity.y = 0; if (dir < 0) player.onGround = true; }
    else if (axis === 2) player.velocity.z = 0;
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
  groundMin.set(position.x - BODY_RADIUS + SWEEP_EPSILON, position.y - GROUND_CHECK, position.z - BODY_RADIUS + SWEEP_EPSILON);
  groundMax.set(position.x + BODY_RADIUS - SWEEP_EPSILON, position.y, position.z + BODY_RADIUS - SWEEP_EPSILON);
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
  bodyMin.set(position.x - BODY_RADIUS + SWEEP_EPSILON, position.y + SWEEP_EPSILON, position.z - BODY_RADIUS + SWEEP_EPSILON);
  bodyMax.set(position.x + BODY_RADIUS - SWEEP_EPSILON, position.y + BODY_HEIGHT - SWEEP_EPSILON, position.z + BODY_RADIUS - SWEEP_EPSILON);
  return world.collides(bodyMin, bodyMax);
}

function headCollidesAt(position: THREE.Vector3) {
  const centerY = position.y + EYE_HEIGHT;
  headMin.set(position.x - HEAD_RADIUS + SWEEP_EPSILON, centerY - HEAD_HALF_HEIGHT + SWEEP_EPSILON, position.z - HEAD_RADIUS + SWEEP_EPSILON);
  headMax.set(position.x + HEAD_RADIUS - SWEEP_EPSILON, centerY + HEAD_HALF_HEIGHT - SWEEP_EPSILON, position.z + HEAD_RADIUS - SWEEP_EPSILON);
  return world.collides(headMin, headMax);
}

// --- Held item & swing ---
function updateHeldItem(dt: number) {
  if (!heldItemMesh) return;
  const moveAmount = Number(input.forward || input.back || input.left || input.right);
  const bob = moveAmount ? Math.sin(performance.now() * 0.01) * 0.03 : 0;
  swingTime = Math.max(0, swingTime - dt * 6);
  const swing = Math.sin((1 - swingTime) * Math.PI);
  heldItemPivot.position.set(0.58, -0.55 + bob, -0.75 + Math.abs(bob) * 0.5);
  heldItemPivot.rotation.set(-0.25 - swing * 0.6, 0.55 + swing * 0.45, 0.12 + swing * 0.25);
}

function setHeldItem(item: typeof hotbarItems[0]) {
  if (heldItemMesh) {
    heldItemPivot.remove(heldItemMesh);
    heldItemMesh = null;
  }
  const mesh = createHeldMeshFromToken(heldItemTokenForItem(item), world);
  heldItemMesh = mesh;
  heldItemPivot.add(mesh);
}

function getCurrentHeldItemToken() {
  return heldItemTokenForItem(hotbarItems[selectedSlot]);
}

function selectSlot(index: number) {
  selectedSlot = index;
  resetMining(miningState);
  renderHotbar(hud, selectedSlot, world);
  setHeldItem(hotbarItems[index]);
  gameLog.system(`Selected: ${hotbarItems[index].label}`);
  sendLocalPlayerState();
}

// --- Chat ---
function openChatInput() {
  if (chatState.open || !networkState.started) return;
  chatState.open = true;
  chatState.restorePointerLock = pointerLocked;
  if (pointerLocked) document.exitPointerLock();
  hud.chatWrap.style.display = "block";
  hud.chatInput.value = "";
  window.setTimeout(() => { hud.chatInput.focus(); hud.chatInput.select(); }, 0);
  refreshTitleScreen();
}

function closeChatInput(restorePointerLock = chatState.restorePointerLock) {
  chatState.open = false;
  chatState.restorePointerLock = false;
  hud.chatWrap.style.display = "none";
  hud.chatInput.blur();
  hud.chatInput.value = "";
  refreshTitleScreen();
  if (restorePointerLock && networkState.started) renderer.domElement.requestPointerLock();
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

// --- Block interaction ---
function hitBlock() {
  const hit = getTargetedBlock();
  if (!hit) return;
  const bx = hit.block.x, by = hit.block.y, bz = hit.block.z;
  const block = world.getBlock(bx, by, bz);
  if (block === BlockId.Air || block === BlockId.Bedrock) return;

  const tool = hotbarItems[selectedSlot].id;

  if (miningState.blockX !== bx || miningState.blockY !== by || miningState.blockZ !== bz) {
    miningState.blockX = bx;
    miningState.blockY = by;
    miningState.blockZ = bz;
    miningState.hits = 0;
    miningState.required = getRequiredHits(block, tool);
  }

  miningState.hits++;
  miningState.active = true;
  miningState.timer = 0;

  if (miningState.hits >= miningState.required) {
    spawnBreakParticles(bx, by, bz, block, scene, breakParticles, player.position);
    world.setBlock(bx, by, bz, BlockId.Air);
    sendBlockUpdate(bx, by, bz, BlockId.Air);
    resetMining(miningState);
  } else {
    updateCrackOverlay(miningState);
  }
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

// --- Combat actions ---
function shootArrow() {
  if (player.dead) return;
  if (!canShoot(combat)) return;
  markShot(combat);
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  spawnArrow(origin, direction, networkState.myId, arrowsLayer, combat);

  if (networkState.connected && networkState.ws && networkState.ws.readyState === WebSocket.OPEN) {
    networkState.ws.send(JSON.stringify({
      type: "shoot_arrow",
      ox: origin.x, oy: origin.y, oz: origin.z,
      dx: direction.x, dy: direction.y, dz: direction.z,
    }));
  }
}

function sendHitPlayer(targetId: string, _attackerId: string) {
  if (!networkState.connected || !networkState.ws || networkState.ws.readyState !== WebSocket.OPEN) return;
  networkState.ws.send(JSON.stringify({ type: "hit_player", targetId }));
}

// --- HP & Death ---
function updateDeathState(dt: number) {
  if (!player.dead) return;
  player.deathCountdown -= dt;
  const remaining = Math.max(0, Math.ceil(player.deathCountdown));
  hud.deathTimer.textContent = `\u0412\u043E\u0441\u043A\u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 ${remaining}...`;
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
  updateHpBar(hud, player.hp);
}

// --- HUD updates ---
function updateHud() {
  updateHudInfo(
    hud, player.position, debugCollidersVisible,
    networkState.connected, networkState.connecting,
    networkState.playerName, remotePlayers.size,
    networkState.serverUrl, networkState.lastError
  );
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

function refreshTitleScreen() {
  updateTitleScreen(
    title, chatState.open, pointerLocked,
    networkState.started, networkState.pageActive,
    networkState.connected, networkState.connecting,
    networkState.reconnectTimer, networkState.lastError
  );
}

// --- Input ---
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
    refreshTitleScreen();
  });

  window.addEventListener("blur", () => { networkState.pageActive = false; refreshTitleScreen(); });
  window.addEventListener("focus", () => { networkState.pageActive = document.visibilityState === "visible"; refreshTitleScreen(); });
  document.addEventListener("visibilitychange", () => { networkState.pageActive = document.visibilityState === "visible" && document.hasFocus(); refreshTitleScreen(); });

  window.addEventListener("mousemove", (event) => {
    if (!pointerLocked) return;
    yaw -= event.movementX * LOOK_SENSITIVITY;
    pitch -= event.movementY * LOOK_SENSITIVITY;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  });

  window.addEventListener("keydown", (event) => {
    if (isTypingInUi(event.target)) return;
    switch (event.code) {
      case "KeyW": case "ArrowUp": if (!pointerLocked) break; input.forward = true; event.preventDefault(); break;
      case "KeyS": case "ArrowDown": if (!pointerLocked) break; input.back = true; event.preventDefault(); break;
      case "KeyA": case "ArrowLeft": if (!pointerLocked) break; input.left = true; event.preventDefault(); break;
      case "KeyD": case "ArrowRight": if (!pointerLocked) break; input.right = true; event.preventDefault(); break;
      case "ShiftLeft": case "ShiftRight": if (!pointerLocked) break; input.sprint = true; break;
      case "Space": if (pointerLocked) input.jumpQueued = true; if (pointerLocked) event.preventDefault(); break;
      case "Enter": case "NumpadEnter": if (pointerLocked) { openChatInput(); event.preventDefault(); } break;
      case "Digit1": if (pointerLocked) selectSlot(0); break;
      case "Digit2": if (pointerLocked) selectSlot(1); break;
      case "Digit3": if (pointerLocked) selectSlot(2); break;
      case "Digit4": if (pointerLocked) selectSlot(3); break;
      case "Digit5": if (pointerLocked) selectSlot(4); break;
      case "Digit6": if (pointerLocked) selectSlot(5); break;
      case "Digit7": if (pointerLocked) selectSlot(6); break;
      case "Digit8": if (pointerLocked) selectSlot(7); break;
      case "Digit9": if (pointerLocked) selectSlot(8); break;
      case "F3": toggleDebugColliders(); event.preventDefault(); break;
      case "Escape": if (chatState.open) { closeChatInput(false); } else { document.exitPointerLock(); } break;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (isTypingInUi(event.target)) return;
    switch (event.code) {
      case "KeyW": case "ArrowUp": input.forward = false; break;
      case "KeyS": case "ArrowDown": input.back = false; break;
      case "KeyA": case "ArrowLeft": input.left = false; break;
      case "KeyD": case "ArrowRight": input.right = false; break;
      case "ShiftLeft": case "ShiftRight": input.sprint = false; break;
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
        miningState.mouseDown = true;
        hitBlock();
      }
      swingTime = 1;
    } else if (event.button === 2) {
      placeBlock();
      swingTime = 1;
    }
  });

  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      miningState.mouseDown = false;
      resetMining(miningState);
    }
  });

  window.addEventListener("contextmenu", (event) => event.preventDefault());
}

// --- Networking ---
function startMultiplayer(playerName: string, serverUrl: string) {
  networkState.started = true;
  networkState.playerName = playerName;
  networkState.appearanceSeed = createAppearanceSeed();
  networkState.lastError = "";
  networkState.serverCandidates = buildServerCandidates(serverUrl);
  networkState.currentServerIndex = 0;
  networkState.serverUrl = networkState.serverCandidates[0] || getDefaultServerUrl();
  refreshTitleScreen();
  if (networkState.reconnectTimer) { window.clearTimeout(networkState.reconnectTimer); networkState.reconnectTimer = 0; }
  if (networkState.ws) networkState.ws.close();
  clearRemotePlayers(remotePlayers, remotePlayersLayer);
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

  const connectTimeout = window.setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) ws.close();
  }, 4000);

  ws.onopen = () => {
    window.clearTimeout(connectTimeout);
    if (networkState.ws !== ws) return;
    networkState.connecting = false;
    networkState.connected = true;
    networkState.lastError = "";
    refreshTitleScreen();
    ws.send(JSON.stringify({
      type: "join",
      name: networkState.playerName,
      appearanceSeed: networkState.appearanceSeed,
      x: player.position.x, y: player.position.y, z: player.position.z,
      yaw, pitch,
      heldItemId: getCurrentHeldItemToken(),
    }));
    gameLog.success(`Connected to ${networkState.serverUrl}`);
  };

  ws.onmessage = (event) => {
    let message: ServerMessage | null = null;
    try { message = JSON.parse(event.data as string) as ServerMessage; } catch { return; }
    handleServerMessage(message);
  };

  ws.onclose = () => {
    window.clearTimeout(connectTimeout);
    if (networkState.ws !== ws) return;
    networkState.ws = null;
    networkState.connecting = false;
    const wasConnected = networkState.connected;
    networkState.connected = false;
    networkState.myId = "";
    clearRemotePlayers(remotePlayers, remotePlayersLayer);
    refreshTitleScreen();
    if (networkState.started) {
      if (wasConnected && networkState.pageActive) gameLog.warn("Server connection lost. Reconnecting...");
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    networkState.lastError = `no connection to ${networkState.serverUrl.replace(/^wss?:\/\//, "")}`;
    if (ws.readyState !== WebSocket.CLOSED) ws.close();
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
  }, 1000);
}

function handleServerMessage(message: ServerMessage) {
  switch (message.type) {
    case "init": {
      networkState.myId = message.id;
      networkState.connected = true;
      clearRemotePlayers(remotePlayers, remotePlayersLayer);
      for (const edit of message.blocks) {
        world.setBlock(edit.x, edit.y, edit.z, edit.block as BlockId);
      }
      for (const state of message.players) {
        if (state.id !== networkState.myId) {
          upsertRemotePlayer(state, true, remotePlayers, remotePlayersLayer, world);
        }
      }
      sendLocalPlayerState();
      break;
    }
    case "player_join":
      if (message.player.id !== networkState.myId) {
        upsertRemotePlayer(message.player, true, remotePlayers, remotePlayersLayer, world);
        gameLog.system(`${message.player.name} joined`);
      }
      break;
    case "player_leave":
      removeRemotePlayer(message.id, remotePlayers, remotePlayersLayer);
      break;
    case "snapshot": {
      const seen = new Set<string>();
      for (const state of message.players) {
        if (state.id === networkState.myId) continue;
        seen.add(state.id);
        upsertRemotePlayer(state, false, remotePlayers, remotePlayersLayer, world);
      }
      for (const id of remotePlayers.keys()) {
        if (!seen.has(id)) removeRemotePlayer(id, remotePlayers, remotePlayersLayer);
      }
      break;
    }
    case "set_block":
      world.setBlock(message.x, message.y, message.z, message.block as BlockId);
      if (!isPositionSafe(player.position)) recoverPlayer();
      break;
    case "chat":
      gameLog.chat(message.name, message.text);
      if (message.id !== networkState.myId) showRemotePlayerChat(message.id, message.text, remotePlayers);
      break;
    case "shoot_arrow": {
      const dir = new THREE.Vector3(message.dx, message.dy, message.dz).normalize();
      const orig = new THREE.Vector3(message.ox, message.oy, message.oz);
      spawnArrow(orig, dir, message.id, arrowsLayer, combat);
      break;
    }
    case "damage":
      if (message.targetId === networkState.myId) {
        player.hp = message.hp;
        updateHpBar(hud, player.hp);
        renderer.domElement.style.filter = "brightness(2)";
        setTimeout(() => { if (!player.dead) renderer.domElement.style.filter = ""; }, 120);
      }
      break;
    case "death": {
      if (message.targetId === networkState.myId) localPlayerDie();
      const deadAvatar = remotePlayers.get(message.targetId);
      if (deadAvatar) startRemoteDeathAnimation(deadAvatar, remotePlayersLayer);
      const killerName = message.killerId === networkState.myId ? "You" : getRemotePlayerName(message.killerId, remotePlayers);
      const victimName = message.targetId === networkState.myId ? "You" : getRemotePlayerName(message.targetId, remotePlayers);
      gameLog.system(`${killerName} killed ${victimName}`);
      break;
    }
    case "respawn":
      if (message.targetId === networkState.myId) {
        localPlayerRespawn(message.x, message.y, message.z);
      } else {
        const avatar = remotePlayers.get(message.targetId);
        if (avatar) {
          endRemoteDeathAnimation(avatar, remotePlayersLayer);
          avatar.targetPosition.set(message.x, message.y, message.z);
          avatar.root.position.set(message.x, message.y, message.z);
          avatar.lastVisualPosition.set(message.x, message.y, message.z);
        }
      }
      break;
  }
}

function sendLocalPlayerState() {
  if (!networkState.connected || !networkState.ws || networkState.ws.readyState !== WebSocket.OPEN) return;
  networkState.ws.send(JSON.stringify({
    type: "player_state",
    x: player.position.x, y: player.position.y, z: player.position.z,
    yaw, pitch,
    heldItemId: getCurrentHeldItemToken(),
  }));
}

function sendBlockUpdate(x: number, y: number, z: number, block: BlockId) {
  if (!networkState.connected || !networkState.ws) return;
  networkState.ws.send(JSON.stringify({ type: "set_block", x, y, z, block }));
}
