import * as ex from "excalibur";
import { SKINS, drawCharacter } from "./skins";

const SPEED = 3; // tiles per second
const LABEL_FADE_SPEED = 3; // opacity per second
const LABEL_INITIAL_DURATION = 3; // seconds to show on spawn

const WALK_FRAME_DURATION = 80; // ms per frame
const WALK_FRAMES = [1, 2, 3, 4]; // walk cycle frame indices

const SPRITE_W = 16;
const SPRITE_H = 42; // extra height for tall hats
const DRAW_OFFSET_Y = 10; // shift drawing down to fit hat above

function createSpriteFrames(skinIndex: number): { idle: ex.Canvas; walkFrames: ex.Canvas[] } {
  const skin = SKINS[skinIndex] || SKINS[0];

  const idle = new ex.Canvas({
    width: SPRITE_W, height: SPRITE_H, cache: true,
    draw: (ctx) => { ctx.translate(0, DRAW_OFFSET_Y); drawCharacter(ctx, skin, 0); },
  });

  const walkCanvases = WALK_FRAMES.map((frame) =>
    new ex.Canvas({
      width: SPRITE_W, height: SPRITE_H, cache: true,
      draw: (ctx) => { ctx.translate(0, DRAW_OFFSET_Y); drawCharacter(ctx, skin, frame); },
    })
  );

  return { idle, walkFrames: walkCanvases };
}

class AnimatedSprite {
  private idle: ex.Canvas;
  private walkFrames: ex.Canvas[];
  private frameIndex = 0;
  private frameTimer = 0;
  private walking = false;
  private owner: ex.Actor;

  constructor(owner: ex.Actor, skinIndex: number) {
    this.owner = owner;
    const sprites = createSpriteFrames(skinIndex);
    this.idle = sprites.idle;
    this.walkFrames = sprites.walkFrames;
    owner.graphics.use(this.idle);
  }

  setWalking(walking: boolean) {
    if (walking === this.walking) return;
    this.walking = walking;
    if (!walking) {
      this.frameIndex = 0;
      this.frameTimer = 0;
      this.owner.graphics.use(this.idle);
    }
  }

  update(delta: number) {
    if (!this.walking) return;
    this.frameTimer += delta;
    if (this.frameTimer >= WALK_FRAME_DURATION) {
      this.frameTimer -= WALK_FRAME_DURATION;
      this.frameIndex = (this.frameIndex + 1) % this.walkFrames.length;
      this.owner.graphics.use(this.walkFrames[this.frameIndex]);
    }
  }
}

function createNameLabel(name: string): ex.Canvas {
  return new ex.Canvas({
    width: 120,
    height: 16,
    cache: true,
    draw: (ctx) => {
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const w = ctx.measureText(name).width + 8;
      ctx.fillRect((120 - w) / 2, 0, w, 14);
      ctx.fillStyle = "#fff";
      ctx.fillText(name, 60, 11);
    },
  });
}

class NameLabel extends ex.Actor {
  private targetOpacity = 1;
  private initialTimer = LABEL_INITIAL_DURATION;

  constructor(name: string) {
    super({
      pos: ex.vec(0, -46),
      anchor: ex.vec(0.5, 0.5),
    });
    this.graphics.use(createNameLabel(name));
    this.graphics.opacity = 1;
  }

  show() { this.targetOpacity = 1; }
  hide() { this.targetOpacity = 0; }

  onPreUpdate(_engine: ex.Engine, delta: number) {
    const dt = delta / 1000;

    // Initial show period
    if (this.initialTimer > 0) {
      this.initialTimer -= dt;
      if (this.initialTimer <= 0) {
        this.targetOpacity = 0;
      }
      return;
    }

    // Fade towards target
    const current = this.graphics.opacity;
    if (current < this.targetOpacity) {
      this.graphics.opacity = Math.min(this.targetOpacity, current + LABEL_FADE_SPEED * dt);
    } else if (current > this.targetOpacity) {
      this.graphics.opacity = Math.max(this.targetOpacity, current - LABEL_FADE_SPEED * dt);
    }
  }
}

function addHoverLabel(actor: ex.Actor, name: string): NameLabel {
  const label = new NameLabel(name);
  actor.addChild(label);

  actor.on("pointerenter", () => label.show());
  actor.on("pointerleave", () => label.hide());

  return label;
}

