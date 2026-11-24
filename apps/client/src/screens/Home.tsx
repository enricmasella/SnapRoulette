import { useEffect, useState } from "react";

import { type GameMode, ROUND_DURATION_MS, type RoomConfig } from "@snaproulette/shared";

import { Button, Card, Logo, TextInput } from "../components/ui";
import { AVATARS, type SnapGame } from "../lib/useSnapGame";

const MODES: { value: GameMode; label: string }[] = [
  { value: "photos", label: "📷 Fotos" },
  { value: "videos", label: "🎬 Vídeos" },
  { value: "mixed", label: "🎲 Mixto" },
];

export function HomeScreen({ game }: { game: SnapGame }) {
  const [name, setName] = useState(game.guestName);
  const [avatar, setAvatar] = useState(game.guestAvatar);
  const [code, setCode] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return (params.get("room") || params.get("code") || "").trim().toUpperCase().slice(0, 5);
  });
  const [mode, setMode] = useState<GameMode>("mixed");
  const [rounds, setRounds] = useState(10);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const nameOk = name.trim().length > 0;
  const codeOk = code.trim().length >= 4;

  useEffect(() => {
    if (game.room !== null) setBusy(null);
  }, [game.room]);

  // Si el servidor rechaza la acción (sala inexistente, límite de salas…) no
  // llega `room`, así que sin esto el botón queda en "Entrando…" para siempre.
  useEffect(() => {
    if (game.errorId > 0) setBusy(null);
  }, [game.errorId]);

  const saveGuest = (n: string, a: string) => game.setGuest(n.trim().slice(0, 20), a);

  const onCreate = () => {
    if (!nameOk || !game.connected || busy !== null) return;
    const cleanName = name.trim().slice(0, 20);
    saveGuest(cleanName, avatar);
    setBusy("create");
    const config: RoomConfig = { mode, rounds, roundDurationMs: ROUND_DURATION_MS };
    game.createRoom(cleanName, avatar, config);
  };

  const onJoin = () => {
    if (!nameOk || !codeOk || !game.connected || busy !== null) return;
    const cleanName = name.trim().slice(0, 20);
    saveGuest(cleanName, avatar);
    setBusy("join");
    game.joinRoom(code, cleanName, avatar);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10">
      <header className="text-center">
        <Logo className="text-5xl" />
        <p className="mt-3 text-sm text-muted">Adivina de quién es cada foto y vídeo</p>
      </header>

      <section aria-label="Tu perfil">
        <Card className="flex flex-col gap-4 p-4">
          <div>
            <label
              htmlFor="guest-name"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Tu nombre
            </label>
            <TextInput
              id="guest-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={20}
              placeholder="¿Cómo te llamas?"
              autoComplete="nickname"
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Tu avatar
            </p>
            <fieldset className="flex flex-wrap gap-2" aria-label="Elige avatar">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAvatar(a)}
                  aria-pressed={avatar === a}
                  className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition-colors ${
                    avatar === a ? "bg-lime" : "bg-surface-2 hover:bg-surface"
                  }`}
                >
                  {a}
                </button>
              ))}
            </fieldset>
          </div>
        </Card>
      </section>

      <section aria-label="Crear sala">
        <Card className="flex flex-col gap-4 p-4">
          <h2 className="font-display text-lg font-semibold">Crear sala</h2>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Modo</p>
            <fieldset className="grid grid-cols-3 gap-2" aria-label="Modo de juego">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  aria-pressed={mode === m.value}
                  className={`h-12 rounded-xl border text-sm font-semibold transition-colors ${
                    mode === m.value
                      ? "border-lime bg-lime/10 text-lime"
                      : "border-line bg-surface-2 text-ink hover:border-muted"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </fieldset>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="rounds"
                className="text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Rondas
              </label>
              <span className="font-display text-sm font-semibold text-lime">{rounds}</span>
            </div>
            <input
              id="rounds"
              type="range"
              min={3}
              max={20}
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value))}
              className="w-full accent-lime"
            />
          </div>
          <Button onClick={onCreate} disabled={!nameOk || !game.connected || busy !== null}>
            {busy === "create" ? "Creando…" : "Crear partida"}
          </Button>
        </Card>
      </section>

      <section aria-label="Unirse a una sala">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="font-display text-lg font-semibold">Unirse</h2>
          <TextInput
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={6}
            placeholder="Código de sala"
            autoCapitalize="characters"
            autoComplete="off"
          />
          <Button
            variant="ghost"
            onClick={onJoin}
            disabled={!nameOk || !codeOk || !game.connected || busy !== null}
          >
            {busy === "join" ? "Entrando…" : "Entrar con código"}
          </Button>
        </Card>
      </section>

      <footer className="flex items-center justify-center gap-2 pb-4 text-xs text-muted">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${game.connected ? "bg-lime" : "bg-danger"}`}
        />
        {game.connected ? "Conectado" : "Sin conexión con el servidor"}
      </footer>
    </main>
  );
}
