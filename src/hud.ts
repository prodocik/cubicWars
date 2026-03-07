import * as THREE from "three";
import { MAX_CHAT_LENGTH, MAX_HP } from "./constants";
import { CHUNK_SIZE } from "./voxelWorld";
import type { VoxelWorld } from "./voxelWorld";
import { tileIndexForBlock } from "./items";
import type { HotbarItem } from "./items";

export interface HudElements {
  root: HTMLDivElement;
  coords: HTMLDivElement;
  chunk: HTMLDivElement;
  status: HTMLDivElement;
  hint: HTMLDivElement;
  hotbar: HTMLDivElement;
  chatWrap: HTMLDivElement;
  chatInput: HTMLInputElement;
  hpFill: HTMLDivElement;
  hpText: HTMLDivElement;
  deathOverlay: HTMLDivElement;
  deathTimer: HTMLDivElement;
  voteOverlay: HTMLDivElement;
  voteTitle: HTMLDivElement;
  voteCountdown: HTMLDivElement;
  voteCounts: HTMLDivElement;
  voteYesBtn: HTMLButtonElement;
  voteNoBtn: HTMLButtonElement;
  voteCancelBtn: HTMLButtonElement;
  voteStatus: HTMLDivElement;
}

export function createHud(): HudElements {
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;font-family:monospace;color:#fff";

  const crosshair = document.createElement("div");
  crosshair.style.cssText = "position:absolute;left:50%;top:50%;width:16px;height:16px;transform:translate(-50%,-50%)";
  crosshair.innerHTML = '<div style="position:absolute;left:7px;top:0;width:2px;height:16px;background:#fff"></div><div style="position:absolute;left:0;top:7px;width:16px;height:2px;background:#fff"></div>';

  const info = document.createElement("div");
  info.style.cssText = "position:absolute;top:12px;left:12px;display:flex;flex-direction:column;gap:4px;text-shadow:0 2px 6px rgba(0,0,0,0.75)";

  const coords = document.createElement("div");
  coords.style.cssText = "font-size:12px";

  const chunk = document.createElement("div");
  chunk.style.cssText = "font-size:12px;color:#d3f1d5";

  const status = document.createElement("div");
  status.style.cssText = "font-size:12px;color:#a8d8ff";

  const hint = document.createElement("div");
  hint.style.cssText = "position:absolute;left:50%;bottom:88px;transform:translateX(-50%);padding:6px 10px;border-radius:10px;background:rgba(0,0,0,0.38);font-size:12px;color:#deedde";
  hint.textContent = "WASD move, Space jump, I inventory, Enter chat, LMB mine, RMB place, 1-9 select";

  const hotbar = document.createElement("div");
  hotbar.style.cssText = "position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;pointer-events:none";

  const chatWrap = document.createElement("div");
  chatWrap.style.cssText = "position:absolute;left:50%;bottom:150px;transform:translateX(-50%);display:none;pointer-events:auto";

  const chatInput = document.createElement("input");
  chatInput.type = "text";
  chatInput.maxLength = MAX_CHAT_LENGTH;
  chatInput.placeholder = "Chat...";
  chatInput.autocomplete = "off";
  chatInput.style.cssText = [
    "width:min(70vw,420px)",
    "padding:10px 14px",
    "border-radius:12px",
    "border:1px solid rgba(255,255,255,0.18)",
    "background:rgba(10,14,18,0.92)",
    "box-shadow:0 10px 30px rgba(0,0,0,0.35)",
    "color:#fff",
    "font:14px monospace",
    "outline:none"
  ].join(";");
  chatWrap.appendChild(chatInput);

  const hpBar = document.createElement("div");
  hpBar.style.cssText = "position:absolute;top:80px;left:12px;width:160px;height:8px;background:rgba(0,0,0,0.5);border-radius:4px;overflow:hidden";
  const hpFill = document.createElement("div");
  hpFill.style.cssText = "width:100%;height:100%;background:#e64040;border-radius:4px;transition:width 0.2s";
  hpBar.appendChild(hpFill);

  const hpText = document.createElement("div");
  hpText.style.cssText = "position:absolute;top:66px;left:12px;font-size:11px;color:#ff8888;text-shadow:0 1px 3px rgba(0,0,0,0.8)";

  const deathOverlay = document.createElement("div");
  deathOverlay.style.cssText = "position:fixed;inset:0;display:none;z-index:100;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;flex-direction:column;gap:20px";
  const deathTitle = document.createElement("div");
  deathTitle.style.cssText = "font-size:48px;font-weight:bold;color:#e64040;font-family:monospace;text-shadow:0 4px 20px rgba(230,64,64,0.5)";
  deathTitle.textContent = "\u0412\u042B \u041F\u041E\u0413\u0418\u0411\u041B\u0418";
  const deathTimer = document.createElement("div");
  deathTimer.style.cssText = "font-size:22px;color:#ccc;font-family:monospace";
  deathOverlay.append(deathTitle, deathTimer);

  // Vote overlay
  const voteOverlay = document.createElement("div");
  voteOverlay.style.cssText = "position:fixed;inset:0;display:none;z-index:90;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;flex-direction:column;gap:16px;font-family:monospace;color:#fff;pointer-events:auto";

  const voteBox = document.createElement("div");
  voteBox.style.cssText = "padding:32px 40px;border-radius:18px;background:rgba(10,14,20,0.95);border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column;align-items:center;gap:14px;min-width:340px";

  const voteTitle = document.createElement("div");
  voteTitle.style.cssText = "font-size:22px;font-weight:bold;color:#f0d050";
  voteTitle.textContent = "Перегенерация мира";

  const voteCountdown = document.createElement("div");
  voteCountdown.style.cssText = "font-size:36px;font-weight:bold;color:#fff";

  const voteCounts = document.createElement("div");
  voteCounts.style.cssText = "font-size:16px;color:#b0c0d0;display:flex;gap:24px";

  const voteBtns = document.createElement("div");
  voteBtns.style.cssText = "display:flex;gap:16px;margin-top:4px";

  const btnStyle = "padding:12px 32px;border:none;border-radius:10px;font:600 16px monospace;cursor:pointer;color:#fff;min-width:100px";
  const voteYesBtn = document.createElement("button");
  voteYesBtn.textContent = "За";
  voteYesBtn.style.cssText = btnStyle + ";background:#4a9e4a";

  const voteNoBtn = document.createElement("button");
  voteNoBtn.textContent = "Против";
  voteNoBtn.style.cssText = btnStyle + ";background:#c04040";

  const voteCancelBtn = document.createElement("button");
  voteCancelBtn.textContent = "Отменить";
  voteCancelBtn.style.cssText = btnStyle + ";background:#666;display:none";

  voteBtns.append(voteYesBtn, voteNoBtn, voteCancelBtn);

  const voteStatus = document.createElement("div");
  voteStatus.style.cssText = "font-size:13px;color:#8898a8;margin-top:4px";

  voteBox.append(voteTitle, voteCountdown, voteCounts, voteBtns, voteStatus);
  voteOverlay.appendChild(voteBox);

  info.append(coords, chunk, status);
  root.append(crosshair, info, hint, hotbar, chatWrap, hpBar, hpText);

  return { root, coords, chunk, status, hint, hotbar, chatWrap, chatInput, hpFill, hpText, deathOverlay, deathTimer, voteOverlay, voteTitle, voteCountdown, voteCounts, voteYesBtn, voteNoBtn, voteCancelBtn, voteStatus };
}

