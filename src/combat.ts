import * as THREE from "three";
import {
  ARROW_SPEED, ARROW_GRAVITY, ARROW_MAX_DISTANCE,
  ARROW_HIT_RADIUS, MAX_STUCK_ARROWS, STUCK_ARROW_LIFETIME,
  BOW_COOLDOWN, MAX_HP, RESPAWN_COUNTDOWN,
} from "./constants";
import { PLAYER_HEIGHT } from "./voxelWorld";
import type { VoxelWorld } from "./voxelWorld";
import { createArrowMesh } from "./items";
import { disposeObject3D } from "./utils";

export interface FlyingArrow {
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  origin: THREE.Vector3;
  alive: boolean;
  shooterId: string;
}

export interface StuckArrow {
  mesh: THREE.Group;
  expiresAt: number;
}

export interface CombatState {
  flyingArrows: FlyingArrow[];
  stuckArrows: StuckArrow[];
  lastShotTime: number;
}

export function createCombatState(): CombatState {
  return {
    flyingArrows: [],
    stuckArrows: [],
    lastShotTime: 0,
  };
}

export function spawnArrow(
  origin: THREE.Vector3, direction: THREE.Vector3, shooterId: string,
  arrowsLayer: THREE.Group, combat: CombatState
) {
  const mesh = createArrowMesh();
  mesh.position.copy(origin).addScaledVector(direction, 0.8);
  mesh.lookAt(mesh.position.clone().add(direction));
  arrowsLayer.add(mesh);

  combat.flyingArrows.push({
    mesh,
    velocity: direction.clone().multiplyScalar(ARROW_SPEED),
    origin: origin.clone(),
    alive: true,
    shooterId,
  });
}

export function canShoot(combat: CombatState) {
  const now = performance.now() / 1000;
  return now - combat.lastShotTime >= BOW_COOLDOWN;
}

export function markShot(combat: CombatState) {
  combat.lastShotTime = performance.now() / 1000;
}

export function updateArrows(
  dt: number, combat: CombatState, world: VoxelWorld, arrowsLayer: THREE.Group,
  myId: string, playerDead: boolean, playerPos: THREE.Vector3,
  cameraRig: THREE.Group, remotePlayers: Map<string, { id: string; dead: boolean; root: THREE.Group }>,
  sendHitPlayerFn: (targetId: string, attackerId: string) => void
) {
  const step = new THREE.Vector3();

  for (const arrow of combat.flyingArrows) {
    if (!arrow.alive) continue;

    arrow.velocity.y -= ARROW_GRAVITY * dt;
    step.copy(arrow.velocity).multiplyScalar(dt);

    const prevPos = arrow.mesh.position.clone();
    const nextPos = prevPos.clone().add(step);

    const moveDir = step.clone();
    const moveLen = moveDir.length();
    if (moveLen > 0) {
      moveDir.divideScalar(moveLen);
      const hit = world.raycast(prevPos, moveDir, moveLen + 0.15);
      if (hit) {
        arrow.mesh.position.copy(prevPos).addScaledVector(moveDir, hit.distance - 0.05);
        arrow.mesh.lookAt(arrow.mesh.position.clone().add(arrow.velocity));
        stickArrow(arrow, combat);
        continue;
      }
    }

    arrow.mesh.position.copy(nextPos);
    arrow.mesh.lookAt(nextPos.clone().add(arrow.velocity));

    if (arrow.shooterId !== myId && !playerDead) {
      const dx = nextPos.x - playerPos.x;
      const dz = nextPos.z - playerPos.z;
      const dy = nextPos.y - (playerPos.y + PLAYER_HEIGHT * 0.5);
      if (dx * dx + dz * dz < ARROW_HIT_RADIUS * ARROW_HIT_RADIUS && Math.abs(dy) < PLAYER_HEIGHT * 0.6) {
        sendHitPlayerFn(myId, arrow.shooterId);
        stickArrowToPlayer(arrow, cameraRig, combat);
        continue;
      }
    }

    if (arrow.shooterId === myId) {
      for (const avatar of remotePlayers.values()) {
        if (avatar.dead) continue;
        const ax = nextPos.x - avatar.root.position.x;
        const az = nextPos.z - avatar.root.position.z;
        const ay = nextPos.y - (avatar.root.position.y + PLAYER_HEIGHT * 0.5);
        if (ax * ax + az * az < ARROW_HIT_RADIUS * ARROW_HIT_RADIUS && Math.abs(ay) < PLAYER_HEIGHT * 0.6) {
          sendHitPlayerFn(avatar.id, arrow.shooterId);
          stickArrowToPlayer(arrow, avatar.root, combat);
          break;
        }
      }
      if (!arrow.alive) continue;
    }

    if (prevPos.distanceTo(arrow.origin) > ARROW_MAX_DISTANCE) {
      arrowsLayer.remove(arrow.mesh);
      disposeObject3D(arrow.mesh);
      arrow.alive = false;
    }
  }

  for (let i = combat.flyingArrows.length - 1; i >= 0; i--) {
    if (!combat.flyingArrows[i].alive) combat.flyingArrows.splice(i, 1);
  }
}

function stickArrow(arrow: FlyingArrow, combat: CombatState) {
  arrow.alive = false;
  const now = performance.now() / 1000;
  combat.stuckArrows.push({ mesh: arrow.mesh, expiresAt: now + STUCK_ARROW_LIFETIME });
  pruneStuckArrows(combat);
}

function stickArrowToPlayer(arrow: FlyingArrow, target: THREE.Object3D, combat: CombatState) {
  arrow.alive = false;
  const localPos = target.worldToLocal(arrow.mesh.position.clone());
  arrow.mesh.parent?.remove(arrow.mesh);
  arrow.mesh.position.copy(localPos);
  const worldQuat = new THREE.Quaternion();
  arrow.mesh.getWorldQuaternion(worldQuat);
  const parentQuat = new THREE.Quaternion();
  target.getWorldQuaternion(parentQuat);
  arrow.mesh.quaternion.copy(parentQuat.invert().multiply(worldQuat));

  target.add(arrow.mesh);
  const now = performance.now() / 1000;
  combat.stuckArrows.push({ mesh: arrow.mesh, expiresAt: now + STUCK_ARROW_LIFETIME });
  pruneStuckArrows(combat);
}

function pruneStuckArrows(combat: CombatState) {
  while (combat.stuckArrows.length > MAX_STUCK_ARROWS) {
    const old = combat.stuckArrows.shift()!;
    old.mesh.removeFromParent();
    disposeObject3D(old.mesh);
  }
}

export function updateStuckArrows(combat: CombatState) {
  const now = performance.now() / 1000;
  for (let i = combat.stuckArrows.length - 1; i >= 0; i--) {
    if (now >= combat.stuckArrows[i].expiresAt) {
      const sa = combat.stuckArrows[i];
      sa.mesh.removeFromParent();
      disposeObject3D(sa.mesh);
      combat.stuckArrows.splice(i, 1);
    }
  }
}

export { MAX_HP, RESPAWN_COUNTDOWN };
