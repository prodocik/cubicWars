export interface InventoryItem {
  id: string;
  name: string;
  color: string;
  icon: string; // emoji or short text
  iconUrl?: string; // optional PNG icon URL
  quantity: number;
}

export class Inventory {
  readonly size = 100; // 10x10
  readonly cols = 10;
  items: (InventoryItem | null)[] = new Array(this.size).fill(null);

  private overlay: HTMLDivElement;
  private isOpen = false;
  private cellEls: HTMLDivElement[] = [];
  onUse: ((item: InventoryItem, index: number) => void) | null = null;

  // Custom drag state
  private _dragItemId: string | null = null;
  private _dragGhost: HTMLDivElement | null = null;
  _dropTargets: { el: HTMLElement; onDrop: (itemId: string) => void }[] = [];

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.style.cssText =
      "position:fixed;display:none;z-index:9999;font-family:monospace;" +
      "left:50%;bottom:80px;transform:translateX(-50%)";

    const panel = document.createElement("div");
    panel.style.cssText =
      "background:#2a2a3e;border:3px solid #c8a840;border-radius:8px;padding:16px;position:relative;" +
      "box-shadow:0 8px 32px rgba(0,0,0,0.6)";

    // Title bar (draggable)
    const titleBar = document.createElement("div");
    titleBar.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;cursor:grab;user-select:none";

    // Drag logic
    let dragging = false;
    let dragX = 0, dragY = 0;
    titleBar.onmousedown = (e) => {
      dragging = true;
      titleBar.style.cursor = "grabbing";
      const rect = this.overlay.getBoundingClientRect();
      dragX = e.clientX - rect.left;
      dragY = e.clientY - rect.top;
      // Remove transform and set actual pixel position
      this.overlay.style.left = rect.left + "px";
      this.overlay.style.top = rect.top + "px";
      this.overlay.style.transform = "none";
      e.preventDefault();
    };
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      this.overlay.style.left = (e.clientX - dragX) + "px";
      this.overlay.style.top = (e.clientY - dragY) + "px";
    });
    window.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        titleBar.style.cursor = "grab";
      }
    });

    const title = document.createElement("div");
    title.textContent = "🗃 Сундук";
    title.style.cssText = "color:#c8a840;font-size:18px;font-weight:bold";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText =
      "width:32px;height:32px;border:2px solid #555;border-radius:6px;background:#3a3a4e;" +
      "color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "transition:all 0.15s";
    closeBtn.onmouseenter = () => { closeBtn.style.background = "#8b2020"; closeBtn.style.borderColor = "#a03030"; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = "#3a3a4e"; closeBtn.style.borderColor = "#555"; };
    closeBtn.onclick = () => this.close();

    titleBar.appendChild(title);
    titleBar.appendChild(closeBtn);
    panel.appendChild(titleBar);

    // Grid
    const grid = document.createElement("div");
    grid.style.cssText =
      `display:grid;grid-template-columns:repeat(${this.cols},1fr);gap:3px`;

    for (let i = 0; i < this.size; i++) {
      const cell = document.createElement("div");
      cell.style.cssText =
        "width:40px;height:40px;background:#1a1a2e;border:2px solid #3a3a4e;border-radius:4px;" +
        "display:flex;align-items:center;justify-content:center;font-size:18px;" +
        "cursor:pointer;transition:all 0.1s;user-select:none";
      cell.onmouseenter = () => {
        cell.style.borderColor = "#c8a840";
        cell.style.background = "#2a2a3e";
      };
      cell.onmouseleave = () => {
        cell.style.borderColor = "#3a3a4e";
        cell.style.background = "#1a1a2e";
      };
      cell.onclick = () => {
        const item = this.items[i];
        if (item && this.onUse) {
          this.onUse(item, i);
        }
      };
      // Drag support — custom mousedown drag
      cell.onmousedown = (e) => {
        const item = this.items[i];
        if (!item || e.button !== 0) return;
        e.preventDefault();
        this._startDrag(item.id, item.icon, e.clientX, e.clientY, item.iconUrl);
      };
      this.cellEls.push(cell);
      grid.appendChild(cell);
    }

    panel.appendChild(grid);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    // Escape to close
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });

    // Global drag handlers
    window.addEventListener("mousemove", (e) => {
      if (this._dragGhost) {
        this._dragGhost.style.left = (e.clientX + 12) + "px";
        this._dragGhost.style.top = (e.clientY - 12) + "px";
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (!this._dragItemId || !this._dragGhost) return;
      // Check if dropped on a target
      for (const t of this._dropTargets) {
        const r = t.el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          t.onDrop(this._dragItemId);
          break;
        }
      }
      this._dragGhost.remove();
      this._dragGhost = null;
      this._dragItemId = null;
    });
  }

  _startDrag(itemId: string, icon: string, x: number, y: number, iconUrl?: string) {
    this._dragItemId = itemId;
    const ghost = document.createElement("div");
    if (iconUrl) {
      ghost.innerHTML = `<img src="${iconUrl}" style="width:42px;height:42px;image-rendering:pixelated">`;
    } else {
      ghost.textContent = icon;
    }
    ghost.style.cssText =
      "position:fixed;pointer-events:none;z-index:99999;font-size:28px;" +
      "opacity:0.8;transform:translate(-50%,-50%)";
    ghost.style.left = (x + 12) + "px";
    ghost.style.top = (y - 12) + "px";
    document.body.appendChild(ghost);
    this._dragGhost = ghost;
  }

  open() {
    this.isOpen = true;
    this.render();
    this.overlay.style.left = "50%";
    this.overlay.style.top = "";
    this.overlay.style.bottom = "80px";
    this.overlay.style.transform = "translateX(-50%)";
    this.overlay.style.display = "block";
  }

  close() {
    this.isOpen = false;
    this.overlay.style.display = "none";
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  getIsOpen() { return this.isOpen; }

  /** Export items for saving */
  exportData(): (InventoryItem | null)[] {
    return this.items.map(i => i ? { ...i } : null);
  }

  /** Import items from saved data */
  importData(data: (InventoryItem | null)[]) {
    for (let i = 0; i < this.size; i++) {
      this.items[i] = data[i] ? { ...data[i]! } : null;
    }
    if (this.isOpen) this.render();
  }

  addItem(item: InventoryItem): boolean {
    // Stack with existing item of same id
    for (let i = 0; i < this.size; i++) {
      if (this.items[i]?.id === item.id) {
        this.items[i]!.quantity += item.quantity;
        if (this.isOpen) this.render();
        return true;
      }
    }
    const idx = this.items.indexOf(null);
    if (idx === -1) return false;
    this.items[idx] = { ...item };
    if (this.isOpen) this.render();
    return true;
  }

  useItem(index: number): boolean {
    const item = this.items[index];
    if (!item || item.quantity <= 0) return false;
    item.quantity--;
    if (item.quantity <= 0) {
      this.items[index] = null;
    }
    if (this.isOpen) this.render();
    return true;
  }

  /** Find inventory index of item by id */
  findItemIndex(id: string): number {
    for (let i = 0; i < this.size; i++) {
      if (this.items[i]?.id === id) return i;
    }
    return -1;
  }

  private render() {
    for (let i = 0; i < this.size; i++) {
      const item = this.items[i];
      const cell = this.cellEls[i];
      if (item) {
        const iconHtml = item.iconUrl
          ? `<img src="${item.iconUrl}" style="width:42px;height:42px;image-rendering:pixelated">`
          : `<span style="font-size:18px">${item.icon}</span>`;
        cell.innerHTML = iconHtml +
          (item.quantity > 1 ? `<span style="position:absolute;bottom:1px;right:3px;font-size:9px;color:#fff;text-shadow:0 0 2px #000">${item.quantity}</span>` : "");
        cell.style.position = "relative";
        cell.title = `${item.name} (${item.quantity})`;
      } else {
        cell.innerHTML = "";
        cell.title = "";
      }
    }
  }
}

