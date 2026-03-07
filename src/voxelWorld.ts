import * as THREE from "three";

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 96;
export const RENDER_DISTANCE = 4;
export const EYE_HEIGHT = 1.62;
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = PLAYER_WIDTH / 2;
export const WATER_LEVEL = 62;
const CHUNK_BUILD_BUDGET = 4;
const CHUNK_FADE_IN_SPEED = 3.5;

let worldSeed = 0;
export function setWorldSeed(seed: number) {
  worldSeed = seed;
}
export function getWorldSeed() {
  return worldSeed;
}

export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Log = 4,
  Leaves = 5,
  Bedrock = 6,
  Sand = 7,
  Water = 8,
  Snow = 9,
  Cactus = 10,
  IronOre = 11,
  Torch = 12,
}

export enum Biome {
  Plains = 0,
  Desert = 1,
  Snow = 2,
  Jungle = 3,
  Swamp = 4,
}

interface ChunkEntry {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null;
  waterMesh: THREE.Mesh | null;
  dirty: boolean;
  fade: number;
}

interface MeshBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

export interface RaycastHit {
  block: THREE.Vector3;
  place: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

const ATLAS_TILE = 16;
const ATLAS_COLS = 18;
const ATLAS_ROWS = 1;
const TEXTURE_INDEX = {
  grassTop: 0,
  grassSide: 1,
  dirt: 2,
  stone: 3,
  logSide: 4,
  logTop: 5,
  leaves: 6,
  bedrock: 7,
  sand: 8,
  water: 9,
  snowTop: 10,
  snowSide: 11,
  cactusSide: 12,
  cactusTop: 13,
  swampGrassTop: 14,
  swampGrassSide: 15,
  ironOre: 16,
  torch: 17,
};

const FACE_DEFS = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as const;

export class VoxelWorld {
  readonly scene = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly waterMaterial: THREE.MeshLambertMaterial;
  readonly atlas: THREE.CanvasTexture;

  private chunks = new Map<string, ChunkEntry>();
  private edits = new Map<string, BlockId>();
  private editMaxY = new Map<string, number>();
  private buildQueue: string[] = [];
  private buildQueueHead = 0;
  private queued = new Set<string>();
  private targetChunkX = Number.NaN;
  private targetChunkZ = Number.NaN;
  private surfaceCache = new Map<string, number>();
  private biomeCache = new Map<string, Biome>();

