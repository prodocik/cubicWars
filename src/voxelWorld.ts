import * as THREE from "three";

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 256;
export const RENDER_DISTANCE = 4;
export const EYE_HEIGHT = 1.62;
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = PLAYER_WIDTH / 2;
const CHUNK_BUILD_BUDGET = 2;
const CHUNK_FADE_IN_SPEED = 3.5;

export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Log = 4,
  Leaves = 5,
  Bedrock = 6,
}

interface ChunkEntry {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null;
  dirty: boolean;
  fade: number;
}

interface MeshBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export interface RaycastHit {
  block: THREE.Vector3;
  place: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

const ATLAS_TILE = 16;
const ATLAS_COLS = 8;
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
};

const FACE_DEFS = [
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1],
    ],
  },
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0],
    ],
  },
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0],
    ],
  },
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
    ],
  },
  {
    dir: [0, 0, 1],
    corners: [
      [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1],
    ],
  },
  {
    dir: [0, 0, -1],
    corners: [
      [0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0],
    ],
  },
] as const;

export class VoxelWorld {
  readonly scene = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly atlas: THREE.CanvasTexture;

  private chunks = new Map<string, ChunkEntry>();
  private edits = new Map<string, BlockId>();
  private buildQueue: string[] = [];
  private queued = new Set<string>();
  private targetChunkX = Number.NaN;
  private targetChunkZ = Number.NaN;

  constructor() {
    this.atlas = createAtlasTexture();
    this.material = new THREE.MeshLambertMaterial({ map: this.atlas });
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
    while (budget > 0 && this.buildQueue.length > 0) {
      const key = this.buildQueue.shift()!;
      this.queued.delete(key);
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      this.rebuildChunk(chunk);
      budget--;
    }

    for (const chunk of this.chunks.values()) {
      if (!chunk.mesh || chunk.fade >= 1) continue;
      chunk.fade = Math.min(1, chunk.fade + dt * CHUNK_FADE_IN_SPEED);
      const material = chunk.mesh.material as THREE.MeshLambertMaterial;
      material.opacity = chunk.fade;
    }
  }

  getSpawnPosition() {
    for (let radius = 0; radius < 20; radius++) {
      for (let z = -radius; z <= radius; z++) {
        for (let x = -radius; x <= radius; x++) {
          const candidate = new THREE.Vector3(x + 0.5, this.surfaceHeight(x, z) + 1, z + 0.5);
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
    this.markChunkDirty(worldToChunk(x), worldToChunk(z));
    if (mod(x, CHUNK_SIZE) === 0) this.markChunkDirty(worldToChunk(x - 1), worldToChunk(z));
    if (mod(x, CHUNK_SIZE) === CHUNK_SIZE - 1) this.markChunkDirty(worldToChunk(x + 1), worldToChunk(z));
    if (mod(z, CHUNK_SIZE) === 0) this.markChunkDirty(worldToChunk(x), worldToChunk(z - 1));
    if (mod(z, CHUNK_SIZE) === CHUNK_SIZE - 1) this.markChunkDirty(worldToChunk(x), worldToChunk(z + 1));
  }

  isSolid(block: BlockId) {
    return block !== BlockId.Air;
  }

  isCollidable(block: BlockId) {
    return block !== BlockId.Air;
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
          if (this.isCollidable(this.getBlock(x, y, z))) {
            return true;
          }
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
      if (this.isSolid(block)) {
        return {
          block: current.clone(),
          place: previous.clone(),
          normal: normal.clone(),
          distance,
        };
      }

      previous.copy(current);

      if (tMax.x < tMax.y && tMax.x < tMax.z) {
        current.x += step.x;
        distance = tMax.x;
        tMax.x += tDelta.x;
        normal.set(-step.x, 0, 0);
      } else if (tMax.y < tMax.z) {
        current.y += step.y;
        distance = tMax.y;
        tMax.y += tDelta.y;
        normal.set(0, -step.y, 0);
      } else {
        current.z += step.z;
        distance = tMax.z;
        tMax.z += tDelta.z;
        normal.set(0, 0, -step.z);
      }
    }

    return null;
  }

  createBlockPreview(block: BlockId) {
    const geometry = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    applyBlockUv(geometry, block);
    return new THREE.Mesh(geometry, this.material);
  }

  dispose() {
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
    }
  }

  private syncChunks(centerX: number, centerZ: number) {
    const wanted = new Set<string>();
    const candidates: Array<{ cx: number; cz: number; distanceSq: number }> = [];
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        candidates.push({
          cx: centerX + dx,
          cz: centerZ + dz,
          distanceSq: dx * dx + dz * dz,
        });
      }
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq);

