import type {
  CreateRoomPayload,
  ErrorPayload,
  FinishPoolAck,
  GameResultPayload,
  GuessPayload,
  JoinRoomPayload,
  RoundRevealPayload,
  RoundStartPayload,
  SetRoundDurationPayload,
  UploadItemAck,
  UploadItemPayload,
  YouAreOwnerPayload,
  YourIdPayload,
  YourPoolPayload,
} from "./events.js";
import type { RoomState } from "./schema.js";

/** Eventos emitidos por el cliente → escuchados por el servidor. */
export interface ClientToServerEvents {
  create_room: (payload: CreateRoomPayload) => void;
  join_room: (payload: JoinRoomPayload) => void;
  start_game: () => void;
  set_round_duration: (payload: SetRoundDurationPayload) => void;
  upload_item: (payload: UploadItemPayload, ack?: (result: UploadItemAck) => void) => void;
  finish_pool: (ack?: (result: FinishPoolAck) => void) => void;
  accept_pool: () => void;
  guess: (payload: GuessPayload) => void;
  play_again: () => void;
}

/** Eventos emitidos por el servidor → escuchados por el cliente. */
export interface ServerToClientEvents {
  your_id: (payload: YourIdPayload) => void;
  room_state: (payload: RoomState) => void;
  your_pool: (payload: YourPoolPayload) => void;
  round_start: (payload: RoundStartPayload) => void;
  you_are_owner: (payload: YouAreOwnerPayload) => void;
  round_reveal: (payload: RoundRevealPayload) => void;
  game_result: (payload: GameResultPayload) => void;
  error: (payload: ErrorPayload) => void;
}