  constructor() {
    this.atlas = createAtlasTexture();
    this.material = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true });
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: this.atlas,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      vertexColors: true,
    });
    this.scene.add(new THREE.AmbientLight(0xffffff, 0));
  }

  update(playerX: number, playerZ: number, dt = 1 / 60) {
    const chunkX = Math.floor(playerX / CHUNK_SIZE);
    const chunkZ = Math.floor(playerZ / CHUNK_SIZE);
    if (chunkX !== this.targetChunkX || chunkZ !== this.targetChunkZ) {
      this.targetChunkX = chunkX;
      this.targetChunkZ = chunkZ;
      this.syncChunks(chunkX, chunkZ);
    }

    let budget = CHUNK_BUILD_BUDGET;
    while (budget > 0 && this.buildQueueHead < this.buildQueue.length) {
      const key = this.buildQueue[this.buildQueueHead++];
      this.queued.delete(key);
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      this.rebuildChunk(chunk);
      budget--;
    }
    if (this.buildQueueHead > 0 && this.buildQueueHead >= this.buildQueue.length) {
      this.buildQueue.length = 0;
      this.buildQueueHead = 0;
    }

    for (const chunk of this.chunks.values()) {
      if (chunk.fade >= 1) continue;
      chunk.fade = Math.min(1, chunk.fade + dt * CHUNK_FADE_IN_SPEED);
      if (chunk.mesh) {
        const material = chunk.mesh.material as THREE.MeshLambertMaterial;
        material.opacity = chunk.fade;
        if (chunk.fade >= 1) material.transparent = false;
      }
      if (chunk.waterMesh) {
        const wm = chunk.waterMesh.material as THREE.MeshLambertMaterial;
        wm.opacity = 0.65 * chunk.fade;
      }
    }
  }

  getSpawnPosition() {
    for (let radius = 0; radius < 20; radius++) {
      for (let z = -radius; z <= radius; z++) {
        for (let x = -radius; x <= radius; x++) {
          const candidate = new THREE.Vector3(x + 0.5, this.surfaceHeight(x, z) + 1, z + 0.5);
          if (candidate.y <= WATER_LEVEL) continue;
          if (this.canSpawnAt(candidate)) return candidate;
        }
      }
    }
    return new THREE.Vector3(0.5, this.surfaceHeight(0, 0) + 1, 0.5);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    if (y >= WORLD_HEIGHT) return BlockId.Air;

    const editKey = blockKey(x, y, z);
    const edited = this.edits.get(editKey);
    if (edited !== undefined) return edited;

    return this.sampleGeneratedBlock(x, y, z);
  }

  setBlock(x: number, y: number, z: number, block: BlockId) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.edits.set(blockKey(x, y, z), block);
    if (block !== BlockId.Air) {
      const ck = chunkKey(worldToChunk(x), worldToChunk(z));
      const prev = this.editMaxY.get(ck) ?? 0;
      if (y > prev) this.editMaxY.set(ck, y);
    }
    this.markChunkDirty(worldToChunk(x), worldToChunk(z));
    if (mod(x, CHUNK_SIZE) === 0) this.markChunkDirty(worldToChunk(x - 1), worldToChunk(z));
    if (mod(x, CHUNK_SIZE) === CHUNK_SIZE - 1) this.markChunkDirty(worldToChunk(x + 1), worldToChunk(z));
    if (mod(z, CHUNK_SIZE) === 0) this.markChunkDirty(worldToChunk(x), worldToChunk(z - 1));
    if (mod(z, CHUNK_SIZE) === CHUNK_SIZE - 1) this.markChunkDirty(worldToChunk(x), worldToChunk(z + 1));
  }

  resetAllEdits() {
    this.edits.clear();
    this.editMaxY.clear();
    this.surfaceCache.clear();
    this.biomeCache.clear();
    // Mark all loaded chunks dirty so they rebuild from procedural generation
    for (const chunk of this.chunks.values()) {
      chunk.dirty = true;
      if (!this.queued.has(chunkKey(chunk.cx, chunk.cz))) {
        this.buildQueue.push(chunkKey(chunk.cx, chunk.cz));
        this.queued.add(chunkKey(chunk.cx, chunk.cz));
      }
    }
  }

  isSolid(block: BlockId) {
    return block !== BlockId.Air && block !== BlockId.Water && block !== BlockId.Torch;
  }

  isCollidable(block: BlockId) {
    return block !== BlockId.Air && block !== BlockId.Water && block !== BlockId.Torch;
  }

  isWater(block: BlockId) {
    return block === BlockId.Water;
  }

  isBlockInWater(x: number, y: number, z: number) {
    return this.getBlock(x, y, z) === BlockId.Water;
  }

  collides(min: THREE.Vector3, max: THREE.Vector3) {
    const startX = Math.floor(min.x);
    const endX = Math.floor(max.x - 0.0001);
    const startY = Math.floor(min.y);
    const endY = Math.floor(max.y - 0.0001);
    const startZ = Math.floor(min.z);
    const endZ = Math.floor(max.z - 0.0001);

    for (let y = startY; y <= endY; y++) {
      for (let z = startZ; z <= endZ; z++) {
        for (let x = startX; x <= endX; x++) {
          if (this.isCollidable(this.getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): RaycastHit | null {
    const dir = direction.clone().normalize();
    const current = new THREE.Vector3(Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z));
    const step = new THREE.Vector3(Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z));
    const tDelta = new THREE.Vector3(
      dir.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.x),
      dir.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.y),
      dir.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.z)
    );
    const tMax = new THREE.Vector3(
      intBound(origin.x, dir.x),
      intBound(origin.y, dir.y),
      intBound(origin.z, dir.z)
    );

    const previous = current.clone();
    let normal = new THREE.Vector3();
    let distance = 0;

    for (let i = 0; i < 256 && distance <= maxDistance; i++) {
      const block = this.getBlock(current.x, current.y, current.z);
      if (this.isSolid(block) || block === BlockId.Torch) {
        return { block: current.clone(), place: previous.clone(), normal: normal.clone(), distance };
      }

      previous.copy(current);
      if (tMax.x < tMax.y && tMax.x < tMax.z) {
        current.x += step.x; distance = tMax.x; tMax.x += tDelta.x; normal.set(-step.x, 0, 0);
      } else if (tMax.y < tMax.z) {
        current.y += step.y; distance = tMax.y; tMax.y += tDelta.y; normal.set(0, -step.y, 0);
      } else {
        current.z += step.z; distance = tMax.z; tMax.z += tDelta.z; normal.set(0, 0, -step.z);
      }
    }
    return null;
  }

  createBlockPreview(block: BlockId) {
    const geometry = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    applyBlockUv(geometry, block);
    const posCount = geometry.getAttribute("position").count;
    const colors = new Float32Array(posCount * 3);
    colors.fill(1.0);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = block === BlockId.Water ? this.waterMaterial : this.material;
    return new THREE.Mesh(geometry, mat);
  }

  getBiome(x: number, z: number): Biome {
    const key = `${x},${z}`;
    const cached = this.biomeCache.get(key);
    if (cached !== undefined) return cached;
    const biome = sampleBiome(x, z);
    this.biomeCache.set(key, biome);
    return biome;
  }

  dispose() {
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }
      if (chunk.waterMesh) { this.scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); }
    }
  }

  private syncChunks(centerX: number, centerZ: number) {
    const wanted = new Set<string>();
    const candidates: Array<{ cx: number; cz: number; distanceSq: number }> = [];
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        candidates.push({ cx: centerX + dx, cz: centerZ + dz, distanceSq: dx * dx + dz * dz });
      }
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq);

    for (const candidate of candidates) {
      const { cx, cz } = candidate;
      const key = chunkKey(cx, cz);
      wanted.add(key);
      if (!this.chunks.has(key)) {
        const chunk: ChunkEntry = { cx, cz, mesh: null, waterMesh: null, dirty: true, fade: 0 };
        this.chunks.set(key, chunk);
        this.enqueueBuild(key);
      }
    }

    for (const [key, chunk] of this.chunks) {
      if (wanted.has(key)) continue;
      if (chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); (chunk.mesh.material as THREE.Material).dispose(); }
      if (chunk.waterMesh) { this.scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); (chunk.waterMesh.material as THREE.Material).dispose(); }
      this.chunks.delete(key);
      this.queued.delete(key);
    }
  }

  private markChunkDirty(cx: number, cz: number) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = { cx, cz, mesh: null, waterMesh: null, dirty: true, fade: 0 };
      this.chunks.set(key, chunk);
    }
    chunk.dirty = true;
    this.enqueueBuild(key);
  }

  private enqueueBuild(key: string) {
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.buildQueue.push(key);
  }

  private rebuildChunk(chunk: ChunkEntry) {
    if (!chunk.dirty && chunk.mesh) return;

    const result = this.buildChunkGeometry(chunk.cx, chunk.cz);

    // Solid mesh
    if (!result.solid) {
      if (chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); (chunk.mesh.material as THREE.Material).dispose(); chunk.mesh = null; }
    } else if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      chunk.mesh.geometry = result.solid;
    } else {
      const material = this.material.clone();
      material.map = this.atlas;
      material.transparent = true;
      material.opacity = chunk.fade;
      const mesh = new THREE.Mesh(result.solid, material);
      mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      chunk.mesh = mesh;
      this.scene.add(mesh);
    }

    // Water mesh
    if (!result.water) {
      if (chunk.waterMesh) { this.scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); (chunk.waterMesh.material as THREE.Material).dispose(); chunk.waterMesh = null; }
    } else if (chunk.waterMesh) {
      chunk.waterMesh.geometry.dispose();
      chunk.waterMesh.geometry = result.water;
    } else {
      const wm = this.waterMaterial.clone();
      wm.map = this.atlas;
      wm.opacity = 0.65 * chunk.fade;
      const waterMesh = new THREE.Mesh(result.water, wm);
      waterMesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      waterMesh.renderOrder = 1;
      chunk.waterMesh = waterMesh;
      this.scene.add(waterMesh);
    }

    chunk.dirty = false;
  }

  private buildChunkGeometry(cx: number, cz: number) {
    const solidBuf: MeshBuffers = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    const waterBuf: MeshBuffers = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    let solidFaces = 0;
    let waterFaces = 0;
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    // Precompute surface heights for chunk + 1-block border (cached, fast on revisit)
    let maxY = WATER_LEVEL + 1;
    for (let z = -1; z <= CHUNK_SIZE; z++) {
      for (let x = -1; x <= CHUNK_SIZE; x++) {
        const s = this.surfaceHeight(startX + x, startZ + z) + 8;
        if (s > maxY) maxY = s;
      }
    }
    for (let dcz = -1; dcz <= 1; dcz++) {
      for (let dcx = -1; dcx <= 1; dcx++) {
        const editY = this.editMaxY.get(chunkKey(cx + dcx, cz + dcz)) ?? 0;
        if (editY > maxY) maxY = editY;
      }
    }
    maxY = Math.min(maxY + 1, WORLD_HEIGHT);

    const sampleSize = CHUNK_SIZE + 2;
    const totalBlocks = sampleSize * sampleSize * maxY;
    const blocks = new Uint8Array(totalBlocks);
    const sampleIndex = (x: number, y: number, z: number) =>
      y * sampleSize * sampleSize + (z + 1) * sampleSize + (x + 1);

    for (let y = 0; y < maxY; y++) {
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        for (let x = -1; x <= CHUNK_SIZE; x++) {
          blocks[sampleIndex(x, y, z)] = this.getBlock(startX + x, y, startZ + z);
        }
      }
    }

    // --- Lighting calculation ---
    const skyLight = new Uint8Array(totalBlocks);
    const blkLight = new Uint8Array(totalBlocks);

    // Sky light: trace down each column, flood fill
    const skyQ: number[] = [];
    for (let z = -1; z <= CHUNK_SIZE; z++) {
      for (let x = -1; x <= CHUNK_SIZE; x++) {
        for (let y = maxY - 1; y >= 0; y--) {
          const i = sampleIndex(x, y, z);
          if (isOpaqueBlock(blocks[i])) break;
          skyLight[i] = 15;
          skyQ.push(x, y, z);
        }
      }
    }
    floodLight(skyLight, skyQ, blocks, sampleSize, maxY, sampleIndex);

    // Block light: torches emit 14
    const blkQ: number[] = [];
    for (let y = 0; y < maxY; y++) {
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        for (let x = -1; x <= CHUNK_SIZE; x++) {
          const i = sampleIndex(x, y, z);
          if (blocks[i] === BlockId.Torch) {
            blkLight[i] = 14;
            blkQ.push(x, y, z);
          }
        }
      }
    }
    floodLight(blkLight, blkQ, blocks, sampleSize, maxY, sampleIndex);

    // --- Build faces ---
    for (let y = 0; y < maxY; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const block = blocks[sampleIndex(x, y, z)];
          if (block === BlockId.Air) continue;

          const isWaterBlock = block === BlockId.Water;
          const isTorchBlock = block === BlockId.Torch;

          for (let face = 0; face < FACE_DEFS.length; face++) {
            const def = FACE_DEFS[face];
            const neighborY = y + def.dir[1];
            const neighbor = neighborY < 0 || neighborY >= WORLD_HEIGHT
              ? BlockId.Air
              : neighborY >= maxY
                ? BlockId.Air
                : blocks[sampleIndex(x + def.dir[0], neighborY, z + def.dir[2])];

            // Get light from the neighbor block (the space this face looks into)
            let sl = 15, bl = 0;
            if (neighborY >= 0 && neighborY < maxY) {
              const ni = sampleIndex(x + def.dir[0], neighborY, z + def.dir[2]);
              sl = skyLight[ni];
              bl = blkLight[ni];
            } else if (neighborY < 0) {
              sl = 0; bl = 0;
            }

            // Calculate vertex color from light
            const MIN_LIGHT = 0.04;
            let r: number, g: number, b: number;
            if (bl > sl) {
              const t = MIN_LIGHT + (bl / 15) * (1 - MIN_LIGHT);
              r = t; g = t * 0.82; b = t * 0.55;
            } else {
              const t = MIN_LIGHT + (sl / 15) * (1 - MIN_LIGHT);
              r = t; g = t; b = t;
            }

            if (isWaterBlock) {
              if (neighbor !== BlockId.Air && neighbor !== BlockId.Torch) continue;
              pushFace(waterBuf, x, y, z, block, face, waterFaces, r, g, b);
              waterFaces++;
            } else if (isTorchBlock) {
              // Torch: show faces against air/water only, always bright
              if (neighbor !== BlockId.Air && neighbor !== BlockId.Water) continue;
              pushFace(solidBuf, x, y, z, block, face, solidFaces, 1.0, 0.9, 0.6);
              solidFaces++;
            } else {
              // Solid face against Air, Water, or Torch
              if (neighbor !== BlockId.Air && neighbor !== BlockId.Water && neighbor !== BlockId.Torch) continue;
              pushFace(solidBuf, x, y, z, block, face, solidFaces, r, g, b);
              solidFaces++;
            }
          }
        }
      }
    }

    return {
      solid: solidFaces > 0 ? buildGeometry(solidBuf) : null,
      water: waterFaces > 0 ? buildGeometry(waterBuf) : null,
    };
  }

  private sampleGeneratedBlock(x: number, y: number, z: number): BlockId {
    const bedrockHeight = 1 + Math.floor(value2D(x * 0.15, z * 0.15, 999 + worldSeed) * 4);
    if (y < bedrockHeight) return BlockId.Bedrock;

    const surface = this.surfaceHeight(x, z);
    const biome = this.getBiome(x, z);

    // Above surface: trees/cacti/water fill
    if (y > surface) {
      // Water fill below water level
      if (y <= WATER_LEVEL) return BlockId.Water;
      return sampleVegetation(x, y, z, biome, this.surfaceHeight.bind(this), this.getBiome.bind(this));
    }

    // Surface and below
    return sampleTerrain(x, y, z, surface, biome);
  }

  surfaceHeight(x: number, z: number) {
    const key = `${x},${z}`;
    const cached = this.surfaceCache.get(key);
    if (cached !== undefined) return cached;

    const biome = this.getBiome(x, z);
    const continental = fbm2D(x * 0.003, z * 0.003, 4, 2 + worldSeed) * 18;
    const hills = fbm2D(x * 0.012, z * 0.012, 3, 11 + worldSeed) * 7;
    const detail = fbm2D(x * 0.04, z * 0.04, 2, 37 + worldSeed) * 2;

    let baseHeight = 64;
    let heightScale = 1.0;

    if (biome === Biome.Desert) {
      baseHeight = 63;
      heightScale = 0.6;
    } else if (biome === Biome.Swamp) {
      baseHeight = 61;
      heightScale = 0.3;
    } else if (biome === Biome.Jungle) {
      baseHeight = 65;
      heightScale = 0.8;
    } else if (biome === Biome.Snow) {
      baseHeight = 66;
      heightScale = 1.1;
    }

    const raw = baseHeight + (continental + hills + detail) * heightScale;
    const dist = Math.sqrt(x * x + z * z);
    const spawnBlend = Math.max(0, 1 - dist / 18);
    const flattened = lerp(raw, 64, spawnBlend);
    const result = Math.max(6, Math.min(WORLD_HEIGHT - 8, Math.floor(flattened)));
    this.surfaceCache.set(key, result);
    return result;
  }

  private canSpawnAt(position: THREE.Vector3) {
    const min = new THREE.Vector3(position.x - PLAYER_RADIUS, position.y, position.z - PLAYER_RADIUS);
    const max = new THREE.Vector3(position.x + PLAYER_RADIUS, position.y + PLAYER_HEIGHT, position.z + PLAYER_RADIUS);
    if (this.collides(min, max)) return false;

    const belowY = Math.floor(position.y - 0.05);
    for (let z = Math.floor(min.z); z <= Math.floor(max.z - 0.001); z++) {
      for (let x = Math.floor(min.x); x <= Math.floor(max.x - 0.001); x++) {
        if (!this.isCollidable(this.getBlock(x, belowY, z))) return false;
      }
    }
    return true;
  }
}

