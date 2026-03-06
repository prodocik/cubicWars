const MAX_MESSAGES = 10;

interface LogEntry {
  el: HTMLDivElement;
}

export class GameLog {
  private container: HTMLDivElement;
  private entries: LogEntry[] = [];

  constructor() {
    this.container = document.createElement("div");
    this.container.style.cssText =
      "position:fixed;bottom:70px;left:12px;width:320px;max-height:200px;" +
      "overflow-y:auto;pointer-events:none;z-index:9997;font-family:monospace;" +
      "display:flex;flex-direction:column;gap:2px;scrollbar-width:none";
    // Hide scrollbar
    this.container.style.setProperty("-ms-overflow-style", "none");
    document.body.appendChild(this.container);
  }

  add(text: string, color = "#ccc") {
    const el = document.createElement("div");
    el.style.cssText =
      `font-size:11px;color:${color};background:rgba(0,0,0,0.5);padding:3px 8px;` +
      "border-radius:4px;pointer-events:auto;max-width:100%;word-wrap:break-word";
    el.textContent = text;
    this.container.appendChild(el);
    this.entries.push({ el });

    // Remove oldest if over limit
    while (this.entries.length > MAX_MESSAGES) {
      const old = this.entries.shift()!;
      old.el.remove();
    }

    this.container.scrollTop = this.container.scrollHeight;
  }

  /** Add a chat message from a player */
  chat(name: string, text: string) {
    this.add(`[${name}]: ${text}`, "#fff");
  }

  /** System/game message */
  system(text: string) {
    this.add(text, "#aaa");
  }

  /** Success message */
  success(text: string) {
    this.add(text, "#4aff4a");
  }

  /** Warning/fail message */
  warn(text: string) {
    this.add(text, "#ffaa44");
  }

}
