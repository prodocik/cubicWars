type MessageHandler = (msg: any) => void;
type StatusHandler = (online: boolean) => void;

export class Network {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, MessageHandler[]>();
  private statusHandlers: StatusHandler[] = [];
  private queue: object[] = [];
  private url = "";
  private playerName = "";
  private skinIndex = 0;
  myId = "";
  online = false;
  serverTickRate = 20;

  connect(url: string, playerName: string, skinIndex: number) {
    this.url = url;
    this.playerName = playerName;
    this.skinIndex = skinIndex;
    this._connect();
  }

  private _connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.setOnline(true);
      this.ws!.send(JSON.stringify({ type: "join", name: this.playerName, skinIndex: this.skinIndex }));
      for (const msg of this.queue) {
        this.ws!.send(JSON.stringify(msg));
      }
      this.queue = [];
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "init" && msg.tickRate) {
          this.serverTickRate = msg.tickRate;
        }
        const handlers = this.handlers.get(msg.type);
        if (handlers) handlers.forEach((h) => h(msg));
      } catch {}
    };

    this.ws.onclose = () => {
      this.setOnline(false);
      setTimeout(() => this._connect(), 2000);
    };

    this.ws.onerror = () => {
      this.setOnline(false);
    };
  }

  private setOnline(value: boolean) {
    if (this.online !== value) {
      this.online = value;
      this.statusHandlers.forEach((h) => h(value));
    }
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.push(handler);
  }
}