export function renderHotbar(hud: HudElements, slots: (HotbarItem | null)[], selectedSlot: number, world: VoxelWorld, onOpenInventory?: () => void) {
  hud.hotbar.innerHTML = "";
  for (let i = 0; i < slots.length; i++) {
    const item = slots[i];
    const slot = document.createElement("div");
    slot.style.cssText = [
      "width:58px;height:58px;border-radius:10px;display:flex;align-items:center;justify-content:center;position:relative",
      i === selectedSlot ? "border:3px solid #f2d472;background:rgba(32,34,24,0.92)" : "border:2px solid rgba(255,255,255,0.2);background:rgba(10,14,18,0.7)"
    ].join(";");

    const key = document.createElement("span");
    key.textContent = String((i + 1) % 10);
    key.style.cssText = "position:absolute;top:3px;left:5px;font-size:9px;color:#9db0bc";
    slot.appendChild(key);

    if (item && item.kind === "block" && item.block !== undefined) {
      const icon = document.createElement("canvas");
      icon.width = 32;
      icon.height = 32;
      const ctx = icon.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const atlas = world.atlas.image as HTMLCanvasElement;
      const tile = tileIndexForBlock(item.block);
      ctx.drawImage(atlas, tile * 16, 0, 16, 16, 0, 0, 32, 32);
      slot.appendChild(icon);
    } else if (item) {
      const icon = document.createElement("div");
      icon.textContent = item.icon || "?";
      icon.style.cssText = "font-size:28px;line-height:1";
      slot.appendChild(icon);
    }

    hud.hotbar.appendChild(slot);
  }

  // Inventory button
  if (onOpenInventory) {
    const invBtn = document.createElement("div");
    invBtn.style.cssText = "width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.2);background:rgba(10,14,18,0.7);cursor:pointer;pointer-events:auto;margin-left:6px;transition:border-color 0.15s;position:relative";
    invBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b0b8c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M2 11h20"/><path d="M10 11v3h4v-3"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`;
    invBtn.title = "Инвентарь (I)";
    const invLabel = document.createElement("span");
    invLabel.textContent = "I";
    invLabel.style.cssText = "position:absolute;top:2px;left:4px;font-size:10px;color:#f2d472;font-weight:bold;text-shadow:0 0 2px rgba(0,0,0,0.8)";
    invBtn.appendChild(invLabel);
    invBtn.onmouseenter = () => { invBtn.style.borderColor = "#f2d472"; };
    invBtn.onmouseleave = () => { invBtn.style.borderColor = "rgba(255,255,255,0.2)"; };
    invBtn.onclick = onOpenInventory;
    hud.hotbar.appendChild(invBtn);
  }
}

