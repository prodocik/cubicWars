import * as THREE from "three";
import { BlockId, PLAYER_HEIGHT, isTorchBlock } from "./voxelWorld";
import type { VoxelWorld } from "./voxelWorld";
import { MAX_HP } from "./constants";
import { disposeObject3D } from "./utils";

// --- Constants ---
const ROCKET_INITIAL_SPEED = 8;
const ROCKET_MAX_SPEED = 65;
const ROCKET_ACCELERATION = 40;
const ROCKET_MAX_DISTANCE = 200;
const EXPLOSION_RADIUS = 5; // 10x10 block area = radius 5
const EXPLOSION_DAMAGE_CENTER = MAX_HP; // instant kill at center
const EXPLOSION_DAMAGE_EDGE = 40; // 40% at edge
const SMOKE_INTERVAL = 0.02; // spawn smoke every 20ms
const SMOKE_LIFETIME = 1.8;
const EXPLOSION_FLASH_DURATION = 0.3;
const EXPLOSION_PARTICLE_COUNT = 40;
const EXPLOSION_PARTICLE_LIFETIME = 1.5;

// --- Crosshair ---
let crosshairEl: HTMLDivElement | null = null;

export function createRpgCrosshair(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:25;display:none";
  // Large circle crosshair
  const ring = document.createElement("div");
  ring.style.cssText = "width:80px;height:80px;border:3px solid rgba(255,60,30,0.85);border-radius:50%;position:relative";
  // Inner cross
  const h = document.createElement("div");
  h.style.cssText = "position:absolute;left:15px;right:15px;top:50%;height:2px;transform:translateY(-50%);background:rgba(255,60,30,0.7)";
  const v = document.createElement("div");
  v.style.cssText = "position:absolute;top:15px;bottom:15px;left:50%;width:2px;transform:translateX(-50%);background:rgba(255,60,30,0.7)";
  // Center dot
  const dot = document.createElement("div");
  dot.style.cssText = "position:absolute;left:50%;top:50%;width:6px;height:6px;border-radius:50%;background:rgba(255,40,20,0.9);transform:translate(-50%,-50%)";
  ring.append(h, v, dot);
  el.appendChild(ring);
  crosshairEl = el;
  return el;
}

export function showRpgCrosshair(visible: boolean) {
  if (crosshairEl) crosshairEl.style.display = visible ? "block" : "none";
}

// --- Rocket projectile ---
export interface Rocket {
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  speed: number;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  alive: boolean;
  shooterId: string;
  smokeTimer: number;
}

interface SmokeParticle {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  startScale: number;
}

interface ExplosionParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

const smokeGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
const smokeMats = [
  new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.7 }),
  new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.6 }),
  new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.5 }),
];

const explosionGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const explosionColors = [0xff3000, 0xff6010, 0xff8020, 0xffb040, 0x222222, 0x444444, 0xffff60];

let rockets: Rocket[] = [];
let smokeParticles: SmokeParticle[] = [];
let explosionParticles: ExplosionParticle[] = [];

// Explosion flash
let flashOverlay: HTMLDivElement | null = null;
let flashTimer = 0;

export function createFlashOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:18;background:rgba(255,200,100,0.8);display:none";
  flashOverlay = el;
  return el;
}

export function createRocketMesh(): THREE.Group {
  const group = new THREE.Group();

  // Body tube (olive/green)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.9),
    new THREE.MeshLambertMaterial({ color: 0x4a5a30 })
  );

  // Warhead (darker, pointed)
  const warhead = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 0.25),
    new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
  );
  warhead.position.z = 0.55;

  // Fins (4 fins at the back)
  const finMat = new THREE.MeshLambertMaterial({ color: 0x5a6a38 });
  const fin1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.2), finMat);
  fin1.position.set(0, 0, -0.4);
  const fin2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.2), finMat);
  fin2.position.set(0, 0, -0.4);

  // Nozzle (back)
  const nozzle = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  nozzle.position.z = -0.5;

  group.add(body, warhead, fin1, fin2, nozzle);
  return group;
}

export function createRpgHeldMesh(): THREE.Group {
  const group = new THREE.Group();

  // Launcher tube
  const tube = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, 0.85),
    new THREE.MeshLambertMaterial({ color: 0x4a5a30 })
  );

  // Grip
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.25, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x3a3020 })
  );
  grip.position.set(0, -0.15, -0.1);

  // Sight
  const sight = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.1, 0.04),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  sight.position.set(0, 0.1, 0.2);

  // Warhead sticking out front
  const warhead = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
  );
  warhead.position.z = 0.5;

  // Bell at the back
  const bell = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 0.08),
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  bell.position.z = -0.45;

  group.add(tube, grip, sight, warhead, bell);
  group.rotation.set(0.2, 0.8, 0.1);
  group.position.set(0.1, -0.05, -0.1);
  return group;
}

