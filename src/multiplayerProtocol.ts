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

export interface ChatMessage {
  type: "chat";
  text: string;
}

export interface ShootArrowMessage {
  type: "shoot_arrow";
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
}

export interface HitPlayerMessage {
  type: "hit_player";
  targetId: string;
}

export interface StartVoteMessage {
  type: "start_vote";
}

export interface CastVoteMessage {
  type: "cast_vote";
  vote: "yes" | "no";
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

export interface ChatBroadcast {
  type: "chat";
  id: string;
  name: string;
  text: string;
}

export interface ShootArrowBroadcast {
  type: "shoot_arrow";
  id: string;
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
}

export interface DamageBroadcast {
  type: "damage";
  targetId: string;
  attackerId: string;
  hp: number;
}

export interface DeathBroadcast {
  type: "death";
  targetId: string;
  killerId: string;
}

export interface RespawnBroadcast {
  type: "respawn";
  targetId: string;
  x: number; y: number; z: number;
}

export interface VoteStartedBroadcast {
  type: "vote_started";
  initiator: string;
  duration: number;
  yes: number;
  no: number;
  total: number;
}

export interface VoteUpdateBroadcast {
  type: "vote_update";
  yes: number;
  no: number;
  total: number;
  timeLeft: number;
}

export interface VoteResultBroadcast {
  type: "vote_result";
  passed: boolean;
  yes: number;
  no: number;
}

export interface WorldResetBroadcast {
  type: "world_reset";
}

export type ClientMessage =
  | JoinMessage
  | PlayerStateMessage
  | SetBlockMessage
  | ChatMessage
  | ShootArrowMessage
  | HitPlayerMessage
  | StartVoteMessage
  | CastVoteMessage;

export type ServerMessage =
  | InitMessage
  | PlayerJoinMessage
  | PlayerLeaveMessage
  | SnapshotMessage
  | SetBlockBroadcast
  | ChatBroadcast
  | ShootArrowBroadcast
  | DamageBroadcast
  | DeathBroadcast
  | RespawnBroadcast
  | VoteStartedBroadcast
  | VoteUpdateBroadcast
  | VoteResultBroadcast
  | WorldResetBroadcast;
