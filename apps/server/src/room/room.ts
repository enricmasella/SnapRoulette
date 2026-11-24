import { randomUUID } from "node:crypto";

import {
  type CreateRoomPayload,
  type GameResultPayload,
  type GuessPayload,
  type JoinRoomPayload,
  MAX_UPLOAD_BYTES,
  type MediaItem,
  type Player,
  type RoomConfig,
  type RoomPhase,
  type RoomState,
  type RoundRevealPayload,
  type SetRoundDurationPayload,
  type UploadItemPayload,
  type UploadedItem,
  poolSizeFor,
} from "@snaproulette/shared";
import type { ClientToServerEvents, ServerToClientEvents } from "@snaproulette/shared";
import type { Socket } from "socket.io";
import type { Server } from "socket.io";

import { OWNER_BONUS, type RoundItem, buildRounds, scoreFor } from "../game/logic.js";
import { detectMediaType, getMimeType } from "../media/sniff.js";
import type { MediaStore } from "../media/store.js";
import { randomInt } from "../util/random.js";

export class RoomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomError";
  }
}

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface ServerPlayer extends Player {
  socketId: string;
  pool: MediaItem[] | null;
  /** Pool en construcción: una posición por archivo, con huecos hasta completarlo. */
  poolDraft: (MediaItem | null)[];
}

interface GuessEntry {
  guessedId: string;
  points: number;
}

interface Room {
  code: string;
  hostId: string;
  config: RoomConfig;
  phase: RoomPhase;
  players: Map<string, ServerPlayer>;
  rounds: RoundItem[];
  roundIndex: number;
  roundTargetTs: number;
  roundGuesses: Map<string, GuessEntry>;
  roundTimer: NodeJS.Timeout | null;
  gapTimer: NodeJS.Timeout | null;
}

const MAX_PLAYERS = 10;
const MAX_ROOMS = 100;
const ROUND_GAP_MS = 3_000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

function toPublicPlayer(player: ServerPlayer): Player {
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    isHost: player.isHost,
    connected: player.connected,
    poolReady: player.poolReady,
    score: player.score,
  };
}

