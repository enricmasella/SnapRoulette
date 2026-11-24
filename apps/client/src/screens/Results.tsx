import { Avatar, Button, Logo } from "../components/ui";
import type { SnapGame } from "../lib/useSnapGame";

const MEDALS = ["🥇", "🥈", "🥉"];

export function ResultsScreen({ game }: { game: SnapGame }) {
  const { room, myId, result } = game;

  if (room === null || result === null) return null;

  const champion = result.standings[0];
  const isHost = room.hostId === myId;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-8">
      <header>
        <Logo className="text-xl" />
      </header>

      {champion !== undefined && (
        <section className="rounded-2xl border border-lime bg-lime/10 p-5 text-center">
          <p className="text-4xl" aria-hidden="true">
            👑
          </p>
          <div className="mt-2 flex justify-center">
            <Avatar emoji={champion.avatar} size="lg" />
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold text-lime">{champion.name}</h2>
          <p className="text-sm text-muted">Campeón con {champion.score} puntos</p>
        </section>
      )}

      <section aria-label="Clasificación">
        <h2 className="mb-2 font-display text-lg font-semibold">Clasificación</h2>
        <ol className="flex flex-col gap-2">
          {result.standings.map((p, index) => (
            <li
              key={p.playerId}
              className={`flex items-center gap-3 rounded-xl border border-line bg-surface p-3 ${
                p.playerId === myId ? "border-lime" : ""
              }`}
            >
              <span className="w-8 text-center font-display text-lg font-bold">
                {MEDALS[index] ?? index + 1}
              </span>
              <Avatar emoji={p.avatar} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {p.name}
                {p.playerId === myId ? " (tú)" : ""}
              </span>
              <span className="font-display text-base font-bold text-lime">{p.score}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-auto flex flex-col gap-3">
        {isHost ? (
          <Button onClick={game.playAgain}>Jugar de nuevo</Button>
        ) : (
          <p className="text-center text-sm text-muted">Esperando a que el host reinicie…</p>
        )}
        <Button variant="ghost" onClick={game.leaveRoom}>
          Salir
        </Button>
      </section>
    </main>
  );
}
