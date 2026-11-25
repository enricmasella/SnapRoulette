import { useState } from "react";

import { ROUND_DURATION_MS, computeVideoPlaybackRate } from "@snaproulette/shared";

import { Avatar, Spinner } from "../components/ui";
import { useNow } from "../lib/useNow";
import type { CurrentRound, SnapGame } from "../lib/useSnapGame";

interface GameScreenProps {
  game: SnapGame;
  round: CurrentRound;
}

export function GameScreen({ game, round }: GameScreenProps) {
  const now = useNow(250);
  const [guessedId, setGuessedId] = useState<string | null>(null);
  const [prevItemId, setPrevItemId] = useState(round.item.id);
  const [mediaError, setMediaError] = useState(false);

  if (prevItemId !== round.item.id) {
    setPrevItemId(round.item.id);
    setMediaError(false);
  }

  const { room, myId, reveal } = game;
  if (room === null || myId === null) return null;

  const remaining = Math.max(0, Math.ceil((round.targetTs - now) / 1000));
  const timeUp = now >= round.targetTs;
  const guessable = room.players;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 pt-4">
        <p className="font-display text-sm font-semibold text-muted">
          Ronda {round.index + 1}/{round.total}
        </p>
        <p
          aria-live="polite"
          className={`font-display text-lg font-bold ${remaining <= 3 ? "text-danger" : "text-lime"}`}
        >
          {timeUp ? "0s" : `${remaining}s`}
        </p>
      </header>
      <div className="mt-2 px-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            key={round.targetTs}
            className="countdown-bar h-full rounded-full bg-lime"
            style={{ animationDuration: `${Math.max(0, round.targetTs - now) / 1000}s` }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-3">
        {mediaError ? (
          <div className="flex max-h-[50dvh] w-full items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <p className="text-center">No se pudo cargar el medio</p>
          </div>
        ) : round.item.kind === "video" ? (
          <video
            key={round.item.id}
            src={round.item.url}
            muted
            loop
            autoPlay
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              video.playbackRate = computeVideoPlaybackRate(
                video.duration,
                game.room !== null ? game.room.config.roundDurationMs : ROUND_DURATION_MS,
              );
            }}
            onError={() => setMediaError(true)}
            className="max-h-[50dvh] w-full rounded-2xl object-contain"
          />
        ) : (
          <img
            src={round.item.url}
            alt="Medio a adivinar"
            onError={() => setMediaError(true)}
            className="max-h-[50dvh] w-full rounded-2xl object-contain"
          />
        )}
      </div>

      {round.isOwner && (
        <section className="px-4 pb-2 text-center">
          <p className="font-display text-base font-semibold text-lime">👀 Es TU medio</p>
          <p className="mt-0.5 text-xs text-muted">
            Vota por ti para puntuar, ¡o por otro para despistar!
          </p>
        </section>
      )}

      {reveal === null ? (
        <section className="px-4 pb-8 pt-1">
          <p className="mb-2 text-center text-sm font-medium text-muted">¿De quién es?</p>
          <div className="grid grid-cols-2 gap-2">
            {guessable.map((p) => {
              const disabled = timeUp || reveal !== null || guessedId !== null;
              const isMe = p.id === myId;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setGuessedId(p.id);
                    game.guess(round.index, p.id);
                  }}
                  className={`flex h-14 items-center gap-2 rounded-2xl border px-3 transition-colors ${
                    guessedId === p.id
                      ? "border-lime bg-lime/15 text-lime"
                      : "border-line bg-surface hover:border-muted disabled:pointer-events-none disabled:opacity-40"
                  }`}
                >
                  <Avatar emoji={p.avatar} size="sm" />
                  <span className="truncate text-sm font-semibold text-ink">
                    {p.name} {isMe && "(tú)"}
                  </span>
                </button>
              );
            })}
          </div>
          {guessedId !== null && (
            <p className="mt-3 text-center text-sm text-lime">Voto enviado ✓</p>
          )}
          {timeUp && guessedId === null && (
            <p className="mt-3 text-center text-sm text-danger">¡Tiempo agotado!</p>
          )}
        </section>
      ) : null}

      {reveal !== null && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-night/95 backdrop-blur-sm">
          <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-end px-5 pb-8 pt-12">
            <div className="text-center">
              <Avatar emoji={reveal.ownerAvatar} size="lg" />
              <h2 className="mt-3 font-display text-2xl font-bold">
                ¡Era <span className="text-lime">{reveal.ownerName}</span>!
              </h2>
            </div>
            {round.isOwner && (
              <p className="mt-2 text-center text-sm text-lime">+50 por ser el dueño ✓</p>
            )}
            <ul className="mt-5 space-y-2">
              {reveal.guesses.length === 0 ? (
                <li className="rounded-xl border border-line bg-surface px-3 py-2 text-center text-sm text-muted">
                  Nadie votó a tiempo 👻
                </li>
              ) : (
                reveal.guesses.map((g) => (
                  <li
                    key={g.playerId}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                      g.correct ? "border-lime bg-lime/10" : "border-line bg-surface"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar emoji={g.avatar} size="sm" />
                      <span className="truncate text-sm font-medium text-ink">{g.playerName}</span>
                      <span aria-hidden="true" className={g.correct ? "text-lime" : "text-danger"}>
                        {g.correct ? "✓" : "✗"}
                      </span>
                    </span>
                    <span className="font-display text-sm font-semibold text-muted">
                      +{g.points}
                    </span>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-6 flex items-center justify-center gap-2 pb-2 text-sm text-muted">
              <Spinner /> Siguiente ronda…
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
