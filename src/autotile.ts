import { TileType, MAP_W, MAP_H } from "./world";
import { Images } from "./resources";
import * as ex from "excalibur";

const TW = 64;
const TH = 32;

type Neighbors = {
  n: TileType; e: TileType; s: TileType; w: TileType;
  ne: TileType; se: TileType; sw: TileType; nw: TileType;
};

function getNeighbors(tiles: TileType[][], x: number, y: number): Neighbors {
  const get = (dx: number, dy: number): TileType => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return TileType.Water;
    return tiles[ny][nx];
  };
  return {
    n: get(0, -1), e: get(1, 0), s: get(0, 1), w: get(-1, 0),
    ne: get(1, -1), se: get(1, 1), sw: get(-1, 1), nw: get(-1, -1),
  };
}

function isWater(t: TileType): boolean { return t === TileType.Water; }
function isDirt(t: TileType): boolean { return t === TileType.Dirt; }

function clipDiamond(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(TW / 2, 0);
  ctx.lineTo(TW, TH / 2);
  ctx.lineTo(TW / 2, TH);
  ctx.lineTo(0, TH / 2);
  ctx.closePath();
  ctx.clip();
}

// Edge midpoints and triangle geometry for each diamond edge
const EDGE_GEO: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {
  n: { x1: TW / 2, y1: 0, x2: TW, y2: TH / 2 },
  e: { x1: TW, y1: TH / 2, x2: TW / 2, y2: TH },
  s: { x1: TW / 2, y1: TH, x2: 0, y2: TH / 2 },
  w: { x1: 0, y1: TH / 2, x2: TW / 2, y2: 0 },
};

// Corner points of diamond
const CORNER_PTS: Record<string, { px: number; py: number }> = {
  nw: { px: TW / 2, py: 0 },
  ne: { px: TW, py: TH / 2 },
  se: { px: TW / 2, py: TH },
  sw: { px: 0, py: TH / 2 },
};