export function fireRocket(
  origin: THREE.Vector3, direction: THREE.Vector3,
  shooterId: string, scene: THREE.Scene
) {
  const mesh = createRocketMesh();
  mesh.position.copy(origin).addScaledVector(direction, 1.0);
  mesh.lookAt(mesh.position.clone().add(direction));
  scene.add(mesh);

  rockets.push({
    mesh,
    velocity: direction.clone().multiplyScalar(ROCKET_INITIAL_SPEED),
    speed: ROCKET_INITIAL_SPEED,
    origin: origin.clone(),
    direction: direction.clone().normalize(),
    alive: true,
    shooterId,
    smokeTimer: 0,
  });
}

export function updateRockets(
  dt: number, scene: THREE.Scene, world: VoxelWorld,
  myId: string, playerDead: boolean, playerPos: THREE.Vector3,
  remotePlayers: Map<string, { id: string; dead: boolean; root: THREE.Group }>,
  applyExplosionDamage: (center: THREE.Vector3, shooterId: string) => void
) {
  // Update rockets
  for (const rocket of rockets) {
    if (!rocket.alive) continue;

    // Accelerate
    rocket.speed = Math.min(rocket.speed + ROCKET_ACCELERATION * dt, ROCKET_MAX_SPEED);
    rocket.velocity.copy(rocket.direction).multiplyScalar(rocket.speed);

    const prevPos = rocket.mesh.position.clone();
    const step = rocket.velocity.clone().multiplyScalar(dt);
    const nextPos = prevPos.clone().add(step);

    // Check block collision via raycast
    const moveDir = step.clone();
    const moveLen = moveDir.length();
    if (moveLen > 0) {
      moveDir.divideScalar(moveLen);
      const hit = world.raycast(prevPos, moveDir, moveLen + 0.3);
      if (hit) {
        const impactPos = prevPos.clone().addScaledVector(moveDir, hit.distance);
        explode(impactPos, rocket.shooterId, scene, world, applyExplosionDamage);
        scene.remove(rocket.mesh);
        disposeObject3D(rocket.mesh);
        rocket.alive = false;
        continue;
      }
    }

    // Check player collision
    let hitPlayer = false;
    // Check remote players if we shot it
    if (rocket.shooterId === myId) {
      for (const avatar of remotePlayers.values()) {
        if (avatar.dead) continue;
        const d = nextPos.distanceTo(new THREE.Vector3(
          avatar.root.position.x,
          avatar.root.position.y + PLAYER_HEIGHT * 0.5,
          avatar.root.position.z
        ));
        if (d < 1.0) {
          explode(nextPos, rocket.shooterId, scene, world, applyExplosionDamage);
          scene.remove(rocket.mesh);
          disposeObject3D(rocket.mesh);
          rocket.alive = false;
          hitPlayer = true;
          break;
        }
      }
    }
    // Check if hits local player (not our rocket)
    if (!hitPlayer && rocket.shooterId !== myId && !playerDead) {
      const d = nextPos.distanceTo(new THREE.Vector3(
        playerPos.x, playerPos.y + PLAYER_HEIGHT * 0.5, playerPos.z
      ));
      if (d < 1.0) {
        explode(nextPos, rocket.shooterId, scene, world, applyExplosionDamage);
        scene.remove(rocket.mesh);
        disposeObject3D(rocket.mesh);
        rocket.alive = false;
        hitPlayer = true;
      }
    }
    if (hitPlayer) continue;

    // Move
    rocket.mesh.position.copy(nextPos);
    rocket.mesh.lookAt(nextPos.clone().add(rocket.velocity));

    // Spawn smoke trail
    rocket.smokeTimer += dt;
    while (rocket.smokeTimer >= SMOKE_INTERVAL) {
      rocket.smokeTimer -= SMOKE_INTERVAL;
      spawnSmoke(scene, rocket.mesh.position, rocket.speed);
    }

    // Max distance
    if (prevPos.distanceTo(rocket.origin) > ROCKET_MAX_DISTANCE) {
      explode(rocket.mesh.position.clone(), rocket.shooterId, scene, world, applyExplosionDamage);
      scene.remove(rocket.mesh);
      disposeObject3D(rocket.mesh);
      rocket.alive = false;
    }
  }

  // Cleanup dead rockets
  for (let i = rockets.length - 1; i >= 0; i--) {
    if (!rockets[i].alive) rockets.splice(i, 1);
  }

  // Update smoke
  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const p = smokeParticles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      smokeParticles.splice(i, 1);
      continue;
    }
    const t = p.life / p.maxLife;
    // Expand and fade
    const scale = p.startScale * (1 + t * 3);
    p.mesh.scale.setScalar(scale);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.6;
    // Drift upward slightly
    p.mesh.position.y += 0.3 * dt;
  }

  // Update explosion particles
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const p = explosionParticles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      explosionParticles.splice(i, 1);
      continue;
    }
    p.velocity.y -= 15 * dt; // gravity
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.mesh.rotation.x += dt * 8;
    p.mesh.rotation.y += dt * 5;
    const t = p.life / p.maxLife;
    p.mesh.scale.setScalar(Math.max(0, 1 - t * t));
  }

  // Update flash
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0 && flashOverlay) {
      flashOverlay.style.display = "none";
    } else if (flashOverlay) {
      const t = flashTimer / EXPLOSION_FLASH_DURATION;
      flashOverlay.style.background = `rgba(255,200,100,${t * 0.7})`;
    }
  }
}

