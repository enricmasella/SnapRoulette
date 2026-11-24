import { type Socket, io } from "socket.io-client";

import type { ClientToServerEvents, ServerToClientEvents } from "@snaproulette/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Conecta al server vía el proxy de Vite (mismo origen en dev).
 * El server autoritativo decide todo; aquí solo se envían intenciones.
 */
export function createSocket(): GameSocket {
  return io();
}
