import * as THREE from "three";
import { BlockId } from "./voxelWorld";
import type { VoxelWorld } from "./voxelWorld";

export interface HotbarItem {
  id: string;
  label: string;
  kind: "block" | "tool";
  block?: BlockId;
  icon?: string;
}

export const HOTBAR_SIZE = 9;

export const allItems: HotbarItem[] = [
  { id: "grass", label: "Трава", kind: "block", block: BlockId.Grass },
  { id: "dirt", label: "Земля", kind: "block", block: BlockId.Dirt },
  { id: "stone", label: "Камень", kind: "block", block: BlockId.Stone },
  { id: "log", label: "Дерево", kind: "block", block: BlockId.Log },
  { id: "leaves", label: "Листва", kind: "block", block: BlockId.Leaves },
  { id: "sand", label: "Песок", kind: "block", block: BlockId.Sand },
  { id: "snow", label: "Снег", kind: "block", block: BlockId.Snow },
  { id: "cactus", label: "Кактус", kind: "block", block: BlockId.Cactus },
  { id: "axe", label: "Топор", kind: "tool", icon: "\u{1FA93}" },
  { id: "pickaxe", label: "Кирка", kind: "tool", icon: "\u26CF\uFE0F" },
  { id: "bow", label: "Лук", kind: "tool", icon: "\u{1F3F9}" },
];

export function getItemById(id: string): HotbarItem | undefined {
  return allItems.find(item => item.id === id);
}

const defaultHotbarIds = ["grass", "dirt", "stone", "log", "leaves", "axe", "pickaxe", "bow", "sand"];

export function loadHotbar(): (HotbarItem | null)[] {
  const slots: (HotbarItem | null)[] = new Array(HOTBAR_SIZE).fill(null);
  const saved = localStorage.getItem("cubic.hotbar");
  if (saved) {
    try {
      const ids = JSON.parse(saved) as (string | null)[];
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        slots[i] = ids[i] ? getItemById(ids[i]!) ?? null : null;
      }
      return slots;
    } catch { /* ignore */ }
  }
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    slots[i] = getItemById(defaultHotbarIds[i]) ?? null;
  }
  return slots;
}

export function saveHotbar(slots: (HotbarItem | null)[]) {
  const ids = slots.map(s => s?.id ?? null);
  localStorage.setItem("cubic.hotbar", JSON.stringify(ids));
}

// Kept for backward compat — points to the live hotbar
export let hotbarItems: (HotbarItem | null)[] = loadHotbar();

export function heldItemTokenForItem(item: HotbarItem) {
  if (item.kind === "block" && item.block !== undefined) {
    return `block:${item.block}`;
  }
  return item.id;
}

export function createHeldMeshFromToken(token: string, world: VoxelWorld) {
  let mesh: THREE.Object3D;
  if (token.startsWith("block:")) {
    const block = Number(token.slice(6)) as BlockId;
    mesh = world.createBlockPreview(block);
    mesh.rotation.set(0.35, 0.65, 0);
    mesh.position.set(0.1, -0.1, 0);
    return mesh;
  }

  if (token === "axe") {
    mesh = createAxeMesh();
  } else if (token === "pickaxe") {
    mesh = createPickaxeMesh();
  } else {
    mesh = createBowMesh();
  }
  return mesh;
}

export function createAxeMesh() {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.75, 0.09), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
  handle.rotation.z = -0.35;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.12), new THREE.MeshLambertMaterial({ color: 0xc4c9d1 }));
  head.position.set(0.12, 0.28, 0);
  head.rotation.z = 0.2;
  group.add(handle, head);
  group.rotation.set(0.4, 0.85, 0.2);
  return group;
}

export function createPickaxeMesh() {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, 0.09), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
  handle.rotation.z = -0.22;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0xc4c9d1 }));
  head.position.set(0.02, 0.28, 0);
  head.rotation.z = 0.2;
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.1), new THREE.MeshLambertMaterial({ color: 0xc4c9d1 }));
  tip.position.set(0.22, 0.28, 0);
  tip.rotation.z = 0.55;
  group.add(handle, head, tip);
  group.rotation.set(0.4, 0.95, 0.15);
  return group;
}

export function createBowMesh() {
  const group = new THREE.Group();
  const bowMat = new THREE.MeshLambertMaterial({ color: 0x7b542c });
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xe7e1c8 });
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), bowMat);
  left.position.set(-0.1, 0.05, 0);
  left.rotation.z = 0.4;
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), bowMat);
  right.position.set(0.1, 0.05, 0);
  right.rotation.z = -0.4;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.09), bowMat);
  const string = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.95, 0.01), stringMat);
  string.position.set(0, 0.03, -0.04);
  group.add(left, right, grip, string);
  group.rotation.set(0.5, 1.05, 0.25);
  return group;
}

export function createArrowMesh() {
  const group = new THREE.Group();
  const shaftMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
  const tipMat = new THREE.MeshLambertMaterial({ color: 0xaab0b8 });
  const fletchMat = new THREE.MeshLambertMaterial({ color: 0xd4d0c8 });

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), shaftMat);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.18), tipMat);
  tip.position.z = 0.55;
  const fletch1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.2), fletchMat);
  fletch1.position.z = -0.4;
  const fletch2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.2), fletchMat);
  fletch2.position.z = -0.4;

  group.add(shaft, tip, fletch1, fletch2);
  return group;
}

export function tileIndexForBlock(block: BlockId) {
  if (block === BlockId.Grass) return 0;
  if (block === BlockId.Dirt) return 2;
  if (block === BlockId.Stone) return 3;
  if (block === BlockId.Log) return 4;
  if (block === BlockId.Leaves) return 6;
  if (block === BlockId.Sand) return 8;
  if (block === BlockId.Snow) return 10;
  if (block === BlockId.Cactus) return 12;
  return 3;
}
