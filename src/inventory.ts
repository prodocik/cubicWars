import { allItems, HOTBAR_SIZE, saveHotbar, tileIndexForBlock } from "./items";
import type { HotbarItem } from "./items";
import type { VoxelWorld } from "./voxelWorld";

let overlayEl: HTMLDivElement | null = null;
let isOpen = false;
let hotbarSlots: (HotbarItem | null)[] = [];
let selectedSlotRef = { value: 0 };
let worldRef: VoxelWorld | null = null;
let onChangeCallback: (() => void) | null = null;

// Drag state
let dragItem: HotbarItem | null = null;
let dragSource: { type: "hotbar" | "inventory"; index: number } | null = null;
let ghostEl: HTMLDivElement | null = null;

export function initInventory(
  slots: (HotbarItem | null)[],
  selected: { value: number },
  world: VoxelWorld,
  onChange: () => void
) {
  hotbarSlots = slots;
  selectedSlotRef = selected;
  worldRef = world;
  onChangeCallback = onChange;
}

export function createInventoryOverlay(): HTMLDivElement {
  overlayEl = document.createElement("div");
  overlayEl.style.cssText = "position:fixed;inset:0;display:none;z-index:80;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;font-family:monospace;color:#fff;pointer-events:auto";
  overlayEl.addEventListener("mousedown", (e) => {
    if (e.target === overlayEl) closeInventory();
  });
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
  return overlayEl;
}

export function isInventoryOpen() { return isOpen; }

export function openInventory() {
  if (!overlayEl) return;
  isOpen = true;
  overlayEl.style.display = "flex";
  document.exitPointerLock();
  rebuildContent();
}

export function closeInventory() {
  if (!overlayEl) return;
  isOpen = false;
  overlayEl.style.display = "none";
  cleanupDrag();
}

export function toggleInventory() {
  if (isOpen) closeInventory();
  else openInventory();
}

