import type {
  ClientToServerEvents,
  RoomState,
  ServerToClientEvents,
  UploadedItem,
} from "@snaproulette/shared";
import type { Server, Socket } from "socket.io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaStore } from "../src/media/store.js";
import { RoomError, RoomManager } from "../src/room/room.js";

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface EmittedEvent {
  target: string;
  event: string;
  payload: unknown;
}

/**
 * Doble de test mínimo: `RoomManager` solo usa `io.to(...).emit(...)`.
 * El cast es la frontera entre el mock y la interfaz completa de socket.io.
 */
function createIo(): { io: GameServer; events: EmittedEvent[] } {
  const events: EmittedEvent[] = [];
  const io = {
    to: (target: string) => ({
      emit: (event: string, payload: unknown) => {
        events.push({ target, event, payload });
      },
    }),
  } as unknown as GameServer;
  return { io, events };
}

let socketSeq = 0;

/** Doble de test mínimo de un socket: id + join/emit sin red. */
function createSocket(): GameSocket {
  socketSeq += 1;
  return {
    id: `socket-${socketSeq}`,
    join: () => undefined,
    emit: () => undefined,
  } as unknown as GameSocket;
}

/** JPEG mínimo válido: solo importan los magic bytes para `detectMediaType`. */
const JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
]).toString("base64")}`;

function photoItem(): UploadedItem {
  return { kind: "photo", data: JPEG_DATA_URL };
}

function photoItems(count: number): UploadedItem[] {
  return Array.from({ length: count }, photoItem);
}

/** Simula lo que hace el cliente: un `upload_item` por archivo y luego `finish_pool`. */
function uploadPool(manager: RoomManager, socket: GameSocket, items: UploadedItem[]): void {
  items.forEach((item, index) => manager.addPoolItem(socket, { index, item }));
  manager.finishPool(socket);
}

interface Harness {
  manager: RoomManager;
  store: MediaStore;
  events: EmittedEvent[];
  host: GameSocket;
  guest: GameSocket;
  code: string;
}

function isRoomStateEvent(
  event: EmittedEvent,
): event is EmittedEvent & { event: "room_state"; payload: RoomState } {
  return event.event === "room_state";
}

function lastRoomState(events: EmittedEvent[]): RoomState {
  const last = events.filter(isRoomStateEvent).at(-1);
  if (last === undefined) throw new Error("No se emitió room_state");
  return last.payload;
}

function createHarness(rounds = 3): Harness {
  const { io, events } = createIo();
  const store = new MediaStore();
  const manager = new RoomManager(io, store);
  const host = createSocket();
  const guest = createSocket();
  manager.createRoom(host, {
    name: "Host",
    avatar: "🦊",
    config: { mode: "photos", rounds, roundDurationMs: 3_000 },
  });
  const code = lastRoomState(events).code;
  manager.joinRoom(guest, { code, name: "Guest", avatar: "🐼" });
  return { manager, store, events, host, guest, code };
}

/** Lobby → pools → partida terminada (3 rondas de 3 s + huecos de 3 s). */
async function playFullGame(harness: Harness): Promise<void> {
  const { manager, host, guest } = harness;
  manager.startPools(host);
  const room = lastRoomState(harness.events);
  const required = Math.max(3, Math.ceil(3 / room.players.length) + 2);
  uploadPool(manager, host, photoItems(required));
  uploadPool(manager, guest, photoItems(required));
  manager.acceptPool(host);
  manager.acceptPool(guest);
  expect(lastRoomState(harness.events).phase).toBe("playing");
  vi.advanceTimersByTime(16_000);
  expect(lastRoomState(harness.events).phase).toBe("results");
}

describe("RoomManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("libera los medios de la partida anterior al jugar de nuevo", async () => {
    const harness = createHarness();
    await playFullGame(harness);
    expect(harness.store.count).toBeGreaterThan(0);

    await harness.manager.playAgain(harness.host);

    expect(lastRoomState(harness.events).phase).toBe("pools");
    expect(harness.store.count).toBe(0);
    expect(harness.store.bytes).toBe(0);
  });

  it("destruye la sala cuando todos se desconectan durante la partida", async () => {
    const harness = createHarness();
    await playFullGame(harness);
    expect(harness.store.count).toBeGreaterThan(0);

    harness.manager.leave(harness.host.id);
    harness.manager.leave(harness.guest.id);

    expect(harness.manager.roomCount).toBe(0);
    expect(harness.store.count).toBe(0);
  });

  it("no permite que un socket esté en dos salas a la vez", () => {
    const harness = createHarness();

    expect(() =>
      harness.manager.createRoom(harness.host, {
        name: "Host",
        avatar: "🦊",
        config: { mode: "photos", rounds: 3, roundDurationMs: 3_000 },
      }),
    ).toThrow(RoomError);
    expect(harness.manager.roomCount).toBe(1);

    expect(() =>
      harness.manager.joinRoom(harness.host, {
        code: harness.code,
        name: "Host",
        avatar: "🦊",
      }),
    ).toThrow(/Ya estás en una sala/);
    expect(harness.manager.roomCount).toBe(1);
  });

  it("reasigna el host si se desconecta en partida y le deja reiniciar", async () => {
    const harness = createHarness();
    harness.manager.startPools(harness.host);
    const required = Math.max(3, Math.ceil(3 / 2) + 2);
    uploadPool(harness.manager, harness.host, photoItems(required));
    uploadPool(harness.manager, harness.guest, photoItems(required));
    harness.manager.acceptPool(harness.host);
    harness.manager.acceptPool(harness.guest);

    harness.manager.leave(harness.host.id);

    const state = lastRoomState(harness.events);
    const hosts = state.players.filter((player) => player.isHost);
    const connected = state.players.filter((player) => player.connected);
    expect(hosts).toHaveLength(1);
    expect(connected).toHaveLength(1);
    expect(state.hostId).toBe(connected[0]?.id);
    expect(hosts[0]?.id).toBe(connected[0]?.id);

    vi.advanceTimersByTime(16_000);
    expect(lastRoomState(harness.events).phase).toBe("results");

    await expect(harness.manager.playAgain(harness.guest)).resolves.toBeUndefined();
    expect(lastRoomState(harness.events).phase).toBe("pools");
  });

  it("saca de la revancha a quien se desconectó y no deja salas vivas", async () => {
    const harness = createHarness();
    harness.manager.startPools(harness.host);
    const required = Math.max(3, Math.ceil(3 / 2) + 2);
    uploadPool(harness.manager, harness.host, photoItems(required));
    uploadPool(harness.manager, harness.guest, photoItems(required));
    harness.manager.acceptPool(harness.host);
    harness.manager.acceptPool(harness.guest);

    harness.manager.leave(harness.guest.id);
    vi.advanceTimersByTime(16_000);
    await harness.manager.playAgain(harness.host);

    const state = lastRoomState(harness.events);
    expect(state.players.map((player) => player.name)).toEqual(["Host"]);
    expect(harness.store.count).toBe(0);

    harness.manager.leave(harness.host.id);
    expect(harness.manager.roomCount).toBe(0);
  });

  it("no guarda el archivo inválido y libera el borrador al desconectarse", () => {
    const harness = createHarness();
    harness.manager.startPools(harness.host);
    harness.manager.addPoolItem(harness.host, { index: 0, item: photoItem() });
    expect(harness.store.count).toBe(1);

    const broken = {
      kind: "photo" as const,
      data: "data:image/jpeg;base64,bm8tZXMtdW5hLWltYWdlbg==",
    };
    expect(() => harness.manager.addPoolItem(harness.host, { index: 1, item: broken })).toThrow(
      RoomError,
    );
    expect(harness.store.count).toBe(1);

    harness.manager.leave(harness.host.id);
    expect(harness.store.count).toBe(0);
    expect(harness.store.bytes).toBe(0);
  });

  it("reemplaza el archivo de una posición sin duplicar medios", () => {
    const harness = createHarness();
    harness.manager.startPools(harness.host);
    const item = photoItem();

    harness.manager.addPoolItem(harness.host, { index: 0, item });
    harness.manager.addPoolItem(harness.host, { index: 0, item });

    expect(harness.store.count).toBe(1);
  });

  it("no cierra el pool si falta algún archivo", () => {
    const harness = createHarness();
    harness.manager.startPools(harness.host);
    harness.manager.addPoolItem(harness.host, { index: 0, item: photoItem() });

    expect(() => harness.manager.finishPool(harness.host)).toThrow(/Faltan archivos/);
    expect(lastRoomState(harness.events).players.find((p) => p.name === "Host")?.poolReady).toBe(
      false,
    );
  });

  it("permite a un jugador desconectado reconectarse durante la partida", async () => {
    const harness = createHarness();
    const { manager, host, guest, code, events } = harness;
    manager.startPools(host);
    const room = lastRoomState(events);
    const required = Math.max(3, Math.ceil(3 / room.players.length) + 2);
    uploadPool(manager, host, photoItems(required));
    uploadPool(manager, guest, photoItems(required));
    manager.acceptPool(host);
    manager.acceptPool(guest);
    expect(lastRoomState(events).phase).toBe("playing");

    // El invitado pierde conexión
    manager.leave(guest.id);
    expect(lastRoomState(events).players.find((p) => p.name === "Guest")?.connected).toBe(false);

    // El invitado se reconecta con un socket nuevo y su mismo nombre
    const newGuestSocket = createSocket();
    manager.joinRoom(newGuestSocket, { code, name: "Guest", avatar: "🐼" });
    const reconPlayer = lastRoomState(events).players.find((p) => p.name === "Guest");
    expect(reconPlayer?.connected).toBe(true);
  });
});
