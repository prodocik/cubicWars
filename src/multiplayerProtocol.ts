export const DEFAULT_SERVER_PORT = 3002;
export const SERVER_TICK_RATE = 20;

export interface RemotePlayerState {
  id: string;
  name: string;
  appearanceSeed: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  heldItemId: string;
}

export interface BlockEditState {
  x: number;
  y: number;
  z: number;
  block: number;
}

export interface JoinMessage {
  type: "join";
  name: string;
  appearanceSeed: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  heldItemId: string;
}

export interface PlayerStateMessage {
  type: "player_state";
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  heldItemId: string;
}

export interface SetBlockMessage {
  type: "set_block";
  x: number;
  y: number;
  z: number;
  block: number;
}

export interface InitMessage {
  type: "init";
  id: string;
  tickRate: number;
  players: RemotePlayerState[];
  blocks: BlockEditState[];
}

export interface PlayerJoinMessage {
  type: "player_join";
  player: RemotePlayerState;
}

export interface PlayerLeaveMessage {
  type: "player_leave";
  id: string;
}

export interface SnapshotMessage {
  type: "snapshot";
  players: RemotePlayerState[];
}

export interface SetBlockBroadcast {
  type: "set_block";
  by: string;
  x: number;
  y: number;
  z: number;
  block: number;
}

export type ClientMessage =
  | JoinMessage
  | PlayerStateMessage
  | SetBlockMessage;

export type ServerMessage =
  | InitMessage
  | PlayerJoinMessage
  | PlayerLeaveMessage
  | SnapshotMessage
  | SetBlockBroadcast;
