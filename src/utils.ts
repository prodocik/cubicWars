import * as THREE from "three";

const tempHsl = { h: 0, s: 0, l: 0 };

export function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const withGeometry = child as { geometry?: THREE.BufferGeometry };
    if (withGeometry.geometry) withGeometry.geometry.dispose();
    const material = (child as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        const textured = entry as THREE.Material & { map?: THREE.Texture | null };
        textured.map?.dispose();
        entry.dispose();
      });
    } else if (material) {
      const textured = material as THREE.Material & { map?: THREE.Texture | null };
      textured.map?.dispose();
      material.dispose();
    }
  });
}

export function lerpAngle(from: number, to: number, t: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

export function shiftColor(hex: number, lightnessScale: number) {
  const color = new THREE.Color(hex);
  color.getHSL(tempHsl);
  color.setHSL(tempHsl.h, tempHsl.s, Math.max(0, Math.min(1, tempHsl.l * lightnessScale)));
  return color.getHex();
}

export function createSeededRandom(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createAppearanceSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return Math.max(1, values[0] & 0x7fffffff);
}

export function createAvatarPalette(seed: number) {
  const random = createSeededRandom(seed);

  const shirt = new THREE.Color();
  shirt.setHSL(random(), 0.55 + random() * 0.22, 0.43 + random() * 0.16);

  const pants = new THREE.Color();
  pants.setHSL(0.52 + random() * 0.18, 0.28 + random() * 0.24, 0.23 + random() * 0.16);

  const hair = new THREE.Color();
  hair.setHSL(0.05 + random() * 0.08, 0.16 + random() * 0.24, 0.08 + random() * 0.24);

  const skin = new THREE.Color();
  skin.setHSL(0.05 + random() * 0.05, 0.45 + random() * 0.18, 0.6 + random() * 0.18);

  return {
    shirt: shirt.getHex(),
    shirtAccent: shiftColor(shirt.getHex(), 1.22),
    sleeve: shiftColor(shirt.getHex(), 0.82),
    pants: pants.getHex(),
    shoes: shiftColor(pants.getHex(), 0.5),
    skin: skin.getHex(),
    hair: hair.getHex(),
  };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export function wrapChatText(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const chunks = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, "g")) || [word] : [word];
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      current = chunk;
      if (lines.length >= maxLines - 1) break;
    }
    if (lines.length >= maxLines - 1) break;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === 0) {
    lines.push(text.slice(0, maxChars));
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  const lastIndex = lines.length - 1;
  if (lastIndex >= 0 && text.length > lines.join(" ").length) {
    lines[lastIndex] = lines[lastIndex].slice(0, Math.max(0, maxChars - 1)) + "\u2026";
  }

  return lines;
}

export function isTypingInUi(target: EventTarget | null) {
  const element = target instanceof Element ? target : document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}
