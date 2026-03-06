import { TileType, MAP_W, MAP_H, isWalkable } from "./world";

interface Node {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function findPath(
  tiles: TileType[][],
  stumps: Set<string>,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  blocked?: Set<string>
): { x: number; y: number }[] | null {
  sx = Math.round(sx);
  sy = Math.round(sy);
  gx = Math.round(gx);
  gy = Math.round(gy);

  if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return null;
  const goalTile = tiles[gy]?.[gx] ?? TileType.Water;
  if (!isWalkable(goalTile, stumps, gx, gy)) return null;
  if (blocked?.has(`${gx},${gy}`)) return null;

  const key = (x: number, y: number) => y * MAP_W + x;
  const closed = new Set<number>();
  const openMap = new Map<number, Node>();

  const start: Node = {
    x: sx, y: sy,
    g: 0, h: heuristic(sx, sy, gx, gy), f: 0, parent: null,
  };
  start.f = start.h;
  openMap.set(key(sx, sy), start);

  while (openMap.size > 0) {
    let best: Node | null = null;
    for (const n of openMap.values()) {
      if (!best || n.f < best.f) best = n;
    }
    const cur = best!;
    if (cur.x === gx && cur.y === gy) {
      const path: { x: number; y: number }[] = [];
      let n: Node | null = cur;
      while (n) {
        path.push({ x: n.x, y: n.y });
        n = n.parent;
      }
      path.reverse();
      return path;
    }

    openMap.delete(key(cur.x, cur.y));
    closed.add(key(cur.x, cur.y));

    for (const d of DIRS) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const tile = tiles[ny]?.[nx] ?? TileType.Water;
      if (!isWalkable(tile, stumps, nx, ny)) continue;
      if (blocked?.has(`${nx},${ny}`)) continue;
      if (closed.has(key(nx, ny))) continue;

      if (d.dx !== 0 && d.dy !== 0) {
        const t1 = tiles[cur.y]?.[cur.x + d.dx] ?? TileType.Water;
        const t2 = tiles[cur.y + d.dy]?.[cur.x] ?? TileType.Water;
        if (!isWalkable(t1, stumps, cur.x + d.dx, cur.y) ||
            !isWalkable(t2, stumps, cur.x, cur.y + d.dy)) continue;
      }

      const cost = d.dx !== 0 && d.dy !== 0 ? 1.414 : 1;
      const g = cur.g + cost;
      const existing = openMap.get(key(nx, ny));
      if (existing && existing.g <= g) continue;

      const node: Node = {
        x: nx, y: ny, g, h: heuristic(nx, ny, gx, gy),
        f: g + heuristic(nx, ny, gx, gy), parent: cur,
      };
      openMap.set(key(nx, ny), node);
    }
  }
  return null;
}
