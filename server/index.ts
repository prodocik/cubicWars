import { WebSocketServer, WebSocket } from "ws";
import { BlockId, PLAYER_HEIGHT, PLAYER_RADIUS, WORLD_HEIGHT } from "../src/voxelWorld";
import {
  DEFAULT_SERVER_PORT,
  SERVER_TICK_RATE,
  type BlockEditState,
  type ClientMessage,
  type JoinMessage,
  type PlayerStateMessage,
  type RemotePlayerState,
  type SetBlockMessage,
} from "../src/multiplayerProtocol";

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT;
const SNAPSHOT_INTERVAL_MS = Math.round(1000 / SERVER_TICK_RATE);
const MAX_COORD = 1_000_000;
const MAX_NAME_LENGTH = 24;
const GRAVITY = 31;
const MAX_FALL_SPEED = 38;
const GROUND_CHECK = 0.08;
const COLLISION_EPSILON = 1e-4;

interface ServerPlayer extends RemotePlayerState {
  ws: WebSocket;
  velocityY: number;
  onGround: boolean;
}

const players = new Map<string, ServerPlayer>();
const playersBySocket = new Map<WebSocket, ServerPlayer>();
const blockEdits = new Map<string, number>();
let nextPlayerId = 1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeName(value: unknown) {
  if (typeof value !== "string") return "Player";
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  return cleaned || "Player";
}

function sanitizeAngle(value: unknown) {
  if (!isFiniteNumber(value)) return 0;
  return value;
}

function sanitizeCoord(value: unknown, fallback = 0) {
  if (!isFiniteNumber(value)) return fallback;
  return clamp(value, -MAX_COORD, MAX_COORD);
}

function sanitizeHeight(value: unknown, fallback = 24) {
  if (!isFiniteNumber(value)) return fallback;
  return clamp(value, -32, WORLD_HEIGHT + 32);
}

function sanitizeHeldItemId(value: unknown) {
  if (typeof value !== "string") return "block:1";
  return value.slice(0, 32) || "block:1";
}

function sanitizeAppearanceSeed(value: unknown, fallback = 1) {
  if (!isFiniteNumber(value)) return fallback;
  return Math.floor(clamp(Math.abs(value), 1, 0x7fffffff));
}

function parseJoinMessage(raw: unknown): JoinMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "join") return null;
  return {
    type: "join",
    name: sanitizeName(msg.name),
    appearanceSeed: sanitizeAppearanceSeed(msg.appearanceSeed, 1),
    x: sanitizeCoord(msg.x, 0.5),
    y: sanitizeHeight(msg.y, 24),
    z: sanitizeCoord(msg.z, 0.5),
    yaw: sanitizeAngle(msg.yaw),
    pitch: sanitizeAngle(msg.pitch),
    heldItemId: sanitizeHeldItemId(msg.heldItemId),
  };
}

function isPlayerStateMessage(raw: unknown): raw is PlayerStateMessage {
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>).type === "player_state";
}

function isSetBlockMessage(raw: unknown): raw is SetBlockMessage {
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>).type === "set_block";
}

function playerPublicState(player: ServerPlayer): RemotePlayerState {
  return {
    id: player.id,
    name: player.name,
    appearanceSeed: player.appearanceSeed,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    heldItemId: player.heldItemId,
  };
}

function sendTo(ws: WebSocket, message: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(message: object, excludeId?: string) {
  const payload = JSON.stringify(message);
  for (const player of players.values()) {
    if (player.id === excludeId) continue;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(payload);
    }
  }
}

function editKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function serializeBlockEdits(): BlockEditState[] {
  const edits: BlockEditState[] = [];
  for (const [key, block] of blockEdits) {
    const [x, y, z] = key.split(",").map(Number);
    edits.push({ x, y, z, block });
  }
  return edits;
}

function handlePlayerState(player: ServerPlayer, msg: PlayerStateMessage) {
  const previousY = player.y;
  const proposedY = sanitizeHeight(msg.y, player.y);
  const grounded = player.onGround || hasGroundContact(player);
  player.x = sanitizeCoord(msg.x, player.x);
  player.z = sanitizeCoord(msg.z, player.z);
  player.yaw = sanitizeAngle(msg.yaw);
  player.pitch = sanitizeAngle(msg.pitch);
  player.heldItemId = sanitizeHeldItemId(msg.heldItemId);

  const deltaY = proposedY - previousY;
  if (grounded && Math.abs(deltaY) <= 0.08) {
    player.y = proposedY;
  }

  if (grounded && deltaY > 0.02 && deltaY < 0.9) {
    player.y = proposedY;
    player.velocityY = Math.max(player.velocityY, deltaY * SERVER_TICK_RATE);
    player.onGround = false;
  }
}