// --- Biome selection ---
function sampleBiome(x: number, z: number): Biome {
  const temperature = fbm2D(x * 0.008, z * 0.008, 3, 200 + worldSeed);
  const moisture = fbm2D(x * 0.01, z * 0.01, 3, 500 + worldSeed);

  if (temperature < 0.32) return Biome.Snow;
  if (temperature > 0.68 && moisture < 0.38) return Biome.Desert;
  if (moisture > 0.62 && temperature > 0.45) return Biome.Jungle;
  if (moisture > 0.55 && temperature >= 0.32 && temperature <= 0.55) return Biome.Swamp;
  return Biome.Plains;
}

// --- Terrain blocks ---
function stoneOrOre(x: number, y: number, z: number): BlockId {
  // Combine multiple noise octaves at different scales for irregular blob-shaped clusters
  const n1 = value3D(x * 0.08, y * 0.11, z * 0.08, 7777 + worldSeed);
  const n2 = value3D(x * 0.22 + 50, y * 0.18 - 30, z * 0.22 + 70, 8888 + worldSeed) * 0.4;
  const n3 = value3D(x * 0.45 - 20, y * 0.35 + 40, z * 0.45 + 10, 9999 + worldSeed) * 0.15;
  const oreNoise = n1 + n2 + n3;
  return oreNoise > 0.92 ? BlockId.IronOre : BlockId.Stone;
}