function spawnSmoke(scene: THREE.Scene, pos: THREE.Vector3, speed: number) {
  const mat = smokeMats[Math.floor(Math.random() * smokeMats.length)].clone();
  const mesh = new THREE.Mesh(smokeGeo, mat);
  const spread = 0.15 + (speed / ROCKET_MAX_SPEED) * 0.2;
  mesh.position.set(
    pos.x + (Math.random() - 0.5) * spread,
    pos.y + (Math.random() - 0.5) * spread,
    pos.z + (Math.random() - 0.5) * spread
  );
  mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  const startScale = 0.5 + Math.random() * 0.5;
  mesh.scale.setScalar(startScale);
  scene.add(mesh);

  smokeParticles.push({
    mesh,
    life: 0,
    maxLife: SMOKE_LIFETIME + Math.random() * 0.5,
    startScale,
  });
}

function explode(
  center: THREE.Vector3, shooterId: string,
  scene: THREE.Scene, world: VoxelWorld,
  applyExplosionDamage: (center: THREE.Vector3, shooterId: string) => void
) {
  // Destroy blocks in radius
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);
  const r = EXPLOSION_RADIUS;

  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > r) continue;
        const bx = cx + dx, by = cy + dy, bz = cz + dz;
        const block = world.getBlock(bx, by, bz);
        if (block === BlockId.Air || block === BlockId.Bedrock || block === BlockId.Water) continue;
        world.setBlock(bx, by, bz, BlockId.Air);
      }
    }
  }

  // Spawn explosion particles
  for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
    const color = explosionColors[Math.floor(Math.random() * explosionColors.length)];
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(explosionGeo, mat);
    mesh.position.set(
      center.x + (Math.random() - 0.5) * 2,
      center.y + (Math.random() - 0.5) * 2,
      center.z + (Math.random() - 0.5) * 2
    );
    scene.add(mesh);
    const dir = mesh.position.clone().sub(center).normalize();
    const speed = 5 + Math.random() * 12;
    explosionParticles.push({
      mesh,
      velocity: dir.multiplyScalar(speed).add(new THREE.Vector3(0, 3 + Math.random() * 4, 0)),
      life: 0,
      maxLife: EXPLOSION_PARTICLE_LIFETIME + Math.random() * 0.5,
    });
  }

  // Big smoke burst
  for (let i = 0; i < 15; i++) {
    const smokePos = center.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 3
    ));
    spawnSmoke(scene, smokePos, ROCKET_MAX_SPEED);
  }

  // Flash
  if (flashOverlay) {
    flashOverlay.style.display = "block";
    flashTimer = EXPLOSION_FLASH_DURATION;
  }

  // Apply damage to players
  applyExplosionDamage(center, shooterId);
}

export function getExplosionDamage(playerPos: THREE.Vector3, explosionCenter: THREE.Vector3): number {
  const dist = playerPos.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT * 0.5, 0)).distanceTo(explosionCenter);
  if (dist >= EXPLOSION_RADIUS) return 0;
  if (dist <= 1) return EXPLOSION_DAMAGE_CENTER; // instant kill at center
  // Linear falloff from center to edge
  const t = (dist - 1) / (EXPLOSION_RADIUS - 1);
  return Math.round(EXPLOSION_DAMAGE_CENTER * (1 - t) + EXPLOSION_DAMAGE_EDGE * t);
}
