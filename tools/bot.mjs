import { crc32, deflateSync } from "node:zlib";
import { io } from "socket.io-client";

/**
 * Jugadores simulados: entran en una sala existente, suben placeholders y
 * adivinan al azar. Sirve para probar una partida completa sin abrir varios
 * navegadores.
 *
 *   npm run bot -- ABCDE
 *   npm run bot -- ABCDE --bots 3 --url http://localhost:3001
 */
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const CODE = (
  option(
    "room",
    args.find((arg) => !arg.startsWith("--")),
  ) ?? ""
).toUpperCase();
const SERVER = option("url", "http://localhost:3001");
const BOTS = Math.max(1, Math.min(9, Number(option("bots", "1")) || 1));
const NAME = option("name", "Bot");
const AVATAR = "👾";

if (!/^[A-Z0-9]{4,8}$/.test(CODE)) {
  console.error("Uso: npm run bot -- <código de sala> [--bots 3] [--url http://localhost:3001]");
  process.exit(1);
}

const COLORS = [
  "#e11d48",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
  "#d946ef",
];

function poolSizeFor(rounds, players) {
  return Math.max(3, Math.ceil(rounds / players) + 2);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Genera un PNG válido (8-bit RGB, sin filtros) de 4x4 px con el color dado. */
function pngDataUrl(color) {
  const [r, g, b] = hexToRgb(color);
  const width = 4;
  const height = 4;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filtro "none" por fila
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 2; // color type RGB
  const makeChunk = (type, data) => {
    const typeBuffer = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
    return Buffer.concat([length, typeBuffer, data, crc]);
  };
  const png = Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const ACK_TIMEOUT_MS = 20_000;

function startBot(index) {
  const name = BOTS === 1 ? NAME : `${NAME} ${index + 1}`;
  const socket = io(SERVER, { transports: ["websocket"] });
  const log = (message) =>
    console.log(`[${name} ${new Date().toISOString().slice(11, 19)}] ${message}`);

  let myId = null;
  let joined = false;
  let ownerIndex = null;
  let roomPlayers = [];
  let uploadedForPool = false;

  /** Emite con ACK: si el servidor no contesta, no dejamos la subida colgada. */
  const emitWithAck = (event, payload) =>
    new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, message: "sin respuesta del servidor" }),
        ACK_TIMEOUT_MS,
      );
      const done = (result) => {
        clearTimeout(timer);
        resolve(result ?? { ok: false, message: "ACK vacío" });
      };
      if (payload === undefined) socket.emit(event, done);
      else socket.emit(event, payload, done);
    });

  async function uploadPool(state) {
    const required = poolSizeFor(state.config.rounds, state.players.length);
    const kind = state.config.mode === "videos" ? "video" : "photo";
    log(`fase pools → subiendo ${required} placeholders (${kind})`);
    for (let itemIndex = 0; itemIndex < required; itemIndex += 1) {
      const data = pngDataUrl(COLORS[(itemIndex + index) % COLORS.length]);
      const result = await emitWithAck("upload_item", { index: itemIndex, item: { kind, data } });
      if (!result.ok) {
        log(`fallo en el archivo ${itemIndex + 1}/${required}: ${result.message}`);
        return;
      }
    }
    const finished = await emitWithAck("finish_pool");
    if (!finished.ok) log(`fallo al cerrar el pool: ${finished.message}`);
  }

  socket.on("connect", () => {
    log(`conectado, entrando en la sala ${CODE}`);
    socket.emit("join_room", { code: CODE, name, avatar: AVATAR });
  });

  socket.on("your_id", ({ playerId }) => {
    myId = playerId;
    joined = true;
    log(`dentro de la sala, id ${myId.slice(0, 8)}…`);
  });

  socket.on("room_state", (state) => {
    roomPlayers = state.players;
    log(`fase=${state.phase} jugadores=${state.players.map((p) => p.name).join(", ")}`);
    if (state.phase === "pools" && !uploadedForPool) {
      uploadedForPool = true;
      void uploadPool(state);
    } else if (state.phase !== "pools") {
      uploadedForPool = false;
    }
  });

  socket.on("your_pool", ({ items }) => {
    log(`pool recibido (${items.length} items) → aceptando`);
    setTimeout(() => socket.emit("accept_pool"), 800);
  });

  socket.on("round_start", ({ index: roundIndex, totalRounds }) => {
    ownerIndex = null;
    log(`ronda ${roundIndex + 1}/${totalRounds} — decidiendo`);
    setTimeout(
      () => {
        if (ownerIndex === roundIndex) return;
        const targets = roomPlayers.filter((p) => p.connected && p.id !== myId);
        if (targets.length === 0) return;
        const target = targets[Math.floor(Math.random() * targets.length)];
        log(`adivinando → ${target.name}`);
        socket.emit("guess", { roundIndex, guessedPlayerId: target.id });
      },
      600 + Math.random() * 1400,
    );
  });

  socket.on("you_are_owner", ({ index: roundIndex }) => {
    ownerIndex = roundIndex;
    log(`ronda ${roundIndex + 1} — soy el dueño, no adivino`);
  });

  socket.on("round_reveal", ({ ownerName, guesses }) => {
    const mine = guesses.find((guess) => guess.playerId === myId);
    log(
      `reveal: dueño=${ownerName} mi guess=${mine ? (mine.correct ? "✓ correcto" : "✗ fallo") : "—"}`,
    );
  });

  socket.on("game_result", ({ standings }) => {
    log(`fin de partida: ${standings.map((p) => `${p.name} ${p.score}`).join(" | ")}`);
  });

  socket.on("error", ({ message }) => {
    log(`error: ${message}`);
    if (!joined && message.includes("Sala no encontrada")) {
      setTimeout(() => socket.emit("join_room", { code: CODE, name, avatar: AVATAR }), 2000);
    }
  });

  socket.on("disconnect", (reason) => log(`desconectado: ${reason}`));
}

for (let index = 0; index < BOTS; index += 1) startBot(index);
