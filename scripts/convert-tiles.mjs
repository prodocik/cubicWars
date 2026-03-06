import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPRITES = path.join(__dirname, "..", "assets", "sprites");
const OUT = path.join(SPRITES, "iso");

const TILE_W = 64;
const TILE_H = 32;
const HW = TILE_W / 2;
const HH = TILE_H / 2;

const TILES = ["grass", "dirt", "water", "stone"];

async function convertTile(name) {
  const src = await sharp(path.join(SPRITES, `${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sw = src.info.width;
  const sh = src.info.height;
  const srcData = src.data;

  const dst = Buffer.alloc(TILE_W * TILE_H * 4, 0);

  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      const rx = px - HW;
      const ry = py;

      // diamond bounds check
      if (Math.abs(rx) / HW + Math.abs(ry - HH) / HH > 1) continue;

      // map to texture UV [0..1]
      const u = (rx / HW + ry / HH) / 2;
      const v = (ry / HH - rx / HW) / 2;

      const srcX = Math.min(Math.max(Math.floor(u * sw), 0), sw - 1);
      const srcY = Math.min(Math.max(Math.floor(v * sh), 0), sh - 1);

      const si = (srcY * sw + srcX) * 4;
      const di = (py * TILE_W + px) * 4;

      dst[di] = srcData[si];
      dst[di + 1] = srcData[si + 1];
      dst[di + 2] = srcData[si + 2];
      dst[di + 3] = 255;
    }
  }

  await sharp(dst, { raw: { width: TILE_W, height: TILE_H, channels: 4 } })
    .png()
    .toFile(path.join(OUT, `${name}.png`));

  console.log(`  ${name}.png -> iso/${name}.png`);
}

console.log("Converting tiles to isometric...");
for (const name of TILES) {
  await convertTile(name);
}
console.log("Done!");