// --- Hotbar: 10 quick-access slots (keys 1-9, 0) ---
export class Hotbar {
  readonly slotCount = 10;
  // Each slot stores an item id (reference to inventory) or null
  slots: (string | null)[] = new Array(this.slotCount).fill(null);
  private slotEls: HTMLDivElement[] = [];
  private container: HTMLDivElement;
  private inventory: Inventory;
  private selectedSlot: number | null = null;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.container = document.createElement("div");
    this.container.style.cssText =
      "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:4px;" +
      "z-index:9998;font-family:monospace";

    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

    for (let i = 0; i < this.slotCount; i++) {
      const slot = document.createElement("div");
      slot.style.cssText =
        "width:44px;height:44px;background:rgba(26,26,46,0.85);border:2px solid #3a3a4e;" +
        "border-radius:6px;display:flex;align-items:center;justify-content:center;" +
        "font-size:20px;cursor:pointer;position:relative;user-select:none;transition:all 0.1s";

      // Key label
      const keyLabel = document.createElement("span");
      keyLabel.textContent = keys[i];
      keyLabel.style.cssText =
        "position:absolute;top:1px;left:3px;font-size:8px;color:#888;pointer-events:none";
      slot.appendChild(keyLabel);

      slot.onmouseenter = () => { slot.style.borderColor = "#c8a840"; };
      slot.onmouseleave = () => {
        slot.style.borderColor = this.selectedSlot === i ? "#c8a840" : "#3a3a4e";
      };

      slot.onclick = () => this.onSlotClick(i);

      // Register as drop target for custom drag
      inventory._dropTargets.push({
        el: slot,
        onDrop: (itemId: string) => {
          if (this.inventory.findItemIndex(itemId) !== -1) {
            this.slots[i] = itemId;
            this.render();
          }
        },
      });

      this.slotEls.push(slot);
      this.container.appendChild(slot);
    }

