import { useCallback, useEffect, useRef, useState } from "react";

import { EV } from "@snaproulette/shared";
import type {
  FinishPoolAck,
  GameResultPayload,
  MediaItem,
  RoomConfig,
  RoomState,
  RoundRevealPayload,
  UploadItemAck,
  UploadedItem,
} from "@snaproulette/shared";

import { type GameSocket, createSocket } from "./socket";

export const AVATARS = ["🦊", "🐼", "🐸", "🦄", "🐙", "🐯", "🦁", "🐵", "🐨", "👾"];
export const DEFAULT_AVATAR = "🦊";

export interface CurrentRound {
  index: number;
  total: number;
  item: MediaItem;
  targetTs: number;
  isOwner: boolean;
}

interface AckFailure {
  ok: false;
  message: string;
}

const ACK_TIMEOUT_MS = 20_000;

/**
 * Envía un evento con ACK y resuelve también si el servidor no contesta: sin
 * esto, una subida quedaría esperando para siempre y la UI bloqueada.
 */
function sendWithAck<T extends { ok: boolean }>(
  send: (ack: (result: T) => void) => void,
): Promise<T | AckFailure> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve({ ok: false, message: "La subida tardó demasiado. Inténtalo de nuevo." });
    }, ACK_TIMEOUT_MS);
    send((result) => {
      window.clearTimeout(timer);
      resolve(result);
    });
  });
}

export interface SnapGame {
  socket: GameSocket;
  connected: boolean;
  myId: string | null;
  room: RoomState | null;
  pool: MediaItem[] | null;
  poolLoading: boolean;
  round: CurrentRound | null;
  reveal: RoundRevealPayload | null;
  result: GameResultPayload | null;
  error: string | null;
  /** Se incrementa con cada error recibido, aunque el mensaje se repita. */
  errorId: number;
  guestName: string;
  guestAvatar: string;
  setGuest: (name: string, avatar: string) => void;
  createRoom: (name: string, avatar: string, config: RoomConfig) => void;
  joinRoom: (code: string, name: string, avatar: string) => void;
  startGame: () => void;
  setRoundDuration: (roundDurationMs: number) => void;
  uploadPool: (items: UploadedItem[]) => void;
  /** Progreso de la subida por archivo; `null` si no hay subida en curso. */
  uploadProgress: { sent: number; total: number } | null;
  acceptPool: () => void;
  guess: (roundIndex: number, guessedPlayerId: string) => void;
  playAgain: () => void;
  leaveRoom: () => void;
  clearError: () => void;
}

function loadGuestName(): string {
  try {
    const stored = localStorage.getItem("snap.name");
    if (stored !== null && stored.length > 0) return stored.slice(0, 20);
  } catch {
    // sin acceso a localStorage → default
  }
  return "";
}

function loadGuestAvatar(): string {
  try {
    const stored = localStorage.getItem("snap.avatar");
    if (stored !== null && stored.length > 0) return stored;
  } catch {
    // sin acceso a localStorage → default
  }
  return DEFAULT_AVATAR;
}

/**
 * Estado del juego en el cliente. El server es la autoridad: aquí solo se
 * reflejan sus eventos y se envían intenciones.
 */
