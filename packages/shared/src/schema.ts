import { z } from "zod";

export const MEDIA_KINDS = ["photo", "video"] as const;
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const gameModeSchema = z.enum(["photos", "videos", "mixed"]);
export type GameMode = z.infer<typeof gameModeSchema>;

export const mediaItemSchema = z.object({
  id: z.string().min(1),
  kind: mediaKindSchema,
  url: z.string().min(1),
  thumbUrl: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

/** Item subido por el cliente: data URL base64 del archivo (y thumb opcional). */
export const uploadedItemSchema = z.object({
  kind: mediaKindSchema,
  data: z.string().min(1).max(27_000_000),
  thumbData: z.string().max(5_000_000).optional(),
});
export type UploadedItem = z.infer<typeof uploadedItemSchema>;

/** Límite de tamaño (bytes) por archivo subido por socket. */
export const MAX_UPLOAD_BYTES = 20_000_000;

/** Límite de tamaño total (bytes) para el almacén de medios en memoria. */
export const MAX_MEDIA_STORE_BYTES = 200_000_000; // 200 MB

/** Tamaño del pool privado por jugador según rondas y número de jugadores. */
export function poolSizeFor(rounds: number, players: number): number {
  return Math.max(3, Math.ceil(rounds / players) + 2);
}

export const playerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(20),
  avatar: z.string().min(1).max(32),
  isHost: z.boolean(),
  connected: z.boolean(),
  poolReady: z.boolean(),
  score: z.number().int(),
});
export type Player = z.infer<typeof playerSchema>;

/** Duración de revelado de cada ronda (envío también al cliente para countdown). */
export const ROUND_DURATION_MS = 5_000;

export const roomConfigSchema = z.object({
  mode: gameModeSchema,
  rounds: z.number().int().min(3).max(20),
  roundDurationMs: z.number().int().min(3_000).max(15_000).default(ROUND_DURATION_MS),
});
export type RoomConfig = z.infer<typeof roomConfigSchema>;

export const roomPhaseSchema = z.enum(["lobby", "pools", "playing", "results"]);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

export const roomStateSchema = z.object({
  code: z.string().min(4),
  hostId: z.string(),
  config: roomConfigSchema,
  phase: roomPhaseSchema,
  players: z.array(playerSchema),
  currentRound: z.number().int().nonnegative().optional(),
  totalRounds: z.number().int().positive().optional(),
});
export type RoomState = z.infer<typeof roomStateSchema>;
