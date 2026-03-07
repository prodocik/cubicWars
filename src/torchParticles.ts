import * as THREE from "three";
import { BlockId, isTorchBlock } from "./voxelWorld";
import type { VoxelWorld } from "./voxelWorld";

interface TorchParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

const particleGeo = new THREE.BoxGeometry(0.035, 0.035, 0.035);

// Pre-create materials for reuse
const PARTICLE_COLORS = [
  0xff2800, 0xff4010, 0xff6020, // red/orange
  0x181008, 0x100804, 0x080404, // dark smoke
];
const materials = PARTICLE_COLORS.map(
  c => new THREE.MeshBasicMaterial({ color: c })
);

const particles: TorchParticle[] = [];
const torchFlamePositions: THREE.Vector3[] = [];
let scanTimer = 10; // scan immediately on first frame
const SCAN_INTERVAL = 1.5;
const SCAN_RADIUS = 8;
const MAX_PARTICLES = 60;
let spawnAccum = 0;
const SPAWN_RATE = 2.5; // particles per torch per second

export function updateTorchParticles(
  dt: number, scene: THREE.Scene, world: VoxelWorld, playerPos: THREE.Vector3
) {
  // Scan for nearby torches periodically
  scanTimer += dt;
  if (scanTimer >= SCAN_INTERVAL) {
    scanTimer = 0;
    scanNearbyTorches(world, playerPos);
  }

  // Spawn particles
  if (torchFlamePositions.length > 0 && particles.length < MAX_PARTICLES) {
    spawnAccum += dt * SPAWN_RATE;
    while (spawnAccum >= 1 && particles.length < MAX_PARTICLES) {
      spawnAccum -= 1;
      // Pick a random torch to emit from
      const pos = torchFlamePositions[Math.floor(Math.random() * torchFlamePositions.length)];
      spawnParticle(scene, pos);
    }
  }

  // Update existing particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
      continue;
    }

    p.mesh.position.addScaledVector(p.velocity, dt);
    // Slight horizontal drift
    p.velocity.x += (Math.random() - 0.5) * 1.5 * dt;
    p.velocity.z += (Math.random() - 0.5) * 1.5 * dt;
    // Slow upward acceleration
    p.velocity.y += 0.5 * dt;

    const t = p.life / p.maxLife;
    p.mesh.scale.setScalar(Math.max(0, 1 - t * t));
  }
}

function scanNearbyTorches(world: VoxelWorld, playerPos: THREE.Vector3) {
  torchFlamePositions.length = 0;
  const px = Math.floor(playerPos.x);
  const py = Math.floor(playerPos.y);
  const pz = Math.floor(playerPos.z);

  for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
    for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
      for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
        const bx = px + dx, by = py + dy, bz = pz + dz;
        const block = world.getBlock(bx, by, bz);
        if (isTorchBlock(block)) {
          torchFlamePositions.push(getFlamePos(bx, by, bz, block));
        }
      }
    }
  }
}

function getFlamePos(bx: number, by: number, bz: number, block: BlockId): THREE.Vector3 {
  // Approximate flame top position for each variant
  if (block === BlockId.Torch) return new THREE.Vector3(bx + 0.5, by + 0.47, bz + 0.5);
  // Wall torches: flame is at tilted top, offset from wall
  // These are approximate - the rotation puts the flame roughly here
  const tilt = 0.44, sH = 5 / 16, fTop = sH + 2.5 / 16;
  const topOffset = fTop * Math.sin(tilt); // ~0.14 horizontal
  const topY = 0.35 + fTop * Math.cos(tilt); // ~0.35 + 0.43 = 0.78
  if (block === BlockId.TorchE) return new THREE.Vector3(bx + topOffset, by + topY, bz + 0.5);
  if (block === BlockId.TorchW) return new THREE.Vector3(bx + 1 - topOffset, by + topY, bz + 0.5);
  if (block === BlockId.TorchS) return new THREE.Vector3(bx + 0.5, by + topY, bz + topOffset);
  if (block === BlockId.TorchN) return new THREE.Vector3(bx + 0.5, by + topY, bz + 1 - topOffset);
  return new THREE.Vector3(bx + 0.5, by + 0.5, bz + 0.5);
}

function spawnParticle(scene: THREE.Scene, pos: THREE.Vector3) {
  const mat = materials[Math.floor(Math.random() * materials.length)];
  const mesh = new THREE.Mesh(particleGeo, mat);
  mesh.position.set(
    pos.x + (Math.random() - 0.5) * 0.08,
    pos.y + Math.random() * 0.04,
    pos.z + (Math.random() - 0.5) * 0.08
  );
  scene.add(mesh);

  particles.push({
    mesh,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.2,
      0.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 0.2
    ),
    life: 0,
    maxLife: 0.3 + Math.random() * 0.5,
  });
}
