import "./node-require.js";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_UPLOAD_BYTES,
  createRoomPayloadSchema,
  guessPayloadSchema,
  joinRoomPayloadSchema,
  setRoundDurationPayloadSchema,
  uploadItemPayloadSchema,
} from "@snaproulette/shared";
import type { ClientToServerEvents, ServerToClientEvents } from "@snaproulette/shared";
import type { Socket } from "socket.io";
import { Server } from "socket.io";

import { MediaStore } from "./media/store.js";
import { RoomError, RoomManager } from "./room/room.js";
import { type RateLimitAction, rateLimiter } from "./util/rate-limit.js";

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
// Detrás de un proxy (Fly, Render, nginx) todas las conexiones llegan desde la
// misma IP: sin esto, los límites por IP pasan a ser globales para todo el mundo.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

// El bundle vive en dist/, mientras que el source vive en src/.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLIENT_DIST = resolve(
  MODULE_DIR,
  MODULE_DIR.endsWith(`${sep}dist`) ? "../../client/dist" : "../client/dist",
);
const CLIENT_DIST = resolve(MODULE_DIR, process.env.CLIENT_DIST ?? DEFAULT_CLIENT_DIST);
const CLIENT_DIST_PREFIX = CLIENT_DIST.endsWith(sep) ? CLIENT_DIST : `${CLIENT_DIST}${sep}`;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

const IMMUTABLE_ASSET_PATTERN = /\/[a-zA-Z0-9_-]{8,}\.(?:js|css|svg|png|ico|woff2)$/;

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = error.code;
      if (code === "ENOENT" || code === "ENOTDIR") return false;
    }
    throw error;
  }
}

function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  cacheControl: string,
): boolean {
  if (!isFile(filePath)) return false;

  res.writeHead(200, {
    "Cache-Control": cacheControl,
    "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    res.destroy(error);
  });
  stream.pipe(res);
  return true;
}

// Se sube un archivo por mensaje: 20 MB → ~27 MB en base64 + 5 MB de miniatura.
// Antes eran 12 ítems juntos (~320 MB) y un cliente podía reservarlos todos.
const MAX_SOCKET_BUFFER_BYTES = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8_000_000;

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CORS_ORIGIN },
  maxHttpBufferSize: MAX_SOCKET_BUFFER_BYTES,
});

const mediaStore = new MediaStore();
const rooms = new RoomManager(io, mediaStore);

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Los mensajes de `RoomError` son para el usuario; el resto solo va al log. */
function fail(socket: GameSocket, error: unknown): void {
  if (!(error instanceof RoomError)) {
    console.error("[server] error no controlado:", error);
  }
  socket.emit("error", {
    message: error instanceof RoomError ? error.message : "Error inesperado",
  });
}

function clientKey(socket: GameSocket): string {
  if (!TRUST_PROXY) return socket.handshake.address;
  const header = socket.handshake.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header[0] : header;
  const first = raw?.split(",")[0]?.trim();
  return first !== undefined && first.length > 0 ? first : socket.handshake.address;
}

function allow(socket: GameSocket, action: RateLimitAction): boolean {
  return rateLimiter.allow(action, clientKey(socket));
}

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

/**
 * Sirve un medio con soporte de `Range`: Safari/iOS lo pide para reproducir
 * `<video>` y sin 206 puede negarse a reproducir el archivo.
 */
function serveMedia(
  req: IncomingMessage,
  res: ServerResponse,
  stored: { buffer: Buffer; contentType: string },
): void {
  const total = stored.buffer.length;
  const headers: Record<string, string | number> = {
    "Content-Type": stored.contentType,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };

  const range = req.headers.range;
  const match = range === undefined ? null : RANGE_PATTERN.exec(range.trim());
  if (match === null) {
    res.writeHead(200, { ...headers, "Content-Length": total });
    res.end(stored.buffer);
    return;
  }

  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  let start = startRaw === "" ? 0 : Number(startRaw);
  let end = endRaw === "" ? total - 1 : Number(endRaw);
  if (startRaw === "" && endRaw !== "") {
    // `bytes=-N`: los últimos N bytes.
    start = Math.max(0, total - end);
    end = total - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= total) {
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    res.end();
    return;
  }
  end = Math.min(end, total - 1);
  if (start > end) {
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    res.end();
    return;
  }

  res.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Content-Length": end - start + 1,
  });
  res.end(stored.buffer.subarray(start, end + 1));
}