function sampleTerrain(x: number, y: number, z: number, surface: number, biome: Biome): BlockId {
  if (biome === Biome.Desert) {
    if (y === surface) return BlockId.Sand;
    if (y >= surface - 5) return BlockId.Sand;
    return stoneOrOre(x, y, z);
  }
  if (biome === Biome.Snow) {
    if (y === surface) return BlockId.Snow;
    if (y >= surface - 3) return BlockId.Dirt;
    return stoneOrOre(x, y, z);
  }
  if (biome === Biome.Swamp) {
    if (y === surface) return BlockId.Grass;
    if (y >= surface - 3) return BlockId.Dirt;
    return stoneOrOre(x, y, z);
  }
  // Plains & Jungle
  // Beach: near water level, use sand
  if (y === surface && surface <= WATER_LEVEL + 2) return BlockId.Sand;
  if (y === surface) return BlockId.Grass;
  if (y >= surface - 3) {
    if (surface <= WATER_LEVEL + 2) return BlockId.Sand;
    return BlockId.Dirt;
  }
  return stoneOrOre(x, y, z);
}

// --- Vegetation (trees, cacti) above surface ---
function sampleVegetation(
  x: number, y: number, z: number, biome: Biome,
  getSurface: (x: number, z: number) => number,
  getBiome: (x: number, z: number) => Biome
): BlockId {
  if (biome === Biome.Desert) {
    return sampleCactus(x, y, z, getSurface, getBiome);
  }
  return sampleTreeBlock(x, y, z, biome, getSurface, getBiome);
}