export class Player extends ex.Actor {
  tileX = 25;
  tileY = 25;
  tilePath: { x: number; y: number }[] = [];
  inputDx = 0;
  inputDy = 0;
  isoMap: ex.IsometricMap | null = null;
  playerName = "";
  skinIndex = 0;
  dead = false;
  // Server reconciliation: target position from server snapshots
  serverX = 25;
  serverY = 25;
  hasServerPos = false;
  /** Check if a float position is walkable (set from main.ts) */
  canWalkTo: (px: number, py: number) => boolean = () => true;
  private anim!: AnimatedSprite;

  constructor(skinIndex: number) {
    super({
      width: SPRITE_W,
      height: SPRITE_H,
      anchor: ex.vec(0.5, 1),
    });
    this.skinIndex = skinIndex;
    this.z = 50000;
  }

  onInitialize() {
    this.anim = new AnimatedSprite(this, this.skinIndex);
  }

  setDead(dead: boolean) {
    this.dead = dead;
    this.graphics.opacity = dead ? 0.5 : 1;
    this.rotation = dead ? Math.PI / 2 : 0;
    if (dead) this.anim.setWalking(false);
  }

  setName(name: string) {
    this.playerName = name;
    addHoverLabel(this, name);
  }

  setTilePath(path: { x: number; y: number }[]) {
    this.tilePath = path.slice(1);
  }

  updateWorldPos() {
    if (!this.isoMap) return;
    const wp = this.isoMap.tileToWorld(ex.vec(this.tileX, this.tileY));
    this.pos.x = Math.round(wp.x);
    this.pos.y = Math.round(wp.y + this.isoMap.tileHeight / 2);
    this.z = 50000 + Math.floor(this.tileX + this.tileY);
  }

  onPreUpdate(_engine: ex.Engine, delta: number) {
    const dt = delta / 1000;
    let isMoving = false;

    // WASD direct input takes priority
    if (this.inputDx !== 0 || this.inputDy !== 0) {
      let dx = this.inputDx;
      let dy = this.inputDy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) { dx /= len; dy /= len; }
      const newX = this.tileX + dx * SPEED * dt;
      const newY = this.tileY + dy * SPEED * dt;
      // Check walkability with wall sliding
      if (this.canWalkTo(newX, newY)) {
        this.tileX = newX;
        this.tileY = newY;
      } else {
        if (this.canWalkTo(newX, this.tileY)) {
          this.tileX = newX;
        }
        if (this.canWalkTo(this.tileX, newY)) {
          this.tileY = newY;
        }
      }
      isMoving = true;
    } else if (this.tilePath.length > 0) {
      // Click-to-move path
      const target = this.tilePath[0];
      const dx = target.x - this.tileX;
      const dy = target.y - this.tileY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = SPEED * dt;

      if (step >= dist) {
        this.tileX = target.x;
        this.tileY = target.y;
        this.tilePath.shift();
      } else {
        this.tileX += (dx / dist) * step;
        this.tileY += (dy / dist) * step;
      }
      isMoving = true;
    }

    // Server reconciliation — only when idle or huge drift
    if (this.hasServerPos) {
      const sdx = this.serverX - this.tileX;
      const sdy = this.serverY - this.tileY;
      const drift = Math.sqrt(sdx * sdx + sdy * sdy);

      if (drift > 3.0) {
        // Huge drift — snap
        this.tileX = this.serverX;
        this.tileY = this.serverY;
      } else if (!isMoving && drift > 0.05) {
        // Idle with small drift — smooth correction over ~200ms
        const t = Math.min(1, 5 * dt);
        this.tileX += sdx * t;
        this.tileY += sdy * t;
      }
    }

    this.anim.setWalking(isMoving && !this.dead);
    this.anim.update(delta);
    this.updateWorldPos();
  }
}

// Snapshot buffer entry for interpolation
interface PosSnapshot {
  x: number;
  y: number;
  time: number; // local timestamp when received
}

// Interpolation delay: render positions this many ms behind the latest snapshot.
// This gives us a buffer to smooth between snapshots even with jitter.
const INTERP_DELAY = 80; // ms — buffer for smooth interpolation at 20Hz snapshots

export class RemotePlayer extends ex.Actor {
  tileX = 25;
  tileY = 25;
  isoMap: ex.IsometricMap | null = null;
  playerId = "";
  playerName = "";
  dead = false;

  private skinIndex = 0;
  private anim!: AnimatedSprite;

  // Snapshot buffer for interpolation (newest last)
  private snapshots: PosSnapshot[] = [];

