import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import path from "path";
import { generateMap, canMoveTo, MAP_W, MAP_H } from "../src/world";

const PORT = Number(process.env.PORT) || 3002;
const DB_PATH = path.join(__dirname, "game.db");
const TICK_RATE = 60; // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const PLAYER_SPEED = 4.8; // tiles per second
const SNAPSHOT_RATE = 30; // snapshots per second (broadcast rate)
const SNAPSHOT_INTERVAL = TICK_RATE / SNAPSHOT_RATE; // ticks between snapshots

// --- Database setup ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    name TEXT PRIMARY KEY,
    skin_index INTEGER NOT NULL DEFAULT 0,
    tile_x REAL NOT NULL DEFAULT 25,
    tile_y REAL NOT NULL DEFAULT 25,
    inventory TEXT NOT NULL DEFAULT '[]',
    skills TEXT NOT NULL DEFAULT '{}',
    hotbar TEXT NOT NULL DEFAULT '[]'
  )
`);

const stmtLoad = db.prepare("SELECT * FROM characters WHERE name = ?");
const stmtCreate = db.prepare(
  "INSERT INTO characters (name, skin_index, tile_x, tile_y, inventory, skills, hotbar) VALUES (?, ?, 25, 25, ?, ?, ?)"
);
const stmtSave = db.prepare(
  "UPDATE characters SET skin_index=?, tile_x=?, tile_y=?, inventory=?, skills=?, hotbar=? WHERE name=?"
);

interface CharData {
  name: string;
  skinIndex: number;
  tileX: number;
  tileY: number;
  inventory: any[];
  skills: Record<string, number>;
  hotbar: (string | null)[];
}

function normalizeInventory(items: any[]): any[] {
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.id === "crossbow") {
      return { ...item, id: "bow", name: "Лук", icon: "🏹" };
    }
    return item;
  });
}

function loadCharacter(name: string): CharData | null {
  const row = stmtLoad.get(name) as any;
  if (!row) return null;
  return {
    name: row.name,
    skinIndex: row.skin_index,
    tileX: row.tile_x,
    tileY: row.tile_y,
    inventory: normalizeInventory(JSON.parse(row.inventory)),
    skills: JSON.parse(row.skills),
    hotbar: JSON.parse(row.hotbar),
  };
}

const defaultInventory = [
  { id: "banner", name: "\u0411\u0430\u043d\u043d\u0435\u0440", color: "#2f9e62", icon: "\ud83c\udff4", quantity: 3 },
  { id: "axe", name: "\u0422\u043e\u043f\u043e\u0440", color: "#888", icon: "\ud83e\ude93", quantity: 1 },
  { id: "pickaxe", name: "\u041a\u0438\u0440\u043a\u0430", color: "#888", icon: "\u26cf\ufe0f", quantity: 1 },
  { id: "bow", name: "\u041b\u0443\u043a", color: "#555", icon: "\ud83c\udff9", quantity: 1 },
];

function createCharacter(name: string, skinIndex: number): CharData {
  const inv = JSON.stringify(defaultInventory);
  const skills = JSON.stringify({ lumberjack: 0, miner: 0 });
  const hotbar = JSON.stringify(new Array(10).fill(null));
  stmtCreate.run(name, skinIndex, inv, skills, hotbar);
  return {
    name,
    skinIndex,
    tileX: 25,
    tileY: 25,
    inventory: JSON.parse(JSON.stringify(defaultInventory)),
    skills: { lumberjack: 0, miner: 0 },
    hotbar: new Array(10).fill(null),
  };
}

function saveCharacter(data: CharData) {
  stmtSave.run(
    data.skinIndex,
    data.tileX,
    data.tileY,
    JSON.stringify(data.inventory),
    JSON.stringify(data.skills),
    JSON.stringify(data.hotbar),
    data.name
  );
}

// --- Game state ---
const MAX_HP = 100;
const BULLET_DAMAGE = 34;
const RESPAWN_TIME = 5; // seconds

interface PlayerState {
  id: string;
  ws: WebSocket;
  char: CharData;
  path: { x: number; y: number }[];
  inputDx: number;
  inputDy: number;
  lastInputSeq: number;
  lastShotTime: number;
  hp: number;
  dead: boolean;
  respawnTimer: number; // seconds remaining
  kills: number;
  deaths: number;
}

interface Bullet {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  dx: number; // direction (normalized)
  dy: number;
  speed: number; // tiles per second
  age: number; // seconds alive
}

const BULLET_SPEED = 24; // tiles per second
const SHOOT_COOLDOWN = 0.2; // seconds between shots
const BULLET_MAX_AGE = 1.5; // seconds before despawn
const SHOT_RANGE = 20;
const HIT_RADIUS = 0.45;
const MAP_BOUNDS = 50;

const players = new Map<string, PlayerState>(); // id -> state
const wsByPlayer = new Map<WebSocket, PlayerState>();
const bullets: Bullet[] = [];
const tiles = generateMap();
const stumps = new Set<string>(); // chopped trees (also tracked server-side)
const minedRocks = new Set<string>(); // mined rocks tracked server-side
let nextId = 1;
let nextBulletId = 1;
let tickCount = 0;

function sendTo(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function hasRock(x: number, y: number): boolean {
  if (x >= 22 && x <= 28 && y >= 22 && y <= 28) return false;
  if (tiles[y][x] !== TileType.Grass && tiles[y][x] !== TileType.Dirt) return false;
  const h = ((x * 31 + y * 47 + x * y * 7) & 0x7fffffff) % 100;
  return h < 8;
}

function isBlockedTile(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
  if (!isWalkable(tiles[y][x], stumps, x, y)) return true;
  return hasRock(x, y) && !minedRocks.has(`${x},${y}`);
}

function raycastDistance(originX: number, originY: number, dx: number, dy: number, maxDistance: number): number {
  for (let distance = 0.25; distance <= maxDistance; distance += 0.2) {
    const sampleX = originX + dx * distance;
    const sampleY = originY + dy * distance;
    const tileX = Math.floor(sampleX);
    const tileY = Math.floor(sampleY);
    if (isBlockedTile(tileX, tileY)) {
      return Math.max(0.2, distance - 0.1);
    }
  }
  return maxDistance;
}

function broadcast(msg: object, exclude?: string) {
  const data = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== exclude && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

function broadcastLeaderboard() {
  const board: { id: string; name: string; kills: number; deaths: number }[] = [];
  for (const [, p] of players) {
    board.push({ id: p.id, name: p.char.name, kills: p.kills, deaths: p.deaths });
  }
  board.sort((a, b) => b.kills - a.kills);
  const msg = JSON.stringify({ type: "leaderboard", board });
  for (const [, p] of players) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
  }
}

// --- Server tick loop ---
function tick() {
  const dt = 1 / TICK_RATE;
  tickCount++;

  for (const [, p] of players) {
    // Respawn timer
    if (p.dead) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        p.dead = false;
        p.hp = MAX_HP;
        // Random spawn position in safe area
        p.char.tileX = 20 + Math.random() * 10;
        p.char.tileY = 20 + Math.random() * 10;
        p.path = [];
        p.inputDx = 0;
        p.inputDy = 0;
        sendTo(p.ws, { type: "respawn", x: p.char.tileX, y: p.char.tileY, hp: p.hp });
        broadcast({ type: "player_respawn", id: p.id, x: p.char.tileX, y: p.char.tileY }, p.id);
      }
      continue; // dead players don't move
    }

    // Path-based movement (click-to-move)
    if (p.path.length > 0) {
      let remaining = PLAYER_SPEED * dt;
      while (remaining > 0 && p.path.length > 0) {
        const target = p.path[0];
        const dx = target.x - p.char.tileX;
        const dy = target.y - p.char.tileY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 0.001) {
          p.path.shift();
          continue;
        }
        if (remaining >= dist) {
          p.char.tileX = target.x;
          p.char.tileY = target.y;
          remaining -= dist;
          p.path.shift();
        } else {
          p.char.tileX += (dx / dist) * remaining;
          p.char.tileY += (dy / dist) * remaining;
          remaining = 0;
        }
      }
    }

    // Free input movement (WASD / shooter mode)
    if (p.inputDx !== 0 || p.inputDy !== 0) {
      let dx = p.inputDx;
      let dy = p.inputDy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }
      const newX = p.char.tileX + dx * PLAYER_SPEED * dt;
      const newY = p.char.tileY + dy * PLAYER_SPEED * dt;
      // Try full move, then axis-by-axis (wall sliding)
      if (canMoveTo(tiles, stumps, newX, newY)) {
        p.char.tileX = newX;
        p.char.tileY = newY;
      } else {
        if (canMoveTo(tiles, stumps, newX, p.char.tileY)) {
          p.char.tileX = newX;
        }
        if (canMoveTo(tiles, stumps, p.char.tileX, newY)) {
          p.char.tileY = newY;
        }
      }
      p.path = [];
    }

    // Clamp to map bounds
    p.char.tileX = Math.max(0, Math.min(MAP_W - 1, p.char.tileX));
    p.char.tileY = Math.max(0, Math.min(MAP_H - 1, p.char.tileY));
  }

    // Update bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.dx * b.speed * dt;
    b.y += b.dy * b.speed * dt;
    b.age += dt;

    // Remove if out of bounds or too old
    if (b.x < -1 || b.y < -1 || b.x > MAP_BOUNDS + 1 || b.y > MAP_BOUNDS + 1 || b.age > BULLET_MAX_AGE) {
      bullets.splice(i, 1);
      continue;
    }

    // Hit detection against players
    const HIT_RADIUS = 0.7;
    for (const [pid, p] of players) {
      if (pid === b.ownerId || p.dead) continue;
      const pdx = p.char.tileX - b.x;
      const pdy = p.char.tileY - b.y;
      if (pdx * pdx + pdy * pdy < HIT_RADIUS * HIT_RADIUS) {
        if (typeof p.hp !== "number" || isNaN(p.hp)) p.hp = MAX_HP;
        p.hp -= BULLET_DAMAGE;
        const killed = p.hp <= 0;

        if (killed) {
          p.hp = 0;
          p.dead = true;
          p.respawnTimer = RESPAWN_TIME;
          p.deaths++;
          p.path = [];
          p.inputDx = 0;
          p.inputDy = 0;
          // Credit kill to shooter
          const shooter = players.get(b.ownerId);
          if (shooter) shooter.kills++;
        }

        console.log(`HIT: bullet ${b.id} hit ${p.char.name}, hp: ${p.hp}, killed: ${killed}`);
        // Broadcast hit
        broadcast({
          type: "hit",
          targetId: pid,
          bulletId: b.id,
          x: b.x, y: b.y,
          shooterId: b.ownerId,
          damage: BULLET_DAMAGE,
          targetHp: p.hp,
          killed,
        });

        // Send leaderboard update
        broadcastLeaderboard();

        bullets.splice(i, 1);
        break;
      }
    }
  }

  // Broadcast snapshot at SNAPSHOT_RATE
  if (players.size > 0 && tickCount % SNAPSHOT_INTERVAL === 0) {
    const snapshot: any[] = [];
    for (const [, p] of players) {
      snapshot.push({
        id: p.id,
        x: Math.round(p.char.tileX * 1000) / 1000,
        y: Math.round(p.char.tileY * 1000) / 1000,
        seq: p.lastInputSeq,
        hp: p.hp,
        dead: p.dead,
      });
    }
    const msg = JSON.stringify({ type: "snapshot", tick: tickCount, players: snapshot });
    for (const [, p] of players) {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(msg);
      }
    }
  }

  // Auto-save every 600 ticks (~30 seconds)
  if (tickCount % (TICK_RATE * 30) === 0) {
    for (const [, p] of players) {
      saveCharacter(p.char);
    }
  }
}

// --- WebSocket server ---
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  const id = String(nextId++);
  let state: PlayerState | null = null;

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));

      if (msg.type === "join") {
        const name = String(msg.name).slice(0, 20);
        const skinIndex = Number(msg.skinIndex) || 0;

        let char = loadCharacter(name);
        if (!char) {
          char = createCharacter(name, skinIndex);
          console.log(`New character "${name}" created`);
        } else {
          console.log(`Loaded character "${name}"`);
          char.skinIndex = skinIndex;
        }

        state = {
          id, ws, char,
          path: [],
          inputDx: 0, inputDy: 0,
          lastInputSeq: 0, lastShotTime: 0,
          hp: MAX_HP, dead: false, respawnTimer: 0,
          kills: 0, deaths: 0,
        };
        players.set(id, state);
        wsByPlayer.set(ws, state);

        // Send init
        const existing: any[] = [];
        for (const [pid, p] of players) {
          if (pid !== id) {
            existing.push({
              id: p.id, name: p.char.name, skinIndex: p.char.skinIndex,
              tileX: p.char.tileX, tileY: p.char.tileY,
            });
          }
        }

        sendTo(ws, {
          type: "init",
          id,
          tickRate: TICK_RATE,
          players: existing,
          world: {
            stumps: [...stumps],
            minedRocks: [...minedRocks],
          },
          character: {
            tileX: char.tileX,
            tileY: char.tileY,
            skinIndex: char.skinIndex,
            inventory: char.inventory,
            skills: char.skills,
            hotbar: char.hotbar,
            hp: MAX_HP,
          },
        });

        // Send current leaderboard
        broadcastLeaderboard();

        broadcast({
          type: "join",
          player: {
            id, name: char.name, skinIndex: char.skinIndex,
            tileX: char.tileX, tileY: char.tileY,
          },
        }, id);
      }

      if (!state) return;

      // Path-based movement (click somewhere on map)
      if (msg.type === "move") {
        state.char.tileX = msg.tileX;
        state.char.tileY = msg.tileY;
        state.path = msg.path || [];
        state.inputDx = 0;
        state.inputDy = 0;
        // Broadcast to others so they see the path too (for smooth prediction)
        broadcast({
          type: "move", id,
          tileX: msg.tileX, tileY: msg.tileY,
          path: msg.path,
        }, id);
      }

      // Direct input movement (WASD, for shooter mode)
      if (msg.type === "input") {
        state.inputDx = Number(msg.dx) || 0;
        state.inputDy = Number(msg.dy) || 0;
        if (typeof msg.seq === "number") {
          state.lastInputSeq = msg.seq;
        }
        // Clear path when switching to direct input
        if (state.inputDx !== 0 || state.inputDy !== 0) {
          state.path = [];
        }
      }

      // Stop movement
      if (msg.type === "stop") {
        state.path = [];
        state.inputDx = 0;
        state.inputDy = 0;
      }

      if (msg.type === "chop") {
        const key = `${msg.x},${msg.y}`;
        if (!stumps.has(key)) {
          stumps.add(key);
          broadcast({ type: "chop", x: msg.x, y: msg.y, id });
        }
      }

      if (msg.type === "mine") {
        const key = `${msg.x},${msg.y}`;
        if (!minedRocks.has(key)) {
          minedRocks.add(key);
          broadcast({ type: "mine", x: msg.x, y: msg.y, id });
        }
      }

      if (msg.type === "shoot" && !state.dead) {
        const now = Date.now() / 1000;
        if (now - state.lastShotTime >= SHOOT_COOLDOWN) {
          state.lastShotTime = now;
          const dx = Number(msg.dx) || 0;
          const dy = Number(msg.dy) || 0;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            const dirX = dx / len;
            const dirY = dy / len;
            const startX = state.char.tileX;
            const startY = state.char.tileY;
            const maxDistance = raycastDistance(startX, startY, dirX, dirY, SHOT_RANGE);

            let targetId: string | null = null;
            let targetHp = 0;
            let killed = false;
            let bestDistance = maxDistance;

            for (const [pid, player] of players) {
              if (pid === id || player.dead) continue;
              const relX = player.char.tileX - startX;
              const relY = player.char.tileY - startY;
              const along = relX * dirX + relY * dirY;
              if (along < 0 || along > bestDistance) continue;

              const closestX = startX + dirX * along;
              const closestY = startY + dirY * along;
              const offX = player.char.tileX - closestX;
              const offY = player.char.tileY - closestY;
              if (offX * offX + offY * offY > HIT_RADIUS * HIT_RADIUS) continue;

              bestDistance = along;
              targetId = pid;
              targetHp = player.hp - BULLET_DAMAGE;
            }

            const hitX = startX + dirX * bestDistance;
            const hitY = startY + dirY * bestDistance;
            broadcast({
              type: "shot",
              shooterId: id,
              x: startX,
              y: startY,
              dx: dirX,
              dy: dirY,
              hitX,
              hitY,
            });

            if (targetId) {
              const player = players.get(targetId);
              if (player) {
                player.hp = Math.max(0, targetHp);
                killed = player.hp <= 0;
                if (killed) {
                  player.dead = true;
                  player.respawnTimer = RESPAWN_TIME;
                  player.deaths++;
                  player.path = [];
                  player.inputDx = 0;
                  player.inputDy = 0;
                  const shooter = players.get(id);
                  if (shooter) shooter.kills++;
                }

                broadcast({
                  type: "hit",
                  targetId,
                  shooterId: id,
                  damage: BULLET_DAMAGE,
                  targetHp: player.hp,
                  killed,
                  x: hitX,
                  y: hitY,
                });
                broadcastLeaderboard();
              }
            }
          }
        }
      }

      if (msg.type === "flag") {
        broadcast({ type: "flag", id, flagId: msg.flagId }, id);
      }

      if (msg.type === "chat") {
        const text = String(msg.text).slice(0, 120);
        broadcast({ type: "chat", id, text }, id);
      }

      if (msg.type === "reset_inventory") {
        state.char.inventory = JSON.parse(JSON.stringify(defaultInventory));
        state.char.skills = { lumberjack: 0, miner: 0 };
        state.char.hotbar = new Array(10).fill(null);
        saveCharacter(state.char);
        sendTo(ws, {
          type: "reset_inventory",
          inventory: state.char.inventory,
          skills: state.char.skills,
        });
      }

      if (msg.type === "save") {
        if (msg.inventory) state.char.inventory = msg.inventory;
        if (msg.skills) state.char.skills = msg.skills;
        if (msg.hotbar) state.char.hotbar = msg.hotbar;
        saveCharacter(state.char);
      }
    } catch {}
  });

  ws.on("close", () => {
    if (state) {
      saveCharacter(state.char);
      broadcast({ type: "leave", id });
      players.delete(id);
      wsByPlayer.delete(ws);
    }
  });
});

// Start tick loop
setInterval(tick, TICK_MS);

console.log(`Game server running on ws://0.0.0.0:${PORT} (${TICK_RATE} tick/s)`);