function rebuildContent() {
  if (!overlayEl || !worldRef) return;
  overlayEl.innerHTML = "";

  const container = document.createElement("div");
  container.style.cssText = "padding:24px 28px;border-radius:16px;background:rgba(10,14,20,0.96);border:1px solid rgba(255,255,255,0.12);box-shadow:0 20px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:14px;align-items:center";

  // Title
  const title = document.createElement("div");
  title.textContent = "Инвентарь";
  title.style.cssText = "font-size:20px;font-weight:bold;color:#e0d8c0";
  container.appendChild(title);

  // All items label
  const gridLabel = document.createElement("div");
  gridLabel.textContent = "Предметы";
  gridLabel.style.cssText = "font-size:12px;color:#8898a8;align-self:flex-start";
  container.appendChild(gridLabel);

  // Items grid
  const cols = Math.min(6, allItems.length);
  const grid = document.createElement("div");
  grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},58px);gap:6px`;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const cell = createSlotElement(item, worldRef, false, false);
    cell.title = item.label;
    cell.addEventListener("mousedown", (e) => startDrag(e, item, "inventory", i));
    // Double click to quickly add to first empty hotbar slot
    cell.addEventListener("dblclick", () => {
      const emptyIdx = hotbarSlots.indexOf(null);
      // Also check if already in hotbar
      const existIdx = hotbarSlots.findIndex(s => s?.id === item.id);
      if (existIdx !== -1) return; // already in hotbar
      if (emptyIdx !== -1) {
        hotbarSlots[emptyIdx] = item;
        saveHotbar(hotbarSlots);
        if (onChangeCallback) onChangeCallback();
        rebuildContent();
      }
    });
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  // Separator
  const sep = document.createElement("div");
  sep.style.cssText = "width:100%;height:1px;background:rgba(255,255,255,0.1);margin:2px 0";
  container.appendChild(sep);

  // Hotbar label
  const hotbarLabel = document.createElement("div");
  hotbarLabel.textContent = "Панель быстрого доступа";
  hotbarLabel.style.cssText = "font-size:12px;color:#8898a8;align-self:flex-start";
  container.appendChild(hotbarLabel);

  // Hotbar row
  const hotbarRow = document.createElement("div");
  hotbarRow.style.cssText = "display:flex;gap:6px";

  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const item = hotbarSlots[i];
    const isSelected = i === selectedSlotRef.value;
    const cell = createSlotElement(item, worldRef, true, isSelected);
    cell.dataset.hotbarIndex = String(i);

    // Key number
    const keyNum = document.createElement("span");
    keyNum.textContent = String((i + 1) % 10);
    keyNum.style.cssText = "position:absolute;top:2px;left:4px;font-size:9px;color:#9db0bc;pointer-events:none";
    cell.appendChild(keyNum);

    if (item) {
      cell.addEventListener("mousedown", (e) => startDrag(e, item, "hotbar", i));
    }

    // Drop highlight
    cell.addEventListener("mouseenter", () => {
      if (dragItem) cell.style.borderColor = "#80c060";
    });
    cell.addEventListener("mouseleave", () => {
      if (dragItem) cell.style.borderColor = isSelected ? "#f2d472" : "rgba(255,255,255,0.2)";
    });

    hotbarRow.appendChild(cell);
  }
  container.appendChild(hotbarRow);

  // Hint
  const hint = document.createElement("div");
  hint.textContent = "Перетащите предметы в панель быстрого доступа. Двойной клик — быстро добавить.";
  hint.style.cssText = "font-size:11px;color:#667080;margin-top:2px";
  container.appendChild(hint);

  overlayEl.appendChild(container);
}

function createSlotElement(item: HotbarItem | null, world: VoxelWorld, isHotbarSlot: boolean, isSelected: boolean): HTMLDivElement {
  const cell = document.createElement("div");
  const borderStyle = isHotbarSlot
    ? (isSelected ? "3px solid #f2d472" : "2px solid rgba(255,255,255,0.2)")
    : "2px solid rgba(255,255,255,0.15)";
  const bg = isHotbarSlot && isSelected ? "rgba(32,34,24,0.92)" : "rgba(10,14,18,0.7)";
  cell.style.cssText = `width:58px;height:58px;border-radius:10px;display:flex;align-items:center;justify-content:center;position:relative;border:${borderStyle};background:${bg};cursor:${item ? "grab" : "default"};user-select:none`;

  if (!item) return cell;

  if (item.kind === "block" && item.block !== undefined) {
    const icon = document.createElement("canvas");
    icon.width = 32;
    icon.height = 32;
    icon.style.cssText = "pointer-events:none";
    const ctx = icon.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const atlas = world.atlas.image as HTMLCanvasElement;
    const tile = tileIndexForBlock(item.block);
    ctx.drawImage(atlas, tile * 16, 0, 16, 16, 0, 0, 32, 32);
    cell.appendChild(icon);
  } else {
    const icon = document.createElement("div");
    icon.textContent = item.icon || "?";
    icon.style.cssText = "font-size:28px;line-height:1;pointer-events:none";
    cell.appendChild(icon);
  }

  return cell;
}

function startDrag(e: MouseEvent, item: HotbarItem, type: "hotbar" | "inventory", index: number) {
  if (e.button !== 0) return;
  e.preventDefault();
  dragItem = item;
  dragSource = { type, index };

  ghostEl = document.createElement("div");
  ghostEl.style.cssText = "position:fixed;pointer-events:none;z-index:200;opacity:0.85;transform:translate(-50%,-50%)";
  ghostEl.style.left = e.clientX + "px";
  ghostEl.style.top = e.clientY + "px";

  if (worldRef && item.kind === "block" && item.block !== undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const atlas = worldRef.atlas.image as HTMLCanvasElement;
    const tile = tileIndexForBlock(item.block);
    ctx.drawImage(atlas, tile * 16, 0, 16, 16, 0, 0, 32, 32);
    ghostEl.appendChild(canvas);
  } else {
    ghostEl.textContent = item.icon || "?";
    ghostEl.style.fontSize = "28px";
  }

  document.body.appendChild(ghostEl);
}

function onDragMove(e: MouseEvent) {
  if (!ghostEl) return;
  ghostEl.style.left = e.clientX + "px";
  ghostEl.style.top = e.clientY + "px";
}

function onDragEnd(e: MouseEvent) {
  if (!dragItem || !dragSource) {
    cleanupDrag();
    return;
  }

  // Find hotbar slot under cursor
  const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  const slotEl = target?.closest("[data-hotbar-index]") as HTMLElement | null;

  if (slotEl) {
    const targetIndex = Number(slotEl.dataset.hotbarIndex);

    if (dragSource.type === "inventory") {
      hotbarSlots[targetIndex] = dragItem;
    } else if (dragSource.type === "hotbar") {
      // Swap hotbar slots
      const srcItem = hotbarSlots[dragSource.index];
      hotbarSlots[dragSource.index] = hotbarSlots[targetIndex];
      hotbarSlots[targetIndex] = srcItem;
    }

    saveHotbar(hotbarSlots);
    if (onChangeCallback) onChangeCallback();
    rebuildContent();
  } else if (dragSource.type === "hotbar") {
    // Dragged out of hotbar — remove from slot
    hotbarSlots[dragSource.index] = null;
    saveHotbar(hotbarSlots);
    if (onChangeCallback) onChangeCallback();
    rebuildContent();
  }

  cleanupDrag();
}

function cleanupDrag() {
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }
  dragItem = null;
  dragSource = null;
}