function sampleCactus(
  x: number, y: number, z: number,
  getSurface: (x: number, z: number) => number,
  getBiome: (x: number, z: number) => Biome
): BlockId {
  if (!hasCactus(x, z)) return BlockId.Air;
  if (getBiome(x, z) !== Biome.Desert) return BlockId.Air;
  const surface = getSurface(x, z);
  if (surface <= WATER_LEVEL) return BlockId.Air;
  if (y > surface && y <= surface + 3) return BlockId.Cactus;
  return BlockId.Air;
}

function hasCactus(x: number, z: number) {
  if (x >= -8 && x <= 8 && z >= -8 && z <= 8) return false;
  const r = value2D(x * 0.18 + 50, z * 0.18 - 30, 177 + worldSeed);
  return r > 0.82;
}

function sampleTreeBlock(
  x: number, y: number, z: number, biome: Biome,
  getSurface: (x: number, z: number) => number,
  getBiome: (x: number, z: number) => Biome
): BlockId {
  const searchRadius = biome === Biome.Jungle ? 3 : 2;
  for (let tz = z - searchRadius; tz <= z + searchRadius; tz++) {
    for (let tx = x - searchRadius; tx <= x + searchRadius; tx++) {
      const treeBiome = getBiome(tx, tz);
      if (treeBiome === Biome.Desert) continue;
      if (!hasTreeForBiome(tx, tz, treeBiome)) continue;
      const surface = getSurface(tx, tz);
      if (surface <= WATER_LEVEL) continue;

      const trunkHeight = treeBiome === Biome.Jungle ? 6 : treeBiome === Biome.Swamp ? 3 : 4;
      const trunkTop = surface + trunkHeight;
      const canopyRadius = treeBiome === Biome.Jungle ? 3 : 2;

      if (x === tx && z === tz && y > surface && y <= trunkTop) {
        return BlockId.Log;
      }
      const canopyBase = trunkTop - 1;
      const canopyTop = trunkTop + (treeBiome === Biome.Jungle ? 2 : 1);
      if (y >= canopyBase && y <= canopyTop) {
        const dx = Math.abs(x - tx);
        const dz = Math.abs(z - tz);
        if (dx + dz <= canopyRadius) return BlockId.Leaves;
        if (dx <= canopyRadius - 1 && dz <= canopyRadius - 1) return BlockId.Leaves;
      }
    }
  }
  return BlockId.Air;
}

function hasTreeForBiome(x: number, z: number, biome: Biome) {
  if (x >= -8 && x <= 8 && z >= -8 && z <= 8) return false;
  const density = value2D(x * 0.08, z * 0.08, 71 + worldSeed);
  const randomness = value2D(x * 0.21 + 100, z * 0.21 - 80, 113 + worldSeed);

  if (biome === Biome.Jungle) return density > 0.38 && randomness > 0.45;
  if (biome === Biome.Swamp) return density > 0.65 && randomness > 0.8;
  if (biome === Biome.Snow) return density > 0.6 && randomness > 0.78;
  return density > 0.58 && randomness > 0.73; // Plains
}

// --- Lighting helpers ---
function isOpaqueBlock(block: number): boolean {
  return block !== BlockId.Air && block !== BlockId.Water && block !== BlockId.Leaves && block !== BlockId.Torch;
}

const FLOOD_DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

function floodLight(
  light: Uint8Array, queue: number[], blocks: Uint8Array,
  sampleSize: number, maxY: number,
  sampleIndex: (x: number, y: number, z: number) => number
) {
  let head = 0;
  const maxCoord = sampleSize - 2; // = CHUNK_SIZE
  while (head < queue.length) {
    const sx = queue[head++], sy = queue[head++], sz = queue[head++];
    const currentLight = light[sampleIndex(sx, sy, sz)];
    if (currentLight <= 1) continue;
    for (const dir of FLOOD_DIRS) {
      const nx = sx + dir[0], ny = sy + dir[1], nz = sz + dir[2];
      if (nx < -1 || nx > maxCoord || nz < -1 || nz > maxCoord || ny < 0 || ny >= maxY) continue;
      const ni = sampleIndex(nx, ny, nz);
      if (isOpaqueBlock(blocks[ni])) continue;
      const newLight = currentLight - 1;
      if (newLight > light[ni]) {
        light[ni] = newLight;
        queue.push(nx, ny, nz);
      }
    }
  }
}