/**
 * Gestor de salas y máquina de estados del juego:
 * lobby → pools → playing → results. Autoridad total en el servidor;
 * el cliente solo muestra y envía intenciones.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** socket.id → código de sala. Impide que un socket ocupe varias salas. */
  private readonly socketRoom = new Map<string, string>();

  constructor(
    private readonly io: GameServer,
    private readonly store: MediaStore,
  ) {}

  /** Salas vivas (para métricas y tests). */
  get roomCount(): number {
    return this.rooms.size;
  }

  createRoom(socket: GameSocket, input: CreateRoomPayload): void {
    if (this.socketRoom.has(socket.id)) {
      throw new RoomError("Ya estás en una sala");
    }
    if (this.rooms.size >= MAX_ROOMS) {
      throw new RoomError("Demasiadas salas activas, inténtalo más tarde");
    }
    const code = this.pickCode();
    const player = this.makePlayer(socket, input.name, input.avatar, true);
    const room: Room = {
      code,
      hostId: player.id,
      config: input.config,
      phase: "lobby",
      players: new Map([[player.id, player]]),
      rounds: [],
      roundIndex: 0,
      roundTargetTs: 0,
      roundGuesses: new Map(),
      roundTimer: null,
      gapTimer: null,
    };
    this.rooms.set(code, room);
    this.socketRoom.set(socket.id, code);
    socket.join(code);
    socket.emit("your_id", { playerId: player.id });
    this.broadcastState(room);
  }

  joinRoom(socket: GameSocket, input: JoinRoomPayload): void {
    if (this.socketRoom.has(socket.id)) {
      throw new RoomError("Ya estás en una sala");
    }
    const room = this.rooms.get(input.code);
    if (room === undefined) throw new RoomError("Sala no encontrada");

    // Si la partida ya empezó, permitir reconexión si un jugador desconectado coincide en nombre
    if (room.phase !== "lobby") {
      const disconnected = [...room.players.values()].find(
        (p) => !p.connected && p.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
      );
      if (disconnected !== undefined) {
        disconnected.connected = true;
        disconnected.socketId = socket.id;
        this.socketRoom.set(socket.id, room.code);
        socket.join(room.code);
        socket.emit("your_id", { playerId: disconnected.id });
        this.broadcastState(room);
        if (room.phase === "playing") {
          const currentRound = room.rounds[room.roundIndex];
          if (currentRound !== undefined) {
            socket.emit("round_start", {
              index: room.roundIndex,
              totalRounds: room.rounds.length,
              item: currentRound.item,
              targetTs: room.roundTargetTs,
            });
            if (currentRound.ownerId === disconnected.id) {
              socket.emit("you_are_owner", { index: room.roundIndex });
            }
          }
        }
        return;
      }
      throw new RoomError("La partida ya ha empezado");
    }

    if (room.players.size >= MAX_PLAYERS) throw new RoomError("La sala está llena (máximo 10)");
    const player = this.makePlayer(socket, input.name, input.avatar, false);
    room.players.set(player.id, player);
    this.socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    socket.emit("your_id", { playerId: player.id });
    this.broadcastState(room);
  }

  /**
   * El socket se ha ido. En lobby/pools se elimina al jugador; en partida se
   * marca como desconectado para no romper la ronda en curso. En ambos casos la
   * sala se destruye cuando no queda nadie conectado, para no dejar salas ni
   * medios huérfanos ocupando `MAX_ROOMS`.
   */
  leave(socketId: string): void {
    const code = this.socketRoom.get(socketId);
    this.socketRoom.delete(socketId);
    const room = code === undefined ? undefined : this.rooms.get(code);
    if (room === undefined) return;
    const player = [...room.players.values()].find((p) => p.socketId === socketId);
    if (player === undefined) return;

    if (room.phase === "lobby" || room.phase === "pools") {
      this.releasePool(player);
      room.players.delete(player.id);
      this.promoteHost(room);
      if (!this.hasConnectedPlayers(room)) {
        this.destroy(room);
        return;
      }
      this.broadcastState(room);
      this.tryStartGame(room);
      return;
    }

    player.connected = false;
    this.promoteHost(room);
    if (!this.hasConnectedPlayers(room)) {
      this.destroy(room);
      return;
    }
    this.broadcastState(room);
  }

  /** Host: lobby → pools. Cada jugador sube sus propios archivos. */
  startPools(socket: GameSocket): void {
    const found = this.resolve(socket.id);
    if (found === null) throw new RoomError("No estás en una sala");
    const { room, player } = found;
    if (player.id !== room.hostId) throw new RoomError("Solo el host puede empezar");
    if (room.phase !== "lobby") throw new RoomError("La partida ya ha empezado");
    if (room.players.size < 2) throw new RoomError("Necesitas al menos 2 jugadores");
    room.phase = "pools";
    this.broadcastState(room);
  }

  /** Host, en lobby: cambia la duración de cada ronda. */
  setRoundDuration(socket: GameSocket, payload: SetRoundDurationPayload): void {
    const found = this.resolve(socket.id);
    if (found === null) throw new RoomError("No estás en una sala");
    const { room, player } = found;
    if (player.id !== room.hostId) throw new RoomError("Solo el host puede cambiar la duración");
    if (room.phase !== "lobby") throw new RoomError("La partida ya ha empezado");
    room.config.roundDurationMs = payload.roundDurationMs;
    this.broadcastState(room);
  }

  /**
   * Sube (o reemplaza) el archivo de la posición `index` del pool en construcción.
   * Un mensaje por archivo evita el buffer gigante de subir 12 a la vez.
   */
  addPoolItem(
    socket: GameSocket,
    payload: UploadItemPayload,
  ): { received: number; required: number } {
    const found = this.resolve(socket.id);
    if (found === null) throw new RoomError("No estás en una sala");
    const { room, player } = found;
    if (room.phase !== "pools") throw new RoomError("Ahora no puedes subir tu pool");
    if (player.pool !== null && player.poolReady) {
      throw new RoomError("Ya has aceptado tu pool");
    }
    const required = poolSizeFor(room.config.rounds, room.players.size);
    if (payload.index >= required) throw new RoomError("Ese archivo no entra en tu pool");

    const item = this.storeUploadedItem(room, payload.item);
    const previous = player.poolDraft[payload.index];
    player.poolDraft[payload.index] = item;
    if (previous !== undefined && previous !== null) this.store.removeMany([previous.id]);

    const received = player.poolDraft
      .slice(0, required)
      .filter((draftItem) => draftItem !== undefined && draftItem !== null).length;
    return { received, required };
  }

  /** Cierra el pool: exige las `poolSizeFor` posiciones antes de emitir `your_pool`. */
  finishPool(socket: GameSocket): void {
    const found = this.resolve(socket.id);
    if (found === null) throw new RoomError("No estás en una sala");
    const { room, player } = found;
    if (room.phase !== "pools") throw new RoomError("Ahora no puedes subir tu pool");
    if (player.pool !== null && player.poolReady) {
      throw new RoomError("Ya has aceptado tu pool");
    }
    const required = poolSizeFor(room.config.rounds, room.players.size);
    const items: MediaItem[] = [];
    for (let index = 0; index < required; index += 1) {
      const item = player.poolDraft[index];
      if (item === undefined || item === null) {
        throw new RoomError(`Faltan archivos: elige exactamente ${required}`);
      }
      items.push(item);
    }

    if (player.pool !== null) this.store.removeMany(player.pool.map((item) => item.id));
    player.pool = items;
    player.poolDraft = [];
    player.poolReady = false;
    this.io.to(player.socketId).emit("your_pool", { items });
  }

  acceptPool(socket: GameSocket): void {
    const found = this.resolve(socket.id);
    if (found === null) throw new RoomError("No estás en una sala");
    const { room, player } = found;
    if (room.phase !== "pools") throw new RoomError("Ahora no puedes aceptar el pool");
    if (player.pool === null) throw new RoomError("Aún no tienes pool generado");
    player.poolReady = true;
    this.broadcastState(room);
    this.tryStartGame(room);
  }

  guess(socket: GameSocket, payload: GuessPayload): void {
    const found = this.resolve(socket.id);
    if (found === null) throw new RoomError("No estás en una sala");
    const { room, player } = found;
    if (room.phase !== "playing") throw new RoomError("No es el momento de adivinar");
    if (payload.roundIndex !== room.roundIndex) throw new RoomError("Esa ronda ya ha pasado");
    const round = room.rounds[room.roundIndex];
    if (round === undefined) throw new RoomError("La partida está acabando");
    if (round.ownerId === player.id) throw new RoomError("¡Esa es tu foto! No puedes adivinarla");
    if (payload.guessedPlayerId === player.id) throw new RoomError("No puedes elegirte a ti mismo");
    if (!room.players.has(payload.guessedPlayerId)) throw new RoomError("Jugador no encontrado");
    if (room.roundGuesses.has(player.id)) throw new RoomError("Ya has adivinado en esta ronda");
    const now = Date.now();
    if (now > room.roundTargetTs) throw new RoomError("Tiempo agotado");
    const points = scoreFor(
      payload.guessedPlayerId === round.ownerId,
      room.roundTargetTs - now,
      room.config.roundDurationMs,
    );
    room.roundGuesses.set(player.id, { guessedId: payload.guessedPlayerId, points });

    // Si todos los jugadores elegibles ya han votado, cerramos la ronda con feedback visual
    const eligibleVoters = [...room.players.values()].filter(
      (p) => p.connected && p.id !== round.ownerId,
    );
    if (eligibleVoters.length > 0 && room.roundGuesses.size >= eligibleVoters.length) {
      if (room.roundTimer !== null) {
        clearTimeout(room.roundTimer);
        room.roundTimer = setTimeout(() => this.endRound(room), 400);
      }
    }
  }

  /** Host, en results: vuelve a la fase pools; cada jugador vuelve a subir archivos. */
  async playAgain(socket: GameSocket): Promise<void> {
    const found = this.resolve(socket.id);
    if (found === null) throw new RoomError("No estás en una sala");
    const { room, player } = found;
    if (player.id !== room.hostId) throw new RoomError("Solo el host puede empezar de nuevo");
    if (room.phase !== "results") throw new RoomError("La partida no ha terminado");
    room.phase = "pools";
    room.rounds = [];
    room.roundIndex = 0;
    room.roundGuesses.clear();
    // Los medios de la partida anterior ya no se usan: liberarlos antes de
    // soltar las referencias, o el store se llena tras varias revanchas.
    for (const p of room.players.values()) this.releasePool(p);
    // Quien se fue durante la partida no vuelve a la revancha: si se quedara en
    // el mapa, la sala no podría destruirse cuando el resto se desconecte.
    for (const p of [...room.players.values()]) {
      if (p.connected) continue;
      room.players.delete(p.id);
      if (this.socketRoom.get(p.socketId) === room.code) {
        this.socketRoom.delete(p.socketId);
      }
    }
    for (const p of room.players.values()) {
      p.score = 0;
      p.pool = null;
      p.poolReady = false;
    }
    this.broadcastState(room);
  }

  // ── privado ────────────────────────────────────────────────────────────────

  private makePlayer(
    socket: GameSocket,
    name: string,
    avatar: string,
    isHost: boolean,
  ): ServerPlayer {
    return {
      id: randomUUID(),
      name,
      avatar,
      isHost,
      connected: true,
      poolReady: false,
      score: 0,
      socketId: socket.id,
      pool: null,
      poolDraft: [],
    };
  }

  /** Valida el archivo (modo, magic bytes, tamaño) y lo guarda en el store. */
  private storeUploadedItem(room: Room, uploaded: UploadedItem): MediaItem {
    if (room.config.mode === "photos" && uploaded.kind !== "photo") {
      throw new RoomError("En modo fotos solo se admiten fotos");
    }
    if (room.config.mode === "videos" && uploaded.kind !== "video") {
      throw new RoomError("En modo vídeos solo se admiten vídeos");
    }

    const { buffer } = decodeDataUrl(uploaded.data);

    const realMediaType = detectMediaType(buffer);
    if (realMediaType === null) {
      throw new RoomError("Tipo de archivo no permitido: se esperaba un tipo válido.");
    }

    const isImage = ["jpeg", "png", "gif", "webp", "avif"].includes(realMediaType);
    const isVideo = ["mp4", "webm", "mov"].includes(realMediaType);

    if (uploaded.kind === "photo" && !isImage) {
      throw new RoomError("Tipo de archivo no permitido: se esperaba una imagen.");
    }
    if (uploaded.kind === "video" && !isVideo) {
      throw new RoomError("Tipo de archivo no permitido: se esperaba un vídeo.");
    }

    const realContentType = getMimeType(realMediaType);

    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new RoomError(`El archivo supera el límite de ${MAX_UPLOAD_BYTES} bytes`);
    }

    let thumb: Buffer | undefined;
    if (uploaded.thumbData !== undefined) {
      thumb = decodeDataUrl(uploaded.thumbData).buffer;
    }
    const stored = this.store.add(buffer, realContentType, thumb);
    return {
      id: stored.id,
      kind: uploaded.kind,
      url: stored.url,
      ...(stored.thumbUrl !== undefined ? { thumbUrl: stored.thumbUrl } : {}),
    };
  }

  /** Libera pool aceptado y borrador (incluidos huecos) de un jugador. */
  private releasePool(player: ServerPlayer): void {
    const ids = [
      ...(player.pool?.map((item) => item.id) ?? []),
      ...player.poolDraft.flatMap((item) => (item === null || item === undefined ? [] : [item.id])),
    ];
    if (ids.length > 0) this.store.removeMany(ids);
    player.pool = null;
    player.poolDraft = [];
  }

  private pickCode(): string {
    let code = "";
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET.at(randomInt(0, CODE_ALPHABET.length - 1)) ?? "A",
      ).join("");
    } while (this.rooms.has(code));
    return code;
  }

  private tryStartGame(room: Room): void {
    if (room.phase !== "pools") return;
    const active = [...room.players.values()].filter((p) => p.connected);
    if (active.length < 2) return;
    const allReady = active.every((p) => p.pool !== null && p.poolReady);
    if (!allReady) return;
    const pools = new Map(active.map((p) => [p.id, p.pool ?? []]));
    room.rounds = buildRounds(pools, room.config.rounds);
    if (room.rounds.length === 0) {
      // Sin esto los jugadores quedarían con poolReady=true y no podrían volver
      // a subir nada: sala bloqueada en `pools` para siempre.
      for (const p of active) p.poolReady = false;
      this.broadcastState(room);
      this.io.to(room.code).emit("error", { message: "No hay suficientes medios para jugar" });
      return;
    }
    for (const p of room.players.values()) p.score = 0;
    room.roundIndex = 0;
    room.phase = "playing";
    this.broadcastState(room);
    this.startRound(room);
  }

  private startRound(room: Room): void {
    const round = room.rounds[room.roundIndex];
    if (round === undefined) {
      this.finishGame(room);
      return;
    }
    room.roundTargetTs = Date.now() + room.config.roundDurationMs;
    room.roundGuesses = new Map();
    this.io.to(room.code).emit("round_start", {
      index: room.roundIndex,
      totalRounds: room.rounds.length,
      item: round.item,
      targetTs: room.roundTargetTs,
    });
    const owner = room.players.get(round.ownerId);
    if (owner !== undefined) {
      this.io.to(owner.socketId).emit("you_are_owner", { index: room.roundIndex });
    }
    room.roundTimer = setTimeout(() => this.endRound(room), room.config.roundDurationMs + 250);
  }

  private endRound(room: Room): void {
    if (room.phase !== "playing") return;
    const round = room.rounds[room.roundIndex];
    if (round === undefined) {
      this.finishGame(room);
      return;
    }
    const owner = room.players.get(round.ownerId);
    const guesses: RoundRevealPayload["guesses"] = [];
    for (const [playerId, guess] of room.roundGuesses) {
      const player = room.players.get(playerId);
      if (player === undefined) continue;
      guesses.push({
        playerId,
        playerName: player.name,
        avatar: player.avatar,
        guessedPlayerId: guess.guessedId,
        correct: guess.guessedId === round.ownerId,
        points: guess.points,
      });
    }
    for (const [playerId, guess] of room.roundGuesses) {
      const player = room.players.get(playerId);
      if (player !== undefined) player.score += guess.points;
    }
    if (owner?.connected) owner.score += OWNER_BONUS;
    const scores = [...room.players.values()].map((p) => ({ playerId: p.id, score: p.score }));
    this.io.to(room.code).emit("round_reveal", {
      index: room.roundIndex,
      ownerId: round.ownerId,
      ownerName: owner?.name ?? "Alguien",
      ownerAvatar: owner?.avatar ?? "❓",
      guesses,
      scores,
    });
    this.broadcastState(room);
    if (room.roundIndex + 1 < room.rounds.length) {
      room.gapTimer = setTimeout(() => {
        room.roundIndex += 1;
        this.startRound(room);
      }, ROUND_GAP_MS);
    } else {
      this.finishGame(room);
    }
  }

  private finishGame(room: Room): void {
    room.phase = "results";
    const standings: GameResultPayload["standings"] = [...room.players.values()]
      .map((p) => ({ playerId: p.id, name: p.name, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    const championId = standings[0]?.playerId ?? "";
    this.io.to(room.code).emit("game_result", { standings, championId });
    this.broadcastState(room);
  }

  /**
   * El host solo se reasigna si el actual ya no está o está desconectado: durante
   * la partida el host sigue en el mapa con `connected = false`, así que mirar
   * únicamente si existe dejaba la sala sin host y bloqueaba "jugar de nuevo".
   */
  private promoteHost(room: Room): void {
    const current = room.players.get(room.hostId);
    if (current?.connected === true) return;
    const next = [...room.players.values()].find((p) => p.connected);
    for (const p of room.players.values()) p.isHost = p === next;
    if (next !== undefined) room.hostId = next.id;
  }

  private hasConnectedPlayers(room: Room): boolean {
    return [...room.players.values()].some((p) => p.connected);
  }

  private destroy(room: Room): void {
    if (room.roundTimer !== null) clearTimeout(room.roundTimer);
    if (room.gapTimer !== null) clearTimeout(room.gapTimer);
    for (const player of room.players.values()) this.releasePool(player);
    for (const player of room.players.values()) {
      if (this.socketRoom.get(player.socketId) === room.code) {
        this.socketRoom.delete(player.socketId);
      }
    }
    this.rooms.delete(room.code);
  }

  private resolve(socketId: string): { room: Room; player: ServerPlayer } | null {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) return { room, player };
      }
    }
    return null;
  }

  private broadcastState(room: Room): void {
    this.io.to(room.code).emit("room_state", this.snapshot(room));
  }

  private snapshot(room: Room): RoomState {
    return {
      code: room.code,
      hostId: room.hostId,
      config: room.config,
      phase: room.phase,
      players: [...room.players.values()].map(toPublicPlayer),
      ...(room.rounds.length > 0
        ? { currentRound: room.roundIndex, totalRounds: room.rounds.length }
        : {}),
    };
  }
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (match === null) throw new RoomError("Formato de archivo inválido");
  const contentType = match[1] ?? "application/octet-stream";
  const buffer = Buffer.from(match[2] ?? "", "base64");
  if (buffer.length === 0) throw new RoomError("Archivo vacío");
  return { buffer, contentType };
}