export function updateHpBar(hud: HudElements, hp: number) {
  const pct = Math.max(0, Math.min(100, hp));
  hud.hpFill.style.width = `${pct}%`;
  hud.hpFill.style.background = pct > 50 ? "#4ae64a" : pct > 25 ? "#e6c040" : "#e64040";
  hud.hpText.textContent = `HP ${pct}/${MAX_HP}`;
}

export function updateHudInfo(
  hud: HudElements, playerPos: THREE.Vector3,
  debugColliders: boolean, connected: boolean, connecting: boolean,
  playerName: string, remoteCount: number, serverUrl: string, lastError: string
) {
  hud.coords.textContent = `XYZ ${playerPos.x.toFixed(1)} ${playerPos.y.toFixed(1)} ${playerPos.z.toFixed(1)}`;
  hud.chunk.textContent = `Chunk ${Math.floor(playerPos.x / CHUNK_SIZE)}, ${Math.floor(playerPos.z / CHUNK_SIZE)}${debugColliders ? " | debug hitbox" : ""}`;
  const serverLabel = connected
    ? `Online ${playerName} | players ${remoteCount + 1}`
    : connecting
      ? "Connecting..."
      : "Offline";
  const details = lastError && !connected ? ` | ${lastError}` : "";
  hud.status.textContent = `${serverLabel} | ${serverUrl.replace(/^wss?:\/\//, "")}${details}`;
}