// --- Geometry helpers ---
function buildGeometry(buffers: MeshBuffers) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// Pre-cache UV tiles
const uvCache: { u0: number; v0: number; u1: number; v1: number }[] = [];
for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i++) uvCache.push(uvForTile(i));

function pushFace(buffers: MeshBuffers, x: number, y: number, z: number, block: BlockId, faceIndex: number, faceCount: number, r: number, g: number, b: number) {
  const def = FACE_DEFS[faceIndex];
  const uv = uvCache[blockFaceTile(block, faceIndex)];
  const c = def.corners;
  const dx = def.dir[0], dy = def.dir[1], dz = def.dir[2];
  buffers.positions.push(
    x + c[0][0], y + c[0][1], z + c[0][2],
    x + c[1][0], y + c[1][1], z + c[1][2],
    x + c[2][0], y + c[2][1], z + c[2][2],
    x + c[3][0], y + c[3][1], z + c[3][2]
  );
  buffers.normals.push(dx, dy, dz, dx, dy, dz, dx, dy, dz, dx, dy, dz);
  buffers.uvs.push(uv.u0, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1);
  buffers.colors.push(r, g, b, r, g, b, r, g, b, r, g, b);
  const base = faceCount * 4;
  buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function blockFaceTile(block: BlockId, faceIndex: number) {
  if (block === BlockId.Grass) {
    if (faceIndex === 2) return TEXTURE_INDEX.grassTop;
    if (faceIndex === 3) return TEXTURE_INDEX.dirt;
    return TEXTURE_INDEX.grassSide;
  }
  if (block === BlockId.Dirt) return TEXTURE_INDEX.dirt;
  if (block === BlockId.Stone) return TEXTURE_INDEX.stone;
  if (block === BlockId.Log) return faceIndex === 2 || faceIndex === 3 ? TEXTURE_INDEX.logTop : TEXTURE_INDEX.logSide;
  if (block === BlockId.Leaves) return TEXTURE_INDEX.leaves;
  if (block === BlockId.Bedrock) return TEXTURE_INDEX.bedrock;
  if (block === BlockId.Sand) return TEXTURE_INDEX.sand;
  if (block === BlockId.Water) return TEXTURE_INDEX.water;
  if (block === BlockId.Snow) {
    if (faceIndex === 2) return TEXTURE_INDEX.snowTop;
    if (faceIndex === 3) return TEXTURE_INDEX.dirt;
    return TEXTURE_INDEX.snowSide;
  }
  if (block === BlockId.Cactus) return faceIndex === 2 || faceIndex === 3 ? TEXTURE_INDEX.cactusTop : TEXTURE_INDEX.cactusSide;
  if (block === BlockId.IronOre) return TEXTURE_INDEX.ironOre;
  if (block === BlockId.Torch) return TEXTURE_INDEX.torch;
  return TEXTURE_INDEX.stone;
}

function applyBlockUv(geometry: THREE.BoxGeometry, block: BlockId) {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const faceOrder = [0, 1, 2, 3, 4, 5];
  for (let face = 0; face < faceOrder.length; face++) {
    const tile = uvForTile(blockFaceTile(block, face));
    const offset = face * 8;
    uv.array[offset + 0] = tile.u1; uv.array[offset + 1] = tile.v1;
    uv.array[offset + 2] = tile.u0; uv.array[offset + 3] = tile.v1;
    uv.array[offset + 4] = tile.u1; uv.array[offset + 5] = tile.v0;
    uv.array[offset + 6] = tile.u0; uv.array[offset + 7] = tile.v0;
  }
  uv.needsUpdate = true;
}

// --- Noise functions ---
function fbm2D(x: number, z: number, octaves: number, seed: number) {
  let amplitude = 1, frequency = 1, sum = 0, max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += value2D(x * frequency, z * frequency, seed + i * 101) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / max;
}

function value3D(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = smooth(fx), uy = smooth(fy), uz = smooth(fz);
  const a = hash3(ix, iy, iz, seed), b = hash3(ix + 1, iy, iz, seed);
  const c = hash3(ix, iy + 1, iz, seed), d = hash3(ix + 1, iy + 1, iz, seed);
  const e = hash3(ix, iy, iz + 1, seed), f = hash3(ix + 1, iy, iz + 1, seed);
  const g = hash3(ix, iy + 1, iz + 1, seed), h = hash3(ix + 1, iy + 1, iz + 1, seed);
  const ab = lerp(a, b, ux), cd = lerp(c, d, ux);
  const ef = lerp(e, f, ux), gh = lerp(g, h, ux);
  const abcd = lerp(ab, cd, uy), efgh = lerp(ef, gh, uy);
  return lerp(abcd, efgh, uz);
}

function hash3(x: number, y: number, z: number, seed: number) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177 + seed * 69069;
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}

