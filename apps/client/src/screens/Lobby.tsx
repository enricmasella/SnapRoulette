import { useEffect, useState } from "react";

import { ROUND_DURATION_MS, type RoomState } from "@snaproulette/shared";

import { Avatar, Button, Logo } from "../components/ui";
import type { SnapGame } from "../lib/useSnapGame";

const MODE_LABEL: Record<RoomState["config"]["mode"], string> = {
  photos: "📷 Fotos",
  videos: "🎬 Vídeos",
  mixed: "🎲 Mixto",
};

export function LobbyScreen({ game }: { game: SnapGame }) {
  const { room, myId } = game;
  const [copied, setCopied] = useState(false);
  const [durationSec, setDurationSec] = useState(ROUND_DURATION_MS / 1000);

  useEffect(() => {
    if (room !== null) setDurationSec(room.config.roundDurationMs / 1000);
  }, [room]);

  if (room === null || myId === null) return null;

  const isHost = room.hostId === myId;
  const canStart = room.players.length >= 2;

  const shareRoom = async () => {
    const url = `${window.location.origin}/?room=${room.code}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "SnapRoulette",
          text: `¡Únete a mi partida de SnapRoulette! Código: ${room.code}`,
          url,
        });
        return;
      } catch {
        // usuario canceló o share no disponible -> fallback a clipboard
      }
    }
    await copyCode();
  };

  const copyCode = async () => {
    const url = `${window.location.origin}/?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      try {
        await navigator.clipboard.writeText(room.code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      } catch {
        // clipboard no disponible → no-op
      }
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-8">
      <header>
        <Logo className="text-xl" />
      </header>

      <section className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Código de sala</p>
        <div className="mt-1 flex items-center justify-center gap-3">
          <p className="font-display text-5xl font-bold tracking-[0.25em] text-lime">{room.code}</p>
          <button
            type="button"
            onClick={copyCode}
            aria-label="Copiar código o enlace"
            title="Copiar enlace"
            className="text-muted transition-colors hover:text-ink"
          >
            {copied ? "✓" : "📋"}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-center">
          <Button
            variant="ghost"
            onClick={shareRoom}
            className="!h-9 !px-4 text-xs font-medium text-lime"
          >
            {copied ? "✓ Enlace copiado" : "🔗 Compartir enlace"}
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted">
          {MODE_LABEL[room.config.mode]} · {room.config.rounds} rondas ·{" "}
          {Math.round(room.config.roundDurationMs / 1000)}s por ronda
        </p>
      </section>

      <section aria-label="Jugadores">
        <h2 className="mb-2 font-display text-lg font-semibold">
          Jugadores ({room.players.length}/10)
        </h2>
        <ul className="grid grid-cols-2 gap-2">
          {room.players.map((p) => (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded-xl border border-line bg-surface p-2 ${
                p.connected ? "" : "opacity-40"
              }`}
            >
              <Avatar emoji={p.avatar} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {p.name}
                  {p.id === myId ? " (tú)" : ""}
                </span>
                <span className="block text-xs text-muted">
                  {p.isHost ? "👑 Host" : p.connected ? "Listo" : "Desconectado"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-auto flex flex-col gap-3">
        {isHost ? (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label
                  htmlFor="round-duration"
                  className="text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  Duración por ronda
                </label>
                <span className="font-display text-sm font-semibold text-lime">{durationSec}s</span>
              </div>
              <input
                id="round-duration"
                type="range"
                min={3}
                max={15}
                step={1}
                value={durationSec}
                onChange={(event) => {
                  const seconds = Number(event.target.value);
                  setDurationSec(seconds);
                  game.setRoundDuration(seconds * 1000);
                }}
                className="w-full accent-lime"
              />
            </div>
            <Button onClick={game.startGame} disabled={!canStart}>
              {canStart ? "Empezar partida" : "Esperando jugadores…"}
            </Button>
          </>
        ) : (
          <p className="text-center text-sm text-muted">Esperando a que el host empiece…</p>
        )}
        <Button variant="ghost" onClick={game.leaveRoom}>
          Salir
        </Button>
      </section>
    </main>
  );
}
