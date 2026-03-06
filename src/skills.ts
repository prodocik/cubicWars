export interface Skill {
  id: string;
  name: string;
  icon: string;
  level: number; // 0..100
}

export class Skills {
  private skills: Map<string, Skill> = new Map();
  private overlay: HTMLDivElement;
  private isOpen = false;
  private contentEl: HTMLDivElement;

  constructor() {
    // Register default skills
    this.skills.set("lumberjack", {
      id: "lumberjack",
      name: "Лесоруб",
      icon: "🪓",
      level: 0,
    });

    this.skills.set("miner", {
      id: "miner",
      name: "Шахтёр",
      icon: "⛏️",
      level: 0,
    });

    // UI
    this.overlay = document.createElement("div");
    this.overlay.style.cssText =
      "position:fixed;display:none;z-index:9999;font-family:monospace;" +
      "left:50%;bottom:80px;transform:translateX(-50%)";

    const panel = document.createElement("div");
    panel.style.cssText =
      "background:#2a2a3e;border:3px solid #c8a840;border-radius:8px;padding:16px;position:relative;" +
      "box-shadow:0 8px 32px rgba(0,0,0,0.6);min-width:280px";

    // Title bar (draggable)
    const titleBar = document.createElement("div");
    titleBar.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;cursor:grab;user-select:none";

    let dragging = false;
    let dragX = 0, dragY = 0;
    titleBar.onmousedown = (e) => {
      dragging = true;
      titleBar.style.cursor = "grabbing";
      const rect = this.overlay.getBoundingClientRect();
      dragX = e.clientX - rect.left;
      dragY = e.clientY - rect.top;
      this.overlay.style.left = rect.left + "px";
      this.overlay.style.top = rect.top + "px";
      this.overlay.style.bottom = "";
      this.overlay.style.transform = "none";
      e.preventDefault();
    };
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      this.overlay.style.left = (e.clientX - dragX) + "px";
      this.overlay.style.top = (e.clientY - dragY) + "px";
    });
    window.addEventListener("mouseup", () => {
      if (dragging) { dragging = false; titleBar.style.cursor = "grab"; }
    });

    const title = document.createElement("div");
    title.textContent = "Скиллы";
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

    this.contentEl = document.createElement("div");
    panel.appendChild(this.contentEl);

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /** Export skill levels as { id: level } */
  exportData(): Record<string, number> {
    const data: Record<string, number> = {};
    for (const [id, skill] of this.skills) data[id] = skill.level;
    return data;
  }

  /** Import skill levels from { id: level } */
  importData(data: Record<string, number>) {
    for (const [id, level] of Object.entries(data)) {
      const skill = this.skills.get(id);
      if (skill) skill.level = level;
    }
    if (this.isOpen) this.render();
  }

  /** Add XP to a skill. XP needed increases geometrically: each level costs more. */
  addXp(id: string, amount: number) {
    const skill = this.skills.get(id);
    if (!skill) return;
    skill.level = Math.min(100, skill.level + amount);
    if (this.isOpen) this.render();
  }

  /** Get XP gain for a chop action. Higher level = less XP gain (geometric). */
  getChopXpGain(id: string): number {
    const skill = this.skills.get(id);
    if (!skill) return 0;
    // At level 0: +0.1, at level 50: ~0.02, at level 90: ~0.005
    return 0.1 * Math.pow(0.97, skill.level);
  }

  /** Chance to chop a tree (0..1). Level 0 = 30%, level 100 = 100%. */
  getChopChance(id: string): number {
    const skill = this.skills.get(id);
    if (!skill) return 0.3;
    return 0.3 + 0.7 * (skill.level / 100);
  }

  /** Logs yield per successful chop. Level 0 = 1, level 100 = 5-8. */
  getLogYield(id: string): number {
    const skill = this.skills.get(id);
    if (!skill) return 1;
    const lvl = skill.level / 100;
    const min = 1 + Math.floor(lvl * 4); // 1..5
    const max = 1 + Math.floor(lvl * 7); // 1..8
    return min + Math.floor(Math.random() * (max - min + 1));
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
    if (this.isOpen) this.close(); else this.open();
  }

  getIsOpen() { return this.isOpen; }

  private render() {
    this.contentEl.innerHTML = "";
    for (const skill of this.skills.values()) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #3a3a4e";

      const icon = document.createElement("span");
      icon.textContent = skill.icon;
      icon.style.fontSize = "22px";

      const info = document.createElement("div");
      info.style.cssText = "flex:1";

      const name = document.createElement("div");
      name.textContent = skill.name;
      name.style.cssText = "color:#fff;font-size:13px;font-weight:bold";

      const barBg = document.createElement("div");
      barBg.style.cssText =
        "width:100%;height:10px;background:#1a1a2e;border-radius:4px;margin-top:4px;overflow:hidden";

      const barFill = document.createElement("div");
      const pct = Math.min(100, skill.level);
      barFill.style.cssText =
        `width:${pct}%;height:100%;background:linear-gradient(90deg,#3a8040,#c8a840);border-radius:4px;transition:width 0.3s`;

      barBg.appendChild(barFill);

      const lvlText = document.createElement("div");
      lvlText.textContent = `${skill.level.toFixed(1)} / 100`;
      lvlText.style.cssText = "color:#888;font-size:10px;margin-top:2px";

      info.appendChild(name);
      info.appendChild(barBg);
      info.appendChild(lvlText);

      row.appendChild(icon);
      row.appendChild(info);
      this.contentEl.appendChild(row);
    }
  }
}