export function value2D(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const ux = smooth(fx), uz = smooth(fz);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function hash2(x: number, z: number, seed: number) {
  let h = x * 374761393 + z * 668265263 + seed * 69069;
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}

function smooth(t: number) { return t * t * (3 - 2 * t); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function chunkKey(cx: number, cz: number) { return `${cx},${cz}`; }
function blockKey(x: number, y: number, z: number) { return `${x},${y},${z}`; }
function worldToChunk(value: number) { return Math.floor(value / CHUNK_SIZE); }
function mod(value: number, divisor: number) { return ((value % divisor) + divisor) % divisor; }

function intBound(s: number, ds: number) {
  if (ds === 0) return Number.POSITIVE_INFINITY;
  const offset = ds > 0 ? Math.ceil(s) - s : s - Math.floor(s);
  return offset === 0 ? 0 : offset / Math.abs(ds);
}

function uvForTile(index: number) {
  const padX = 0.35 / (ATLAS_TILE * ATLAS_COLS);
  const padY = 0.35 / (ATLAS_TILE * ATLAS_ROWS);
  const u0 = (index % ATLAS_COLS) / ATLAS_COLS + padX;
  const v0 = Math.floor(index / ATLAS_COLS) / ATLAS_ROWS + padY;
  const u1 = (index % ATLAS_COLS + 1) / ATLAS_COLS - padX;
  const v1 = (Math.floor(index / ATLAS_COLS) + 1) / ATLAS_ROWS - padY;
  return { u0, v0, u1, v1 };
}

// --- Texture atlas ---
function createAtlasTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_TILE * ATLAS_COLS;
  canvas.height = ATLAS_TILE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  drawGrassTop(ctx, 0);
  drawGrassSide(ctx, 1);
  drawDirt(ctx, 2);
  drawStone(ctx, 3);
  drawLogSide(ctx, 4);
  drawLogTop(ctx, 5);
  drawLeaves(ctx, 6);
  drawBedrock(ctx, 7);
  drawSand(ctx, 8);
  drawWater(ctx, 9);
  drawSnowTop(ctx, 10);
  drawSnowSide(ctx, 11);
  drawCactusSide(ctx, 12);
  drawCactusTop(ctx, 13);
  drawSwampGrassTop(ctx, 14);
  drawSwampGrassSide(ctx, 15);
  drawIronOre(ctx, 16);
  drawTorch(ctx, 17);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawGrassTop(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#6fe35d");
  checker(ctx, tile, "#63d652", "#57bf4d");
  sprinkle(ctx, tile, "#b8ff8d", 42, 0.14);
  sprinkle(ctx, tile, "#2e8e38", 37, 0.18);
  addTileRim(ctx, tile, "#cfff9e", "#2d7d34");
}

function drawGrassSide(ctx: CanvasRenderingContext2D, tile: number) {
  fillTile(ctx, tile, "#ab6325");
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      ctx.fillStyle = y < 3 ? "#63ef62" : "#49c34d";
      ctx.fillRect(tile * ATLAS_TILE + x, y, 1, 1);
    }
  }
  sprinkle(ctx, tile, "#6b3210", 52, 0.21, 5);
  sprinkle(ctx, tile, "#d9883e", 29, 0.14, 5);
  addTileRim(ctx, tile, "#f7c06b", "#5a2a0f");
}

function drawDirt(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#a35f22");
  checker(ctx, tile, "#b46a2a", "#94541d");
  sprinkle(ctx, tile, "#6a3511", 51, 0.2);
  sprinkle(ctx, tile, "#db8d43", 47, 0.12);
  addTileRim(ctx, tile, "#e2a254", "#5a2c0d");
}

function drawStone(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#8f9fb0");
  checker(ctx, tile, "#9baaBA", "#7a8695");
  sprinkle(ctx, tile, "#53606d", 59, 0.22);
  sprinkle(ctx, tile, "#dbe4ee", 21, 0.1);
  addTileRim(ctx, tile, "#f0f6fb", "#49525d");
}

function drawLogSide(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#9a5a1c");
  for (let x = 0; x < ATLAS_TILE; x += 3) {
    ctx.fillStyle = x % 6 === 0 ? "#5b3210" : "#c6772c";
    ctx.fillRect(tile * ATLAS_TILE + x, 0, 1, ATLAS_TILE);
  }
  addTileRim(ctx, tile, "#e7a04a", "#4f280b");
}

function drawLogTop(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#ac6a26");
  ctx.strokeStyle = "#60350f";
  ctx.lineWidth = 2;
  ctx.strokeRect(tile * ATLAS_TILE + 2, 2, ATLAS_TILE - 4, ATLAS_TILE - 4);
  ctx.strokeStyle = "#de8e37";
  ctx.strokeRect(tile * ATLAS_TILE + 5, 5, ATLAS_TILE - 10, ATLAS_TILE - 10);
  addTileRim(ctx, tile, "#e9a653", "#5a2f0c");
}

function drawLeaves(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#30c94f");
  checker(ctx, tile, "#41dd60", "#26a543");
  sprinkle(ctx, tile, "#9bff8d", 43, 0.17);
  sprinkle(ctx, tile, "#0e6f2a", 33, 0.15);
  addTileRim(ctx, tile, "#c6ff9f", "#0d5d22");
}

function drawBedrock(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#1a1a1e");
  checker(ctx, tile, "#222226", "#141418");
  sprinkle(ctx, tile, "#0d0d10", 61, 0.2);
  sprinkle(ctx, tile, "#2a2a30", 77, 0.12);
  sprinkle(ctx, tile, "#3366cc", 83, 0.08);
  sprinkle(ctx, tile, "#5588ee", 91, 0.04);
  sprinkle(ctx, tile, "#88aaff", 97, 0.02);
  addTileRim(ctx, tile, "#2a2a34", "#0a0a0e");
}

function drawSand(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#e8d088");
  checker(ctx, tile, "#dcc47a", "#f0d890");
  sprinkle(ctx, tile, "#c4a858", 61, 0.15);
  sprinkle(ctx, tile, "#f8e8a8", 43, 0.1);
  addTileRim(ctx, tile, "#fff0c0", "#b09848");
}