export interface TitleScreenUi {
  overlay: HTMLDivElement;
  subtitle: HTMLDivElement;
  form: HTMLDivElement;
  nameInput: HTMLInputElement;
  serverInput: HTMLInputElement;
  button: HTMLButtonElement;
  regenButton: HTMLButtonElement;
  spawnButton: HTMLButtonElement;
  note: HTMLDivElement;
}

export function createTitleScreen(
  defaultServerUrl: string,
  onStart: (playerName: string, serverUrl: string) => void,
  requestPointerLock: () => void,
  onRegenerate?: () => void,
  onTeleportSpawn?: () => void
): TitleScreenUi {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at top,#284664 0%,#0b1118 62%);z-index:30;font-family:monospace;color:#fff";

  const box = document.createElement("div");
  box.style.cssText = "width:min(92vw,460px);padding:28px;border-radius:18px;background:rgba(7,11,16,0.78);border:1px solid rgba(255,255,255,0.14);box-shadow:0 20px 80px rgba(0,0,0,0.45)";

  const titleEl = document.createElement("div");
  titleEl.textContent = "Cubic";
  titleEl.style.cssText = "font-size:38px;font-weight:bold;letter-spacing:0.08em;margin-bottom:8px";

  const subtitle = document.createElement("div");
  subtitle.textContent = "Voxel multiplayer prototype: shared world, mining, placing, other players visible";
  subtitle.style.cssText = "font-size:13px;color:#c1d9f1;line-height:1.5;margin-bottom:18px";

  const form = document.createElement("div");
  form.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-bottom:16px";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.value = localStorage.getItem("cubic.playerName") || `Player${Math.floor(100 + Math.random() * 900)}`;
  nameInput.placeholder = "Player name";
  nameInput.style.cssText = "padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:rgba(12,18,24,0.8);color:#fff;font:14px monospace;outline:none";

  const serverInput = document.createElement("input");
  serverInput.type = "text";
  serverInput.value = localStorage.getItem("cubic.serverUrl") || defaultServerUrl;
  serverInput.placeholder = "ws://host:3002";
  serverInput.style.cssText = "padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:rgba(12,18,24,0.8);color:#fff;font:14px monospace;outline:none";

  const button = document.createElement("button");
  button.textContent = "Start Multiplayer";
  button.style.cssText = "padding:14px 18px;width:100%;border:none;border-radius:12px;background:linear-gradient(135deg,#5ab95f,#2d89c8);color:#fff;font:600 15px monospace;cursor:pointer";
  button.onclick = () => {
    onStart(nameInput.value.trim() || "Player", serverInput.value.trim());
    requestPointerLock();
  };

  const regenButton = document.createElement("button");
  regenButton.textContent = "Перегенерировать мир";
  regenButton.style.cssText = "padding:12px 18px;width:100%;border:none;border-radius:12px;background:linear-gradient(135deg,#c05030,#a03020);color:#fff;font:600 14px monospace;cursor:pointer;margin-top:6px;display:none";
  regenButton.onclick = () => {
    if (onRegenerate) onRegenerate();
    requestPointerLock();
  };

  const spawnButton = document.createElement("button");
  spawnButton.textContent = "Телепорт на спавн";
  spawnButton.style.cssText = "padding:12px 18px;width:100%;border:none;border-radius:12px;background:linear-gradient(135deg,#3070a0,#205080);color:#fff;font:600 14px monospace;cursor:pointer;margin-top:6px;display:none";
  spawnButton.onclick = () => {
    if (onTeleportSpawn) onTeleportSpawn();
    requestPointerLock();
  };

  const note = document.createElement("div");
  note.textContent = "\u0414\u0440\u0443\u0433\u0438\u0435 \u0438\u0433\u0440\u043E\u043A\u0438 \u0432\u0438\u0434\u043D\u044B \u043A\u0430\u043A 3D-\u0430\u0432\u0430\u0442\u0430\u0440\u044B. \u041B\u043E\u043C\u0430\u043D\u0438\u0435 \u0438 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0431\u043B\u043E\u043A\u043E\u0432 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u0441\u0435\u0440\u0432\u0435\u0440.";
  note.style.cssText = "margin-top:14px;font-size:11px;color:#9fb0bd";

  form.append(nameInput, serverInput);
  box.append(titleEl, subtitle, form, button, regenButton, spawnButton, note);
  overlay.appendChild(box);
  return { overlay, subtitle, form, nameInput, serverInput, button, regenButton, spawnButton, note };
}

