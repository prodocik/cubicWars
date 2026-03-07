import * as THREE from "three";
import { MOVE_SPEED, REMOTE_SMOOTHING, CHAT_BUBBLE_DURATION_MS } from "./constants";
import type { RemotePlayerState } from "./multiplayerProtocol";
import type { VoxelWorld } from "./voxelWorld";
import { createHeldMeshFromToken } from "./items";
import { disposeObject3D, lerpAngle, createAvatarPalette, roundRect, wrapChatText } from "./utils";

export interface RemoteAvatar {
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

export function createRemotePlayer(state: RemotePlayerState, layer: THREE.Group): RemoteAvatar {
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
  layer.add(root);

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
  setRemoteHeldItem(avatar, state.heldItemId, world_);
  return avatar;
}

// Module-level world reference set via init
let world_: VoxelWorld;
export function initRemotePlayers(world: VoxelWorld) {
  world_ = world;
}

export function setRemoteHeldItem(avatar: RemoteAvatar, token: string, world: VoxelWorld) {
  if (avatar.heldItemMesh) {
    avatar.heldPivot.remove(avatar.heldItemMesh);
    avatar.heldItemMesh = null;
  }

  const mesh = createHeldMeshFromToken(token, world);
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

export function upsertRemotePlayer(
  state: RemotePlayerState, snapNow: boolean,
  remotePlayers: Map<string, RemoteAvatar>, layer: THREE.Group, world: VoxelWorld
) {
  let avatar = remotePlayers.get(state.id);
  if (avatar && avatar.appearanceSeed !== state.appearanceSeed) {
    removeRemotePlayer(state.id, remotePlayers, layer);
    avatar = undefined;
  }

  if (!avatar) {
    avatar = createRemotePlayer(state, layer);
    remotePlayers.set(state.id, avatar);
  }

  avatar.name = state.name;
  avatar.appearanceSeed = state.appearanceSeed;
  avatar.targetPosition.set(state.x, state.y, state.z);
  avatar.targetYaw = state.yaw + Math.PI;
  avatar.targetPitch = -state.pitch;

  if (avatar.heldItemId !== state.heldItemId) {
    setRemoteHeldItem(avatar, state.heldItemId, world);
  }

  if (snapNow) {
    avatar.root.position.copy(avatar.targetPosition);
    avatar.root.rotation.y = avatar.targetYaw;
    avatar.headPitch.rotation.x = avatar.targetPitch;
    avatar.lastVisualPosition.copy(avatar.root.position);
  }
}

export function removeRemotePlayer(id: string, remotePlayers: Map<string, RemoteAvatar>, layer: THREE.Group) {
  const avatar = remotePlayers.get(id);
  if (!avatar) return;
  layer.remove(avatar.root);
  disposeObject3D(avatar.root);
  remotePlayers.delete(id);
}

export function clearRemotePlayers(remotePlayers: Map<string, RemoteAvatar>, layer: THREE.Group) {
  for (const id of Array.from(remotePlayers.keys())) {
    removeRemotePlayer(id, remotePlayers, layer);
  }
}

export function updateRemotePlayers(dt: number, remotePlayers: Map<string, RemoteAvatar>) {
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

export function showRemotePlayerChat(id: string, text: string, remotePlayers: Map<string, RemoteAvatar>) {
  const avatar = remotePlayers.get(id);
  if (!avatar) return;
  setBubbleText(avatar.bubble, text);
  avatar.bubble.visible = true;
  avatar.bubbleExpiresAt = performance.now() + CHAT_BUBBLE_DURATION_MS;
}

export function startRemoteDeathAnimation(avatar: RemoteAvatar, layer: THREE.Group) {
  avatar.dead = true;
  avatar.deathTime = 0;

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
  const toRemove: THREE.Object3D[] = [];
  soul.traverse((child) => { if (child instanceof THREE.Sprite) toRemove.push(child); });
  toRemove.forEach((s) => s.removeFromParent());

  soul.position.copy(avatar.root.position);
  soul.rotation.copy(avatar.root.rotation);
  layer.add(soul);
  avatar.soul = soul;
}

export function endRemoteDeathAnimation(avatar: RemoteAvatar, layer: THREE.Group) {
  avatar.dead = false;
  avatar.deathTime = 0;
  avatar.root.rotation.x = 0;
  avatar.root.visible = true;
  if (avatar.soul) {
    layer.remove(avatar.soul);
    disposeObject3D(avatar.soul);
    avatar.soul = null;
  }
}

export function updateRemoteDeathAnimations(dt: number, remotePlayers: Map<string, RemoteAvatar>, layer: THREE.Group) {
  for (const avatar of remotePlayers.values()) {
    if (!avatar.dead) continue;
    avatar.deathTime += dt;

    const fallProgress = Math.min(1, avatar.deathTime / 0.6);
    avatar.root.rotation.x = fallProgress * (Math.PI / 2);

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
        layer.remove(avatar.soul);
        disposeObject3D(avatar.soul);
        avatar.soul = null;
      }
    }
  }
}

export function getRemotePlayerName(id: string, remotePlayers: Map<string, RemoteAvatar>) {
  const avatar = remotePlayers.get(id);
  return avatar ? avatar.name : "Player";
}

// Sprite helpers
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