  // Fallback path-based movement (used when snapshot not yet available)
  remotePath: { x: number; y: number }[] = [];

  constructor(id: string, name: string, tileX: number, tileY: number, skinIndex: number) {
    super({
      width: SPRITE_W,
      height: SPRITE_H,
      anchor: ex.vec(0.5, 1),
    });
    this.playerId = id;
    this.playerName = name;
    this.skinIndex = skinIndex;
    this.tileX = tileX;
    this.tileY = tileY;
    this.z = 50000;

    addHoverLabel(this, name);
  }

  onInitialize() {
    this.anim = new AnimatedSprite(this, this.skinIndex);
  }

  setDead(dead: boolean) {
    this.dead = dead;
    this.graphics.opacity = dead ? 0.5 : 1;
    this.rotation = dead ? Math.PI / 2 : 0;
    if (dead) this.anim.setWalking(false);
  }

  /** Push a new authoritative position from server snapshot */
  pushSnapshot(x: number, y: number) {
    const now = performance.now();
    // If tab was backgrounded (large gap), snap to latest position immediately
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && now - last.time > 200) {
      // Tab was likely in background — reset buffer, snap to current pos
      this.snapshots = [];
      this.tileX = x;
      this.tileY = y;
    }
    this.snapshots.push({ x, y, time: now });
    // Keep only last 1000ms of snapshots
    const cutoff = now - 1000;
    while (this.snapshots.length > 2 && this.snapshots[0].time < cutoff) {
      this.snapshots.shift();
    }
  }

  setRemotePath(_startX: number, _startY: number, path: { x: number; y: number }[]) {
    // Position is now driven by server snapshots, path is only fallback
    this.remotePath = [...path];
  }

  updateWorldPos() {
    if (!this.isoMap) return;
    const wp = this.isoMap.tileToWorld(ex.vec(this.tileX, this.tileY));
    this.pos.x = Math.round(wp.x);
    this.pos.y = Math.round(wp.y + this.isoMap.tileHeight / 2);
    this.z = 50000 + Math.floor(this.tileX + this.tileY);
  }

  onPreUpdate(_engine: ex.Engine, delta: number) {
    const dt = delta / 1000;
    let isMoving = false;

    if (this.snapshots.length >= 2) {
      // Interpolation mode: render at (now - INTERP_DELAY) between two snapshots
      const renderTime = performance.now() - INTERP_DELAY;
      const snaps = this.snapshots;

      // Find the two snapshots to interpolate between
      let i = snaps.length - 1;
      while (i > 0 && snaps[i].time > renderTime) i--;

      if (i < snaps.length - 1) {
        const a = snaps[i];
        const b = snaps[i + 1];
        const range = b.time - a.time;
        const t = range > 0 ? Math.min(1, (renderTime - a.time) / range) : 1;
        const newX = a.x + (b.x - a.x) * t;
        const newY = a.y + (b.y - a.y) * t;
        isMoving = Math.abs(newX - this.tileX) > 0.001 || Math.abs(newY - this.tileY) > 0.001;
        this.tileX = newX;
        this.tileY = newY;
      } else {
        // Extrapolate from last two snapshots
        const a = snaps[snaps.length - 2];
        const b = snaps[snaps.length - 1];
        const range = b.time - a.time;
        if (range > 0) {
          const elapsed = renderTime - b.time;
          // Only extrapolate up to 100ms beyond last snapshot
          const extT = Math.min(elapsed / range, 1);
          const newX = b.x + (b.x - a.x) * extT;
          const newY = b.y + (b.y - a.y) * extT;
          isMoving = Math.abs(newX - this.tileX) > 0.001 || Math.abs(newY - this.tileY) > 0.001;
          this.tileX = newX;
          this.tileY = newY;
        }
      }
    } else if (this.remotePath.length > 0) {
      // Fallback: path-based movement
      isMoving = true;
      const target = this.remotePath[0];
      const dx = target.x - this.tileX;
      const dy = target.y - this.tileY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = SPEED * dt;

      if (step >= dist) {
        this.tileX = target.x;
        this.tileY = target.y;
        this.remotePath.shift();
      } else {
        this.tileX += (dx / dist) * step;
        this.tileY += (dy / dist) * step;
      }
    }

    this.anim.setWalking(isMoving && !this.dead);
    this.anim.update(delta);
    this.updateWorldPos();
  }
}