    document.body.appendChild(this.container);

    // Keyboard: 1-9, 0 to use hotbar slot
    window.addEventListener("keydown", (e) => {
      // Don't trigger if typing in input
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const keyMap: Record<string, number> = {
        "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
        "6": 5, "7": 6, "8": 7, "9": 8, "0": 9,
      };
      const slotIdx = keyMap[e.key];
      if (slotIdx !== undefined) {
        this.activateSlot(slotIdx);
      }
    });

    // Listen for inventory clicks to assign items to selected hotbar slot
    const origOnUse = inventory.onUse;
    inventory.onUse = (item, index) => {
      if (this.selectedSlot !== null) {
        // Assign this item to the selected hotbar slot
        this.slots[this.selectedSlot] = item.id;
        this.deselectSlot();
        this.render();
        return;
      }
      if (origOnUse) origOnUse(item, index);
    };
  }

  /** Called when user set onUse after hotbar is created — rewrap it */
  wrapOnUse(callback: (item: InventoryItem, index: number) => void) {
    const self = this;
    this.inventory.onUse = (item, index) => {
      if (self.selectedSlot !== null) {
        self.slots[self.selectedSlot] = item.id;
        self.deselectSlot();
        self.render();
        return;
      }
      callback(item, index);
    };
  }

  private onSlotClick(slotIdx: number) {
    if (this.slots[slotIdx]) {
      // If slot has item and inventory is open and a slot is selected, clear it
      if (this.selectedSlot === slotIdx) {
        this.deselectSlot();
        return;
      }
      // Activate (use) the item
      this.activateSlot(slotIdx);
    } else {
      // Empty slot — select it to receive an item from inventory
      if (this.selectedSlot === slotIdx) {
        this.deselectSlot();
      } else {
        this.selectSlot(slotIdx);
      }
    }
  }

  private selectSlot(idx: number) {
    this.deselectSlot();
    this.selectedSlot = idx;
    this.slotEls[idx].style.borderColor = "#c8a840";
    this.slotEls[idx].style.background = "rgba(60,60,80,0.9)";
  }

  private deselectSlot() {
    if (this.selectedSlot !== null) {
      this.slotEls[this.selectedSlot].style.borderColor = "#3a3a4e";
      this.slotEls[this.selectedSlot].style.background = "rgba(26,26,46,0.85)";
      this.selectedSlot = null;
    }
  }

  activateSlot(slotIdx: number) {
    const itemId = this.slots[slotIdx];
    if (!itemId) return;
    const invIdx = this.inventory.findItemIndex(itemId);
    if (invIdx === -1) {
      // Item gone from inventory
      this.slots[slotIdx] = null;
      this.render();
      return;
    }
    const item = this.inventory.items[invIdx]!;
    if (this.inventory.onUse) {
      // Temporarily disable slot selection so onUse actually uses the item
      const saved = this.selectedSlot;
      this.selectedSlot = null;
      this.inventory.onUse(item, invIdx);
      this.selectedSlot = saved;
    }
    this.render();
  }

  render() {
    for (let i = 0; i < this.slotCount; i++) {
      const slot = this.slotEls[i];
      const itemId = this.slots[i];
      // Keep the key label (first child)
      const keyLabel = slot.children[0] as HTMLElement;

      // Remove everything except keyLabel
      while (slot.children.length > 1) slot.removeChild(slot.lastChild!);

      if (itemId) {
        const invIdx = this.inventory.findItemIndex(itemId);
        if (invIdx === -1) {
          this.slots[i] = null;
          continue;
        }
        const item = this.inventory.items[invIdx]!;
        if (item.iconUrl) {
          const img = document.createElement("img");
          img.src = item.iconUrl;
          img.style.cssText = "width:36px;height:36px;pointer-events:none;image-rendering:pixelated";
          slot.appendChild(img);
        } else {
          const icon = document.createElement("span");
          icon.textContent = item.icon;
          icon.style.cssText = "font-size:20px;pointer-events:none";
          slot.appendChild(icon);
        }

        if (item.quantity > 1) {
          const qty = document.createElement("span");
          qty.textContent = String(item.quantity);
          qty.style.cssText =
            "position:absolute;bottom:1px;right:3px;font-size:9px;color:#fff;" +
            "text-shadow:0 0 2px #000;pointer-events:none";
          slot.appendChild(qty);
        }
        slot.title = `${item.name} (${item.quantity})`;
      } else {
        slot.title = "";
      }

      // Restore key label visibility
      keyLabel.style.display = "";
    }
  }
}