    for (const candidate of candidates) {
      const { cx, cz } = candidate;
        const key = chunkKey(cx, cz);
        wanted.add(key);
        if (!this.chunks.has(key)) {
          const chunk: ChunkEntry = { cx, cz, mesh: null, dirty: true, fade: 0 };
          this.chunks.set(key, chunk);
          this.enqueueBuild(key);
        }
    }

    for (const [key, chunk] of this.chunks) {
      if (wanted.has(key)) continue;
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        (chunk.mesh.material as THREE.Material).dispose();
      }
      this.chunks.delete(key);
      this.queued.delete(key);
    }
  }

  private markChunkDirty(cx: number, cz: number) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = { cx, cz, mesh: null, dirty: true, fade: 0 };
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

    const geometry = this.buildChunkGeometry(chunk.cx, chunk.cz);
    if (!geometry) {
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        (chunk.mesh.material as THREE.Material).dispose();
        chunk.mesh = null;
      }
      chunk.dirty = false;
      return;
    }

    if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      chunk.mesh.geometry = geometry;
      chunk.dirty = false;
      return;
    }

    const material = this.material.clone();
    material.map = this.atlas;
    material.transparent = true;
    material.opacity = chunk.fade;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    mesh.matrixAutoUpdate = true;
    chunk.mesh = mesh;
    chunk.dirty = false;
    this.scene.add(mesh);
  }

  private buildChunkGeometry(cx: number, cz: number) {
    const buffers: MeshBuffers = { positions: [], normals: [], uvs: [], indices: [] };
    let faceCount = 0;
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    const sampleSize = CHUNK_SIZE + 2;
    const blocks = new Uint8Array(sampleSize * sampleSize * WORLD_HEIGHT);

    const sampleIndex = (x: number, y: number, z: number) =>
      y * sampleSize * sampleSize + (z + 1) * sampleSize + (x + 1);

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        for (let x = -1; x <= CHUNK_SIZE; x++) {
          blocks[sampleIndex(x, y, z)] = this.getBlock(startX + x, y, startZ + z);
        }
      }
    }

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const block = blocks[sampleIndex(x, y, z)];
          if (block === BlockId.Air) continue;

          for (let face = 0; face < FACE_DEFS.length; face++) {
            const def = FACE_DEFS[face];
            const neighborY = y + def.dir[1];
            const neighbor = neighborY < 0 || neighborY >= WORLD_HEIGHT
              ? BlockId.Air
              : blocks[sampleIndex(x + def.dir[0], neighborY, z + def.dir[2])];
            if (neighbor !== BlockId.Air) continue;
            pushFace(buffers, x, y, z, block, face, faceCount);
            faceCount++;
          }
        }
      }
    }

    if (faceCount === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buffers.uvs, 2));
    geometry.setIndex(buffers.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private sampleGeneratedBlock(x: number, y: number, z: number): BlockId {
    // Bedrock floor: 1-4 uneven layers at the bottom
    const bedrockHeight = 1 + Math.floor(value2D(x * 0.15, z * 0.15, 999) * 4);
    if (y < bedrockHeight) return BlockId.Bedrock;

    const surface = this.surfaceHeight(x, z);
    if (y > surface) {
      return sampleTreeBlock(x, y, z, this.surfaceHeight.bind(this));
    }
    if (y === surface) return BlockId.Grass;
    if (y >= surface - 3) return BlockId.Dirt;
    return BlockId.Stone;
  }

  private surfaceHeight(x: number, z: number) {
    const continental = fbm2D(x * 0.003, z * 0.003, 4, 2) * 18;
    const hills = fbm2D(x * 0.012, z * 0.012, 3, 11) * 7;
    const detail = fbm2D(x * 0.04, z * 0.04, 2, 37) * 2;
    const baseHeight = 64;
    const raw = baseHeight + continental + hills + detail;
    const dist = Math.sqrt(x * x + z * z);
    const spawnBlend = Math.max(0, 1 - dist / 18);
    const flattened = lerp(raw, baseHeight, spawnBlend);
    return Math.max(6, Math.min(WORLD_HEIGHT - 8, Math.floor(flattened)));
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

function pushFace(buffers: MeshBuffers, x: number, y: number, z: number, block: BlockId, faceIndex: number, faceCount: number) {
  const def = FACE_DEFS[faceIndex];
  const uvTile = blockFaceTile(block, faceIndex);
  const tileUv = uvForTile(uvTile);
  for (const [vx, vy, vz] of def.corners) {
    buffers.positions.push(x + vx, y + vy, z + vz);
    buffers.normals.push(def.dir[0], def.dir[1], def.dir[2]);
  }

  buffers.uvs.push(
    tileUv.u0, tileUv.v1,
    tileUv.u0, tileUv.v0,
    tileUv.u1, tileUv.v0,
    tileUv.u1, tileUv.v1,
  );

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

function sampleTreeBlock(x: number, y: number, z: number, getSurface: (x: number, z: number) => number): BlockId {
  for (let tz = z - 2; tz <= z + 2; tz++) {
    for (let tx = x - 2; tx <= x + 2; tx++) {
      if (!hasTree(tx, tz)) continue;
      const surface = getSurface(tx, tz);
      const trunkTop = surface + 4;
      if (x === tx && z === tz && y > surface && y <= trunkTop) {
        return BlockId.Log;
      }
      if (y >= trunkTop - 1 && y <= trunkTop + 1) {
        const dx = Math.abs(x - tx);
        const dz = Math.abs(z - tz);
        if (dx + dz <= 2) return BlockId.Leaves;
        if (dx <= 1 && dz <= 1 && y <= trunkTop + 1) return BlockId.Leaves;
      }
    }
  }
  return BlockId.Air;
}

function hasTree(x: number, z: number) {
  if (x >= -8 && x <= 8 && z >= -8 && z <= 8) return false;
  const density = value2D(x * 0.08, z * 0.08, 71);
  const randomness = value2D(x * 0.21 + 100, z * 0.21 - 80, 113);
  return density > 0.58 && randomness > 0.73;
}

function fbm2D(x: number, z: number, octaves: number, seed: number) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += value2D(x * frequency, z * frequency, seed + i * 101) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / max;
}

function value2D(x: number, z: number, seed: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);

  const ux = smooth(fx);
  const uz = smooth(fz);
  const ab = lerp(a, b, ux);
  const cd = lerp(c, d, ux);
  return lerp(ab, cd, uz);
}

function hash2(x: number, z: number, seed: number) {
  let h = x * 374761393 + z * 668265263 + seed * 69069;
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function chunkKey(cx: number, cz: number) {
  return `${cx},${cz}`;
}

function blockKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function worldToChunk(value: number) {
  return Math.floor(value / CHUNK_SIZE);
}

function mod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

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
  // Blue crystal specks
  sprinkle(ctx, tile, "#3366cc", 83, 0.08);
  sprinkle(ctx, tile, "#5588ee", 91, 0.04);
  sprinkle(ctx, tile, "#88aaff", 97, 0.02);
  addTileRim(ctx, tile, "#2a2a34", "#0a0a0e");
}

function paintBase(ctx: CanvasRenderingContext2D, tile: number, color: string) {
  fillTile(ctx, tile, color);
}

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
      if (h < chance) {
        ctx.fillRect(tile * ATLAS_TILE + x, y, 1, 1);
      }
    }
  }
}
