import * as THREE from "three";
import { BlockId, EYE_HEIGHT } from "./voxelWorld";
import { MINE_INTERVAL } from "./constants";

export const BLOCK_COLORS: Record<number, number[]> = {
  [BlockId.Grass]: [0x5b8c3e, 0x8b6d2c, 0x6b9a3f],
  [BlockId.Dirt]: [0x8b6d2c, 0x6b5020, 0x9c7a3a],
  [BlockId.Stone]: [0x808080, 0x666666, 0x999999],
  [BlockId.Log]: [0x6b4226, 0x8b5a2b, 0x503018],
  [BlockId.Leaves]: [0x3a8c30, 0x2e6d28, 0x4ca040],
  [BlockId.Sand]: [0xe8d088, 0xdcc47a, 0xc4a858],
  [BlockId.Snow]: [0xf0f4f8, 0xe8ecf0, 0xd0d8e0],
  [BlockId.Cactus]: [0x2a8030, 0x308838, 0x40a048],
};

export function getRequiredHits(block: BlockId, tool: string): number {
  if (tool === "pickaxe") {
    if (block === BlockId.Dirt || block === BlockId.Grass || block === BlockId.Sand) return 1;
    if (block === BlockId.Stone) return 4;
    if (block === BlockId.Log) return 4;
    if (block === BlockId.Leaves) return 1;
  }
  if (tool === "axe") {
    if (block === BlockId.Log) return 1;
    if (block === BlockId.Leaves) return 1;
    if (block === BlockId.Dirt || block === BlockId.Grass) return 3;
    if (block === BlockId.Stone) return 7;
  }
  // Hand
  if (block === BlockId.Dirt || block === BlockId.Grass || block === BlockId.Snow) return 5;
  if (block === BlockId.Sand) return 3;
  if (block === BlockId.Stone) return 7;
  if (block === BlockId.Log) return 4;
  if (block === BlockId.Leaves) return 2;
  if (block === BlockId.Cactus) return 3;
  return 5;
}

export interface MiningState {
  active: boolean;
  blockX: number;
  blockY: number;
  blockZ: number;
  hits: number;
  required: number;
  timer: number;
  mouseDown: boolean;
}

export function createMiningState(): MiningState {
  return {
    active: false,
    blockX: 0,
    blockY: 0,
    blockZ: 0,
    hits: 0,
    required: 0,
    timer: 0,
    mouseDown: false,
  };
}

// Crack overlay
const crackOverlayMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

export const crackOverlay = new THREE.Mesh(
  new THREE.BoxGeometry(1.005, 1.005, 1.005),
  crackOverlayMat
);
crackOverlay.visible = false;

export function resetMining(state: MiningState) {
  state.active = false;
  state.hits = 0;
  state.timer = 0;
  crackOverlay.visible = false;
}

export function updateCrackOverlay(state: MiningState) {
  if (!state.active || state.required <= 0) {
    crackOverlay.visible = false;
    return;
  }
  const progress = state.hits / state.required;
  crackOverlay.position.set(
    state.blockX + 0.5,
    state.blockY + 0.5,
    state.blockZ + 0.5
  );
  crackOverlayMat.opacity = progress * 0.55;
  crackOverlay.visible = true;
}

// Break particles
export interface BreakParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  life: number;
}

const particleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);

export function spawnBreakParticles(
  bx: number, by: number, bz: number, block: BlockId,
  scene: THREE.Scene, particles: BreakParticle[], playerPos: THREE.Vector3
) {
  const colors = BLOCK_COLORS[block] || [0x808080];
  const center = new THREE.Vector3(bx + 0.5, by + 0.5, bz + 0.5);
  const count = 12;
  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length];
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.position.set(
      center.x + (Math.random() - 0.5) * 0.6,
      center.y + (Math.random() - 0.5) * 0.6,
      center.z + (Math.random() - 0.5) * 0.6
    );
    scene.add(mesh);

    const outDir = mesh.position.clone().sub(center).normalize();
    particles.push({
      mesh,
      velocity: outDir.multiplyScalar(3 + Math.random() * 2),
      target: playerPos,
      life: 0,
    });
  }
}

export function updateBreakParticles(dt: number, scene: THREE.Scene, particles: BreakParticle[], playerPos: THREE.Vector3) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;

    if (p.life > 1.2) {
      scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      particles.splice(i, 1);
      continue;
    }

    if (p.life > 0.15) {
      const toPlayer = new THREE.Vector3(
        playerPos.x,
        playerPos.y + EYE_HEIGHT * 0.5,
        playerPos.z
      ).sub(p.mesh.position);
      const dist = toPlayer.length();
      if (dist < 0.3) {
        scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        particles.splice(i, 1);
        continue;
      }
      toPlayer.normalize().multiplyScalar(18 * dt);
      p.velocity.add(toPlayer);
      p.velocity.multiplyScalar(0.92);
    }

    p.velocity.y -= 8 * dt;
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.mesh.rotation.x += dt * 5;
    p.mesh.rotation.y += dt * 3;

    const scale = Math.max(0, 1 - p.life / 1.2);
    p.mesh.scale.setScalar(scale);
  }
}

export function updateMining(
  dt: number, state: MiningState, playerDead: boolean,
  hitBlockFn: () => void, setSwingTimeFn: () => void
) {
  if (!state.mouseDown || playerDead) {
    if (state.active) resetMining(state);
    return;
  }
  if (!state.active) return;

  state.timer += dt;
  if (state.timer >= MINE_INTERVAL) {
    state.timer -= MINE_INTERVAL;
    setSwingTimeFn();
    hitBlockFn();
  }
}