// Draw a gradient overlay from an edge toward center
function drawEdgeBlend(
  ctx: CanvasRenderingContext2D,
  edge: string,
  color: string,
  depth: number, // 0..1 how far toward center
) {
  const ep = EDGE_GEO[edge];
  const midX = (ep.x1 + ep.x2) / 2;
  const midY = (ep.y1 + ep.y2) / 2;
  const cX = TW / 2, cY = TH / 2;

  ctx.save();
  clipDiamond(ctx);

  const grad = ctx.createLinearGradient(
    midX, midY,
    midX + (cX - midX) * depth,
    midY + (cY - midY) * depth,
  );
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(ep.x1, ep.y1);
  ctx.lineTo(ep.x2, ep.y2);
  ctx.lineTo(cX, cY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Draw corner radial blend
function drawCornerBlend(
  ctx: CanvasRenderingContext2D,
  corner: string,
  color: string,
) {
  const cp = CORNER_PTS[corner];
  ctx.save();
  clipDiamond(ctx);
  const grad = ctx.createRadialGradient(cp.px, cp.py, 0, cp.px, cp.py, 10);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cp.px, cp.py, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function getBaseImage(type: TileType): HTMLImageElement {
  switch (type) {
    case TileType.Water: return Images.water.image;
    case TileType.Dirt: return Images.dirt.image;
    case TileType.Stone: return Images.grass.image;
    default: return Images.grass.image;
  }
}

// Check if all images are loaded (they should be after loader)
function hasNeighborDiff(type: TileType, nb: Neighbors): boolean {
  return nb.n !== type || nb.e !== type || nb.s !== type || nb.w !== type ||
    nb.ne !== type || nb.se !== type || nb.sw !== type || nb.nw !== type;
}

// Get the base sprite for a tile type
function getBaseSprite(type: TileType): ex.Sprite {
  switch (type) {
    case TileType.Water: return Images.water.toSprite();
    case TileType.Dirt: return Images.dirt.toSprite();
    case TileType.Stone: return Images.grass.toSprite();
    default: return Images.grass.toSprite();
  }
}

const tileCache = new Map<string, ex.Graphic>();

export function generateTileGraphic(
  tiles: TileType[][],
  x: number, y: number,
): ex.Graphic {
  const type = tiles[y][x];
  const nb = getNeighbors(tiles, x, y);

  // If no neighbor differs, just return the base sprite (original PNG)
  if (!hasNeighborDiff(type, nb)) {
    return getBaseSprite(type);
  }

  const key = `${type}:${nb.n},${nb.e},${nb.s},${nb.w},${nb.ne},${nb.se},${nb.sw},${nb.nw}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  const myWater = isWater(type);
  const myDirt = isDirt(type);

  const canvas = new ex.Canvas({
    width: TW, height: TH, cache: true,
    draw: (ctx) => {
      // Draw the original PNG sprite as base
      const img = getBaseImage(type);
      if (img && img.complete) {
        ctx.save();
        clipDiamond(ctx);
        ctx.drawImage(img, 0, 0, TW, TH);
        ctx.restore();
      }

      // Edge transitions
      const edges = [
        { dir: "n", t: nb.n }, { dir: "e", t: nb.e },
        { dir: "s", t: nb.s }, { dir: "w", t: nb.w },
      ];

      for (const edge of edges) {
        if (edge.t === type) continue;

        if (myWater && !isWater(edge.t)) {
          // Water bordering land: sandy shore
          drawEdgeBlend(ctx, edge.dir, "rgba(194,178,128,0.45)", 0.45);
          // Foam line
          const ep = EDGE_GEO[edge.dir];
          const midX = (ep.x1 + ep.x2) / 2;
          const midY = (ep.y1 + ep.y2) / 2;
          const cX = TW / 2, cY = TH / 2;
          const dx = cX - midX, dy = cY - midY;
          const len = Math.sqrt(dx * dx + dy * dy);
          const off = 3;
          const ox = (dx / len) * off, oy = (dy / len) * off;
          ctx.save();
          clipDiamond(ctx);
          ctx.strokeStyle = "rgba(255,255,255,0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ep.x1 + ox, ep.y1 + oy);
          ctx.lineTo(ep.x2 + ox, ep.y2 + oy);
          ctx.stroke();
          ctx.restore();
        } else if (!myWater && isWater(edge.t)) {
          // Land bordering water: dark wet edge
          drawEdgeBlend(ctx, edge.dir, "rgba(40,80,120,0.35)", 0.35);
        } else if (myDirt && !isDirt(edge.t) && !isWater(edge.t)) {
          // Dirt bordering grass: green tint on edge
          drawEdgeBlend(ctx, edge.dir, "rgba(90,140,58,0.3)", 0.4);
        } else if (!myDirt && !myWater && isDirt(edge.t)) {
          // Grass bordering dirt: brown tint on edge
          drawEdgeBlend(ctx, edge.dir, "rgba(158,138,96,0.3)", 0.4);
        }
      }

      // Corner transitions
      const cornerDefs = [
        { corner: "nw", t: nb.nw, a1: nb.n, a2: nb.w },
        { corner: "ne", t: nb.ne, a1: nb.n, a2: nb.e },
        { corner: "se", t: nb.se, a1: nb.e, a2: nb.s },
        { corner: "sw", t: nb.sw, a1: nb.s, a2: nb.w },
      ];

      for (const cd of cornerDefs) {
        if (cd.a1 === type && cd.a2 === type && cd.t !== type) {
          if (isWater(cd.t)) {
            drawCornerBlend(ctx, cd.corner, "rgba(40,80,120,0.25)");
          } else if (isDirt(cd.t) && !myDirt) {
            drawCornerBlend(ctx, cd.corner, "rgba(158,138,96,0.2)");
          } else if (!isDirt(cd.t) && myDirt) {
            drawCornerBlend(ctx, cd.corner, "rgba(90,140,58,0.2)");
          }
        }
      }
    },
  });

  tileCache.set(key, canvas);
  return canvas;
}
