export enum TileType {
  Grass,
  Dirt,
  Water,
  Stone,
}

export const MAP_W = 50;
export const MAP_H = 50;

// Simple value noise for coherent terrain
function makeNoise(seed: number) {
  // Generate a grid of random values
  const SIZE = 256;
  const perm = new Uint8Array(SIZE * 2);
  let s = seed;
  function rng() {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  }
  const vals = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) vals[i] = rng();
  for (let i = 0; i < SIZE; i++) perm[i] = i;
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < SIZE; i++) perm[i + SIZE] = perm[i];

  function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a: number, b: number, t: number) { return a + t * (b - a); }

  return function noise2d(x: number, y: number): number {
    const ix = Math.floor(x) & (SIZE - 1);
    const iy = Math.floor(y) & (SIZE - 1);
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const u = fade(fx);
    const v = fade(fy);
    const a = vals[perm[ix + perm[iy]]];
    const b = vals[perm[ix + 1 + perm[iy]]];
    const c = vals[perm[ix + perm[iy + 1]]];
    const d = vals[perm[ix + 1 + perm[iy + 1]]];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

export function generateMap(): TileType[][] {
  const map: TileType[][] = [];

  const waterNoise = makeNoise(42);
  const terrainNoise = makeNoise(137);
  const treeNoise = makeNoise(256);

  // Seeded RNG for small details
  let seed = 42;
  function rand() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let y = 0; y < MAP_H; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < MAP_W; x++) {
      // Border is always water
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) {
        row.push(TileType.Water);
        continue;
      }

      // Water: use noise at low frequency for rivers/lakes
      const w = waterNoise(x * 0.08, y * 0.08);
      // Add a second octave for river-like shapes
      const w2 = waterNoise(x * 0.15 + 50, y * 0.15 + 50);
      const waterVal = w * 0.6 + w2 * 0.4;

      if (waterVal < 0.22) {
        row.push(TileType.Water);
        continue;
      }

      // Trees: clusters using noise
      const t = treeNoise(x * 0.12, y * 0.12);
      if (t > 0.65 && rand() < 0.7) {
        row.push(TileType.Stone); // Stone = tree tiles
        continue;
      }

      // Terrain: grass vs dirt
      const ter = terrainNoise(x * 0.1, y * 0.1);
      if (ter < 0.45) {
        row.push(TileType.Dirt);
      } else {
        row.push(TileType.Grass);
      }
    }
    map.push(row);
  }

  // Clear spawn area
  for (let y = 22; y <= 28; y++)
    for (let x = 22; x <= 28; x++) map[y][x] = TileType.Grass;

  return map;
}

export function isWalkable(tileType: TileType, stumps: Set<string>, x: number, y: number): boolean {
  if (stumps.has(`${x},${y}`)) return true;
  return tileType === TileType.Grass || tileType === TileType.Dirt;
}

/** Check if a position (float) is walkable, testing all 4 corners of a small hitbox */
const BODY_R = 0.25; // half-size of collision body in tiles
export function canMoveTo(tiles: TileType[][], stumps: Set<string>, px: number, py: number): boolean {
  const corners = [
    [px - BODY_R, py - BODY_R],
    [px + BODY_R, py - BODY_R],
    [px - BODY_R, py + BODY_R],
    [px + BODY_R, py + BODY_R],
  ];
  for (const [cx, cy] of corners) {
    const tx = Math.floor(cx);
    const ty = Math.floor(cy);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    if (!isWalkable(tiles[ty][tx], stumps, tx, ty)) return false;
  }
  return true;
}
