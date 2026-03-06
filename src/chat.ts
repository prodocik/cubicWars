import * as ex from "excalibur";
import { Network } from "./network";

const BUBBLE_DURATION = 5; // seconds
const BUBBLE_FADE = 0.5; // fade out duration

export class ChatBubble extends ex.Actor {
  private timer = BUBBLE_DURATION;

  constructor(text: string) {
    super({
      pos: ex.vec(0, -52),
      anchor: ex.vec(0.5, 1),
    });

    const canvas = new ex.Canvas({
      width: 200,
      height: 60,
      cache: true,
      draw: (ctx) => {
        ctx.font = "10px monospace";
        const words = text.split(" ");
        const lines: string[] = [];
        let line = "";
        for (const word of words) {
          const test = line ? line + " " + word : word;
          if (ctx.measureText(test).width > 170) {
            lines.push(line);
            line = word;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);
        if (lines.length > 3) lines.length = 3;

        const lineHeight = 13;
        const padding = 8;
        const tailH = 6;
        const boxH = lines.length * lineHeight + padding * 2;
        let maxW = 0;
        for (const l of lines) {
          const w = ctx.measureText(l).width;
          if (w > maxW) maxW = w;
        }
        const boxW = maxW + padding * 2;
        const x = (200 - boxW) / 2;
        const y = 60 - boxH - tailH;
        const r = 6;

        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        roundRect(ctx, x + 2, y + 2, boxW, boxH, r);
        ctx.fill();

        // Bubble background
        ctx.fillStyle = "#fff";
        roundRect(ctx, x, y, boxW, boxH, r);
        ctx.fill();

        // Border
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, boxW, boxH, r);
        ctx.stroke();

        // Tail (triangle pointing down)
        const cx = 100;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(cx - 5, y + boxH);
        ctx.lineTo(cx, y + boxH + tailH);
        ctx.lineTo(cx + 5, y + boxH);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.beginPath();
        ctx.moveTo(cx - 5, y + boxH);
        ctx.lineTo(cx, y + boxH + tailH);
        ctx.lineTo(cx + 5, y + boxH);
        ctx.stroke();

        // Cover tail-border overlap
        ctx.fillStyle = "#fff";
        ctx.fillRect(cx - 4, y + boxH - 1, 8, 2);

        // Text
        ctx.fillStyle = "#1a1a2e";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], 100, y + padding + 10 + i * lineHeight);
        }
      },
    });

    this.graphics.use(canvas);
  }

  onPreUpdate(_engine: ex.Engine, delta: number) {
    const dt = delta / 1000;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.kill();
    } else if (this.timer < BUBBLE_FADE) {
      this.graphics.opacity = this.timer / BUBBLE_FADE;
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function showBubble(actor: ex.Actor, text: string) {
  // Remove old bubble if exists
  for (const child of actor.children) {
    if (child instanceof ChatBubble) child.kill();
  }
  const bubble = new ChatBubble(text);
  actor.addChild(bubble);
}

export function setupChatInput(net: Network, onSend: (text: string) => void) {
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;display:none;padding:12px;z-index:9999";

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 120;
  input.placeholder = "Введи сообщение...";
  input.style.cssText =
    "width:100%;box-sizing:border-box;padding:10px 16px;font:14px monospace;" +
    "border:2px solid #c8a840;background:rgba(26,26,46,0.9);color:#fff;" +
    "border-radius:8px;outline:none";

  container.appendChild(input);
  document.body.appendChild(container);

  let isOpen = false;

  function open() {
    isOpen = true;
    container.style.display = "block";
    input.value = "";
    input.focus();
  }

  function close() {
    isOpen = false;
    container.style.display = "none";
    input.blur();
  }

  function send() {
    const text = input.value.trim();
    if (text.length > 0) {
      net.send({ type: "chat", text });
      onSend(text);
    }
    close();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen) {
        send();
      } else {
        open();
      }
    } else if (e.key === "Escape" && isOpen) {
      close();
    }
  });

  // Prevent game input while typing
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
}