function drawWater(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#3070c0");
  checker(ctx, tile, "#2868b8", "#3878c8");
  sprinkle(ctx, tile, "#5090e0", 53, 0.12);
  sprinkle(ctx, tile, "#1850a0", 67, 0.08);
  addTileRim(ctx, tile, "#60a0f0", "#184080");
}

function drawSnowTop(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#f0f4f8");
  checker(ctx, tile, "#e8ecf0", "#f4f8fc");
  sprinkle(ctx, tile, "#d0d8e0", 47, 0.08);
  sprinkle(ctx, tile, "#ffffff", 39, 0.12);
  addTileRim(ctx, tile, "#ffffff", "#c8d0d8");
}

function drawSnowSide(ctx: CanvasRenderingContext2D, tile: number) {
  fillTile(ctx, tile, "#ab6325");
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      ctx.fillStyle = y < 3 ? "#f0f4f8" : "#e0e4e8";
      ctx.fillRect(tile * ATLAS_TILE + x, y, 1, 1);
    }
  }
  sprinkle(ctx, tile, "#6b3210", 52, 0.21, 5);
  sprinkle(ctx, tile, "#d9883e", 29, 0.14, 5);
  addTileRim(ctx, tile, "#f7c06b", "#5a2a0f");
}

function drawCactusSide(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#2a8030");
  checker(ctx, tile, "#308838", "#248028");
  sprinkle(ctx, tile, "#186020", 53, 0.12);
  sprinkle(ctx, tile, "#40a048", 67, 0.1);
  // Spines
  for (let y = 2; y < ATLAS_TILE; y += 4) {
    ctx.fillStyle = "#c0d890";
    ctx.fillRect(tile * ATLAS_TILE + 4, y, 1, 1);
    ctx.fillRect(tile * ATLAS_TILE + 11, y + 2, 1, 1);
  }
  addTileRim(ctx, tile, "#48b050", "#185820");
}

function drawCactusTop(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#38a040");
  checker(ctx, tile, "#30983a", "#40a848");
  sprinkle(ctx, tile, "#60c068", 71, 0.1);
  addTileRim(ctx, tile, "#50b858", "#288030");
}

function drawSwampGrassTop(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#4a7838");
  checker(ctx, tile, "#426e32", "#52823e");
  sprinkle(ctx, tile, "#607830", 42, 0.14);
  sprinkle(ctx, tile, "#2a5020", 37, 0.18);
  addTileRim(ctx, tile, "#688840", "#1e4018");
}

function drawSwampGrassSide(ctx: CanvasRenderingContext2D, tile: number) {
  fillTile(ctx, tile, "#8b5520");
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      ctx.fillStyle = y < 3 ? "#4a7838" : "#3a6830";
      ctx.fillRect(tile * ATLAS_TILE + x, y, 1, 1);
    }
  }
  sprinkle(ctx, tile, "#5a2810", 52, 0.21, 5);
  addTileRim(ctx, tile, "#a07030", "#402010");
}

function drawTorch(ctx: CanvasRenderingContext2D, tile: number) {
  paintBase(ctx, tile, "#e8a030");
  checker(ctx, tile, "#e09028", "#f0b038");
  sprinkle(ctx, tile, "#ffe080", 131, 0.2);
  sprinkle(ctx, tile, "#fff8d0", 143, 0.1);
  sprinkle(ctx, tile, "#c07818", 151, 0.12);
  addTileRim(ctx, tile, "#ffe8a0", "#a06010");
}

function drawIronOre(ctx: CanvasRenderingContext2D, tile: number) {
  // Stone base
  paintBase(ctx, tile, "#8f9fb0");
  checker(ctx, tile, "#9baaBA", "#7a8695");
  sprinkle(ctx, tile, "#53606d", 59, 0.22);
  sprinkle(ctx, tile, "#dbe4ee", 21, 0.1);
  // Orange/rusty iron ore specks
  sprinkle(ctx, tile, "#c87830", 133, 0.18);
  sprinkle(ctx, tile, "#e8a050", 149, 0.12);
  sprinkle(ctx, tile, "#a05820", 157, 0.08);
  addTileRim(ctx, tile, "#d0a060", "#49525d");
}

function paintBase(ctx: CanvasRenderingContext2D, tile: number, color: string) { fillTile(ctx, tile, color); }

function fillTile(ctx: CanvasRenderingContext2D, tile: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(tile * ATLAS_TILE, 0, ATLAS_TILE, ATLAS_TILE);
}

function checker(ctx: CanvasRenderingContext2D, tile: number, a: string, b: string) {
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? a : b;
      ctx.fillRect(tile * ATLAS_TILE + x, y, 1, 1);
    }
  }
}

function addTileRim(ctx: CanvasRenderingContext2D, tile: number, light: string, dark: string) {
  const ox = tile * ATLAS_TILE;
  ctx.fillStyle = light;
  ctx.fillRect(ox, 0, ATLAS_TILE, 1);
  ctx.fillRect(ox, 0, 1, ATLAS_TILE);
  ctx.fillStyle = dark;
  ctx.fillRect(ox, ATLAS_TILE - 1, ATLAS_TILE, 1);
  ctx.fillRect(ox + ATLAS_TILE - 1, 0, 1, ATLAS_TILE);
}

function sprinkle(ctx: CanvasRenderingContext2D, tile: number, color: string, seed: number, chance: number, minY = 0) {
  ctx.fillStyle = color;
  for (let y = minY; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const h = hash2(tile * 31 + x, y, seed);
      if (h < chance) ctx.fillRect(tile * ATLAS_TILE + x, y, 1, 1);
    }
  }
}