function handleSetBlock(player: ServerPlayer, msg: SetBlockMessage) {
  const x = Math.floor(sanitizeCoord(msg.x, 0));
  const y = Math.floor(sanitizeHeight(msg.y, 0));
  const z = Math.floor(sanitizeCoord(msg.z, 0));
  const block = Math.floor(sanitizeCoord(msg.block, BlockId.Air));

  if (y < 0 || y >= WORLD_HEIGHT) return;
  blockEdits.set(editKey(x, y, z), block);
  broadcast({ type: "set_block", by: player.id, x, y, z, block }, player.id);
}

function getBlock(x: number, y: number, z: number): BlockId {
  if (y < 0) return BlockId.Stone;
  if (y >= WORLD_HEIGHT) return BlockId.Air;

  const edited = blockEdits.get(editKey(x, y, z));
  if (edited !== undefined) return edited as BlockId;
  return sampleGeneratedBlock(x, y, z);
}

function sampleGeneratedBlock(x: number, y: number, z: number): BlockId {
  const surface = surfaceHeight(x, z);
  if (y > surface) {
    return sampleTreeBlock(x, y, z);
  }
  if (y === surface) return BlockId.Grass;
  if (y >= surface - 3) return BlockId.Dirt;
  return BlockId.Stone;
}

function surfaceHeight(x: number, z: number) {
  const continental = fbm2D(x * 0.003, z * 0.003, 4, 2) * 18;
  const hills = fbm2D(x * 0.012, z * 0.012, 3, 11) * 7;
  const detail = fbm2D(x * 0.04, z * 0.04, 2, 37) * 2;
  const raw = 18 + continental + hills + detail;
  const dist = Math.sqrt(x * x + z * z);
  const spawnBlend = Math.max(0, 1 - dist / 18);
  const flattened = lerp(raw, 18, spawnBlend);
  return Math.max(6, Math.min(WORLD_HEIGHT - 8, Math.floor(flattened)));
}

