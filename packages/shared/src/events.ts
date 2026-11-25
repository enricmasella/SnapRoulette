import { z } from "zod";
import { mediaItemSchema, roomConfigSchema, uploadedItemSchema } from "./schema";

/** Nombres de eventos socket (cliente ↔ servidor). */
export const EV = {
  // client → server
  createRoom: "create_room",
  joinRoom: "join_room",
  startGame: "start_game",
  setRoundDuration: "set_round_duration",
  uploadItem: "upload_item",
  finishPool: "finish_pool",
  acceptPool: "accept_pool",
  guess: "guess",
  playAgain: "play_again",
  // server → client
  yourId: "your_id",
  roomState: "room_state",
  yourPool: "your_pool",
  roundStart: "round_start",
  youAreOwner: "you_are_owner",
  roundReveal: "round_reveal",
  gameResult: "game_result",
  error: "error",
} as const;

export const createRoomPayloadSchema = z.object({
  name: z.string().min(1).max(20),
  avatar: z.string().min(1),
  config: roomConfigSchema,
});
export type CreateRoomPayload = z.infer<typeof createRoomPayloadSchema>;

export const joinRoomPayloadSchema = z.object({
  code: z
    .string()
    .min(4)
    .max(8)
    .transform((value) => value.trim().toUpperCase()),
  name: z.string().min(1).max(20),
  avatar: z.string().min(1),
  playerId: z.string().optional(),
});
export type JoinRoomPayload = z.infer<typeof joinRoomPayloadSchema>;

export const setRoundDurationPayloadSchema = z.object({
  roundDurationMs: z.number().int().min(3_000).max(15_000),
});
export type SetRoundDurationPayload = z.infer<typeof setRoundDurationPayloadSchema>;

export const guessPayloadSchema = z.object({
  roundIndex: z.number().int().nonnegative(),
  guessedPlayerId: z.string().min(1),
});
export type GuessPayload = z.infer<typeof guessPayloadSchema>;

export const yourIdPayloadSchema = z.object({ playerId: z.string().min(1) });
export type YourIdPayload = z.infer<typeof yourIdPayloadSchema>;

export const yourPoolPayloadSchema = z.object({
  items: z.array(mediaItemSchema),
});
export type YourPoolPayload = z.infer<typeof yourPoolPayloadSchema>;

export const uploadItemPayloadSchema = z.object({
  index: z.number().int().min(0).max(11),
  item: uploadedItemSchema,
});
export type UploadItemPayload = z.infer<typeof uploadItemPayloadSchema>;

/** Respuesta al subir un archivo: progreso para el cliente. */
export type UploadItemAck =
  | { ok: true; received: number; required: number }
  | { ok: false; message: string };

/** Respuesta al cerrar el pool; el servidor emite `your_pool` después. */
export type FinishPoolAck = { ok: true } | { ok: false; message: string };

export const roundStartPayloadSchema = z.object({
  index: z.number().int().nonnegative(),
  totalRounds: z.number().int().positive(),
  item: mediaItemSchema,
  targetTs: z.number(),
  ownerId: z.string(),
});
export type RoundStartPayload = z.infer<typeof roundStartPayloadSchema>;

export const youAreOwnerPayloadSchema = z.object({
  index: z.number().int().nonnegative(),
});
export type YouAreOwnerPayload = z.infer<typeof youAreOwnerPayloadSchema>;

export const guessResultSchema = z.object({
  playerId: z.string(),
  playerName: z.string(),
  avatar: z.string(),
  guessedPlayerId: z.string(),
  correct: z.boolean(),
  points: z.number().int(),
});
export type GuessResult = z.infer<typeof guessResultSchema>;

export const roundRevealPayloadSchema = z.object({
  index: z.number().int().nonnegative(),
  ownerId: z.string(),
  ownerName: z.string(),
  ownerAvatar: z.string(),
  guesses: z.array(guessResultSchema),
  scores: z.array(
    z.object({
      playerId: z.string(),
      score: z.number().int(),
    }),
  ),
});
export type RoundRevealPayload = z.infer<typeof roundRevealPayloadSchema>;

export const gameResultPayloadSchema = z.object({
  standings: z.array(
    z.object({
      playerId: z.string(),
      name: z.string(),
      avatar: z.string(),
      score: z.number().int(),
    }),
  ),
  championId: z.string(),
});
export type GameResultPayload = z.infer<typeof gameResultPayloadSchema>;

export const errorPayloadSchema = z.object({ message: z.string() });
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

/** Payloads emitidos por el cliente (usados por el server para validar con zod). */
export const clientEventSchemas = {
  [EV.createRoom]: createRoomPayloadSchema,
  [EV.joinRoom]: joinRoomPayloadSchema,
  [EV.startGame]: z.object({}),
  [EV.setRoundDuration]: setRoundDurationPayloadSchema,
  [EV.uploadItem]: uploadItemPayloadSchema,
  [EV.finishPool]: z.object({}),
  [EV.acceptPool]: z.object({}),
  [EV.guess]: guessPayloadSchema,
  [EV.playAgain]: z.object({}),
} as const;