/** Sirve los medios subidos por los jugadores. Cualquier otra ruta la gestiona socket.io. */
httpServer.on("request", (req, res) => {
  const url = req.url ?? "";
  const requestPath = url.split("?", 1)[0] ?? "";
  if (requestPath === "/healthz") {
    if (req.method !== "GET") {
      res.writeHead(405, {
        Allow: "GET",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Method not allowed");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        ok: true,
        rooms: rooms.roomCount,
        mediaCount: mediaStore.count,
        mediaBytes: mediaStore.bytes,
      }),
    );
    return;
  }
  if (requestPath.startsWith("/socket.io")) return;
  if (url.startsWith("/media/")) {
    if (req.method !== "GET") {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    const match = /^\/media\/([^/]+)(\/thumb)?$/.exec(url);
    if (match === null) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    const id = match[1] ?? "";
    const stored = match[2] !== undefined ? mediaStore.getThumb(id) : mediaStore.get(id);
    if (stored === undefined) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    serveMedia(req, res, stored);
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(requestPath);
  } catch (error) {
    if (error instanceof URIError) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    throw error;
  }
  if (pathname.includes("\0")) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed");
    return;
  }

  const requestedPath = pathname === "" || pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(CLIENT_DIST, `.${requestedPath}`);
  if (!filePath.startsWith(CLIENT_DIST_PREFIX)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const cacheControl = IMMUTABLE_ASSET_PATTERN.test(pathname)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  if (serveFile(req, res, filePath, cacheControl)) return;
  if (extname(pathname) !== "") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const indexPath = resolve(CLIENT_DIST, "index.html");
  if (serveFile(req, res, indexPath, "no-cache")) return;
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

io.on("connection", (socket) => {
  if (!allow(socket, "connect")) {
    socket.disconnect(true);
    return;
  }
  console.log(`[sock] ${socket.id} conectado`);

  socket.on("create_room", (payload) => {
    if (!allow(socket, "create_room")) {
      return fail(socket, new RoomError("Demasiadas solicitudes, espera un momento"));
    }
    const parsed = createRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) return fail(socket, new RoomError("Datos de sala inválidos"));
    try {
      rooms.createRoom(socket, parsed.data);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("join_room", (payload) => {
    if (!allow(socket, "join_room")) {
      return fail(socket, new RoomError("Demasiadas solicitudes, espera un momento"));
    }
    const parsed = joinRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) return fail(socket, new RoomError("Datos de sala inválidos"));
    try {
      rooms.joinRoom(socket, parsed.data);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("start_game", () => {
    try {
      rooms.startPools(socket);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("set_round_duration", (payload) => {
    const parsed = setRoundDurationPayloadSchema.safeParse(payload);
    if (!parsed.success) return fail(socket, new RoomError("Datos de duración inválidos"));
    try {
      rooms.setRoundDuration(socket, parsed.data);
    } catch (error) {
      fail(socket, error);
    }
  });

  // Los ACK son la única respuesta de los eventos de subida: nada de emitir
  // `error` también, o el cliente mostraría el fallo dos veces.
  socket.on("upload_item", (payload, ack) => {
    if (!allow(socket, "upload_item")) {
      ack?.({ ok: false, message: "Demasiadas solicitudes, espera un momento" });
      return;
    }
    const parsed = uploadItemPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      ack?.({ ok: false, message: "Datos de archivo inválidos" });
      return;
    }
    try {
      ack?.({ ok: true, ...rooms.addPoolItem(socket, parsed.data) });
    } catch (error) {
      if (!(error instanceof RoomError)) console.error("[server] error no controlado:", error);
      ack?.({
        ok: false,
        message: error instanceof RoomError ? error.message : "Error inesperado",
      });
    }
  });

  socket.on("finish_pool", (ack) => {
    if (!allow(socket, "finish_pool")) {
      ack?.({ ok: false, message: "Demasiadas solicitudes, espera un momento" });
      return;
    }
    try {
      rooms.finishPool(socket);
      ack?.({ ok: true });
    } catch (error) {
      if (!(error instanceof RoomError)) console.error("[server] error no controlado:", error);
      ack?.({
        ok: false,
        message: error instanceof RoomError ? error.message : "Error inesperado",
      });
    }
  });

  socket.on("accept_pool", () => {
    try {
      rooms.acceptPool(socket);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("guess", (payload) => {
    const parsed = guessPayloadSchema.safeParse(payload);
    if (!parsed.success) return fail(socket, new RoomError("Datos de adivinanza inválidos"));
    try {
      rooms.guess(socket, parsed.data);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("play_again", async () => {
    try {
      await rooms.playAgain(socket);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[sock] ${socket.id} desconectado (${reason})`);
    rooms.leave(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`SnapRoulette server → http://localhost:${PORT}`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] Cerrando (${signal})`);

  const forceExit = setTimeout(() => {
    console.warn("[server] Cierre forzado tras 10s");
    process.exit(0);
  }, 10_000);
  forceExit.unref();

  let pendingCloses = 2;
  const closeFinished = (): void => {
    pendingCloses -= 1;
    if (pendingCloses !== 0) return;
    clearTimeout(forceExit);
    console.log("[server] Cierre completado");
    process.exit(0);
  };

  httpServer.close(closeFinished);
  io.close(closeFinished);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