function sampleTreeBlock(x: number, y: number, z: number): BlockId {
  for (let tz = z - 2; tz <= z + 2; tz++) {
    for (let tx = x - 2; tx <= x + 2; tx++) {
      if (!hasTree(tx, tz)) continue;
      const surface = surfaceHeight(tx, tz);
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

function isCollidable(block: BlockId) {
  return block !== BlockId.Air;
}

function collides(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  const startX = Math.floor(minX);
  const endX = Math.floor(maxX - 0.0001);
  const startY = Math.floor(minY);
  const endY = Math.floor(maxY - 0.0001);
  const startZ = Math.floor(minZ);
  const endZ = Math.floor(maxZ - 0.0001);

  for (let y = startY; y <= endY; y++) {
    for (let z = startZ; z <= endZ; z++) {
      for (let x = startX; x <= endX; x++) {
        if (isCollidable(getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

function bodyCollidesAt(x: number, y: number, z: number) {
  return collides(
    x - PLAYER_RADIUS + COLLISION_EPSILON,
    y + COLLISION_EPSILON,
    z - PLAYER_RADIUS + COLLISION_EPSILON,
    x + PLAYER_RADIUS - COLLISION_EPSILON,
    y + PLAYER_HEIGHT - COLLISION_EPSILON,
    z + PLAYER_RADIUS - COLLISION_EPSILON
  );
}

function hasGroundContact(player: ServerPlayer) {
  return collides(
    player.x - PLAYER_RADIUS + COLLISION_EPSILON,
    player.y - GROUND_CHECK,
    player.z - PLAYER_RADIUS + COLLISION_EPSILON,
    player.x + PLAYER_RADIUS - COLLISION_EPSILON,
    player.y,
    player.z + PLAYER_RADIUS - COLLISION_EPSILON
  );
}

function findSafeY(player: ServerPlayer) {
  const baseY = Math.floor(player.y);
  for (let offset = 0; offset <= 32; offset++) {
    const candidate = baseY + offset + 0.001;
    if (!bodyCollidesAt(player.x, candidate, player.z)) return candidate;
  }
  return surfaceHeight(Math.floor(player.x), Math.floor(player.z)) + 1;
}

function moveVertical(player: ServerPlayer, dy: number) {
  if (dy === 0) return;

  const startY = player.y;
  const targetY = startY + dy;
  if (!bodyCollidesAt(player.x, targetY, player.z)) {
    player.y = targetY;
    return;
  }

  let low = Math.min(startY, targetY);
  let high = Math.max(startY, targetY);
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) * 0.5;
    if (bodyCollidesAt(player.x, mid, player.z)) {
      if (dy > 0) {
        high = mid;
      } else {
        low = mid;
      }
    } else if (dy > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  player.y = dy > 0 ? low : high;
  if (dy < 0) player.onGround = true;
  player.velocityY = 0;
}

function simulatePlayer(player: ServerPlayer, dt: number) {
  if (bodyCollidesAt(player.x, player.y, player.z)) {
    player.y = findSafeY(player);
    player.velocityY = 0;
  }

  player.onGround = hasGroundContact(player);
  if (!player.onGround || player.velocityY > 0) {
    player.velocityY = Math.max(player.velocityY - GRAVITY * dt, -MAX_FALL_SPEED);
    moveVertical(player, player.velocityY * dt);
    player.onGround = hasGroundContact(player);
    if (player.onGround && player.velocityY < 0) {
      player.velocityY = 0;
    }
  } else {
    player.velocityY = 0;
  }
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

const wss = new WebSocketServer({ host: "0.0.0.0", port: PORT });

wss.on("connection", (ws) => {
  let joined = false;

  ws.on("message", (raw) => {
    let message: ClientMessage | null = null;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (!joined) {
      const join = parseJoinMessage(message);
      if (!join) return;

      const player: ServerPlayer = {
        id: String(nextPlayerId++),
        ws,
        name: join.name,
        appearanceSeed: join.appearanceSeed,
        x: join.x,
        y: join.y,
        z: join.z,
        yaw: join.yaw,
        pitch: join.pitch,
        heldItemId: join.heldItemId,
        velocityY: 0,
        onGround: false,
      };

      if (bodyCollidesAt(player.x, player.y, player.z)) {
        player.y = findSafeY(player);
      }
      player.onGround = hasGroundContact(player);

      players.set(player.id, player);
      playersBySocket.set(ws, player);
      joined = true;

      sendTo(ws, {
        type: "init",
        id: player.id,
        tickRate: SERVER_TICK_RATE,
        players: Array.from(players.values()).map(playerPublicState),
        blocks: serializeBlockEdits(),
      });

      broadcast({ type: "player_join", player: playerPublicState(player) }, player.id);
      console.log(`Player joined: ${player.name}#${player.id}`);
      return;
    }

    const player = playersBySocket.get(ws);
    if (!player) return;

    if (isPlayerStateMessage(message)) {
      handlePlayerState(player, message);
      return;
    }

    if (isSetBlockMessage(message)) {
      handleSetBlock(player, message);
    }
  });

  ws.on("close", () => {
    const player = playersBySocket.get(ws);
    if (!player) return;

    playersBySocket.delete(ws);
    players.delete(player.id);
    broadcast({ type: "player_leave", id: player.id }, player.id);
    console.log(`Player left: ${player.name}#${player.id}`);
  });

  ws.on("error", () => {
    ws.close();
  });
});

setInterval(() => {
  if (players.size === 0) return;
  const dt = 1 / SERVER_TICK_RATE;
  for (const player of players.values()) {
    simulatePlayer(player, dt);
  }
  const snapshot = Array.from(players.values()).map(playerPublicState);
  broadcast({ type: "snapshot", players: snapshot });
}, SNAPSHOT_INTERVAL_MS);

wss.on("listening", () => {
  console.log(`Cubic multiplayer server running on ws://0.0.0.0:${PORT} (${SERVER_TICK_RATE} tick/s)`);
});

wss.on("error", (error) => {
  console.error(`Failed to start Cubic multiplayer server on port ${PORT}:`, error);
});