export function useSnapGame(): SnapGame {
  const socketRef = useRef<GameSocket | null>(null);
  if (socketRef.current === null) socketRef.current = createSocket();
  const socket = socketRef.current;

  const [connected, setConnected] = useState(socket.connected);
  const [myId, setMyId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [pool, setPool] = useState<MediaItem[] | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ sent: number; total: number } | null>(
    null,
  );
  const [round, setRound] = useState<CurrentRound | null>(null);
  const [reveal, setReveal] = useState<RoundRevealPayload | null>(null);
  const [result, setResult] = useState<GameResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorId, setErrorId] = useState(0);
  const [guestName, setGuestNameState] = useState(loadGuestName);
  const [guestAvatar, setGuestAvatarState] = useState(loadGuestAvatar);
  const errorTimer = useRef<number | null>(null);
  const prevPhaseRef = useRef<string | null>(null);

  const showError = useCallback((message: string) => {
    setError(message);
    setErrorId((count) => count + 1);
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 5_000);
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onYourId = (payload: { playerId: string }) => setMyId(payload.playerId);
    const onRoomState = (payload: RoomState) => {
      const prevPhase = prevPhaseRef.current;
      prevPhaseRef.current = payload.phase;
      setRoom(payload);
      // Reinicia la pool solo en la ENTRADA a la fase pools, no en cada broadcast (otro jugador aceptar su pool tambien emite room_state).
      if (payload.phase === "pools" && prevPhase !== "pools") {
        setPool(null);
        setPoolLoading(true);
      }
      if (payload.phase === "results") {
        setRound(null);
        setReveal(null);
      }
    };
    const onYourPool = (payload: { items: MediaItem[] }) => {
      setPool(payload.items);
      setPoolLoading(false);
      setUploadProgress(null);
    };
    const onRoundStart = (payload: {
      index: number;
      totalRounds: number;
      item: MediaItem;
      targetTs: number;
    }) => {
      setRound({
        index: payload.index,
        total: payload.totalRounds,
        item: payload.item,
        targetTs: payload.targetTs,
        isOwner: false,
      });
      setReveal(null);
    };
    const onYouAreOwner = (payload: { index: number }) => {
      setRound((prev) =>
        prev !== null && prev.index === payload.index ? { ...prev, isOwner: true } : prev,
      );
    };
    const onRoundReveal = (payload: RoundRevealPayload) => setReveal(payload);
    const onGameResult = (payload: GameResultPayload) => setResult(payload);
    const onError = (payload: { message: string }) => {
      showError(payload.message);
      setUploadProgress(null);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(EV.yourId, onYourId);
    socket.on(EV.roomState, onRoomState);
    socket.on(EV.yourPool, onYourPool);
    socket.on(EV.roundStart, onRoundStart);
    socket.on(EV.youAreOwner, onYouAreOwner);
    socket.on(EV.roundReveal, onRoundReveal);
    socket.on(EV.gameResult, onGameResult);
    socket.on(EV.error, onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(EV.yourId, onYourId);
      socket.off(EV.roomState, onRoomState);
      socket.off(EV.yourPool, onYourPool);
      socket.off(EV.roundStart, onRoundStart);
      socket.off(EV.youAreOwner, onYouAreOwner);
      socket.off(EV.roundReveal, onRoundReveal);
      socket.off(EV.gameResult, onGameResult);
      socket.off(EV.error, onError);
    };
  }, [socket, showError]);

  useEffect(() => {
    return () => {
      if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    };
  }, []);

  const setGuest = useCallback((name: string, avatar: string) => {
    setGuestNameState(name);
    setGuestAvatarState(avatar);
    try {
      localStorage.setItem("snap.name", name);
      localStorage.setItem("snap.avatar", avatar);
    } catch {
      // sin acceso a localStorage → no-op
    }
  }, []);

  const createRoom = useCallback(
    (name: string, avatar: string, config: RoomConfig) => {
      if (!socket.connected) socket.connect();
      socket.emit(EV.createRoom, { name, avatar, config });
    },
    [socket],
  );

  const joinRoom = useCallback(
    (code: string, name: string, avatar: string) => {
      if (!socket.connected) socket.connect();
      socket.emit(EV.joinRoom, {
        code: code.trim().toUpperCase(),
        name,
        avatar,
      });
    },
    [socket],
  );

  const startGame = useCallback(() => socket.emit(EV.startGame), [socket]);
  const setRoundDuration = useCallback(
    (roundDurationMs: number) => socket.emit(EV.setRoundDuration, { roundDurationMs }),
    [socket],
  );
  // Secuencial a propósito: un archivo en vuelo como mucho, así el pico de
  // memoria del servidor no depende del tamaño del pool.
  const uploadPool = useCallback(
    (items: UploadedItem[]) => {
      setUploadProgress({ sent: 0, total: items.length });
      void (async () => {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          if (item === undefined) continue;
          const result = await sendWithAck<UploadItemAck>((ack) => {
            socket.emit(EV.uploadItem, { index, item }, ack);
          });
          if (!result.ok) {
            setUploadProgress(null);
            showError(result.message);
            return;
          }
          setUploadProgress({ sent: index + 1, total: items.length });
        }
        const finished = await sendWithAck<FinishPoolAck>((ack) => {
          socket.emit(EV.finishPool, ack);
        });
        if (!finished.ok) {
          setUploadProgress(null);
          showError(finished.message);
        }
      })();
    },
    [socket, showError],
  );
  const acceptPool = useCallback(() => socket.emit(EV.acceptPool), [socket]);
  const playAgain = useCallback(() => socket.emit(EV.playAgain), [socket]);

  const guess = useCallback(
    (roundIndex: number, guessedPlayerId: string) => {
      socket.emit(EV.guess, { roundIndex, guessedPlayerId });
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    socket.disconnect();
    setMyId(null);
    setRoom(null);
    setPool(null);
    setPoolLoading(false);
    setUploadProgress(null);
    setRound(null);
    setReveal(null);
    setResult(null);
  }, [socket]);

  const clearError = useCallback(() => setError(null), []);

  return {
    socket,
    connected,
    myId,
    room,
    pool,
    poolLoading,
    round,
    reveal,
    result,
    error,
    errorId,
    guestName,
    guestAvatar,
    setGuest,
    createRoom,
    joinRoom,
    startGame,
    setRoundDuration,
    uploadPool,
    uploadProgress,
    acceptPool,
    guess,
    playAgain,
    leaveRoom,
    clearError,
  };
}