export function updateTitleScreen(
  title: TitleScreenUi,
  chatOpen: boolean, pointerLocked: boolean,
  networkStarted: boolean, pageActive: boolean,
  connected: boolean, connecting: boolean,
  reconnectTimer: number, lastError: string
) {
  if (chatOpen) {
    title.overlay.style.display = "none";
    return;
  }

  if (pointerLocked) {
    title.overlay.style.display = "none";
    return;
  }

  if (!pageActive && networkStarted) {
    title.overlay.style.display = "none";
    return;
  }

  title.overlay.style.display = "flex";

  if (!networkStarted) {
    title.subtitle.textContent = "Voxel multiplayer prototype: shared world, mining, placing, other players visible";
    title.form.style.display = "flex";
    title.nameInput.disabled = false;
    title.serverInput.disabled = false;
    title.button.textContent = "Start Multiplayer";
    title.regenButton.style.display = "none";
    title.note.textContent = "\u0414\u0440\u0443\u0433\u0438\u0435 \u0438\u0433\u0440\u043E\u043A\u0438 \u0432\u0438\u0434\u043D\u044B \u043A\u0430\u043A 3D-\u0430\u0432\u0430\u0442\u0430\u0440\u044B. \u041B\u043E\u043C\u0430\u043D\u0438\u0435 \u0438 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0431\u043B\u043E\u043A\u043E\u0432 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u0441\u0435\u0440\u0432\u0435\u0440.";
    return;
  }

  title.form.style.display = "none";
  title.nameInput.disabled = true;
  title.serverInput.disabled = true;
  title.button.textContent = "Resume";
  title.regenButton.style.display = connected ? "block" : "none";
  title.spawnButton.style.display = connected ? "block" : "none";
  const reconnecting = connecting || Boolean(reconnectTimer);
  title.subtitle.textContent = connected
    ? "\u0421\u0435\u0441\u0441\u0438\u044F \u0430\u043A\u0442\u0438\u0432\u043D\u0430. \u041F\u043E\u0442\u0435\u0440\u044F \u0444\u043E\u043A\u0443\u0441\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0435\u0442 \u0442\u0435\u0431\u044F \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443."
    : reconnecting
      ? "\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438..."
      : "\u0421\u0435\u0441\u0441\u0438\u044F \u043D\u0435\u0430\u043A\u0442\u0438\u0432\u043D\u0430. \u041D\u0430\u0436\u043C\u0438 Resume, \u0447\u0442\u043E\u0431\u044B \u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u0432 \u0438\u0433\u0440\u0443.";
  title.note.textContent = lastError && !connected
    ? `\u0421\u0435\u0440\u0432\u0435\u0440: ${lastError}`
    : "\u0427\u0442\u043E\u0431\u044B \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0432\u0442\u043E\u0440\u043E\u0435 \u043E\u043A\u043D\u043E, \u043F\u0440\u043E\u0441\u0442\u043E \u043E\u0442\u043A\u0440\u043E\u0439 \u0435\u0449\u0451 \u043E\u0434\u043D\u0443 \u0432\u043A\u043B\u0430\u0434\u043A\u0443 \u0438\u043B\u0438 \u043E\u043A\u043D\u043E \u0438\u0433\u0440\u044B \u0438 \u0437\u0430\u043F\u0443\u0441\u0442\u0438 \u0435\u0433\u043E \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E.";
}
