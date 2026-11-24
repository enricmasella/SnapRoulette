import { ErrorToast, Spinner } from "./components/ui";
import { useSnapGame } from "./lib/useSnapGame";
import { GameScreen } from "./screens/Game";
import { HomeScreen } from "./screens/Home";
import { LobbyScreen } from "./screens/Lobby";
import { PoolReviewScreen } from "./screens/PoolReview";
import { ResultsScreen } from "./screens/Results";

export default function App() {
  const game = useSnapGame();
  const phase = game.room?.phase;

  return (
    <div className="min-h-dvh">
      {game.error !== null && <ErrorToast message={game.error} onClose={game.clearError} />}
      {phase === undefined && <HomeScreen game={game} />}
      {phase === "lobby" && <LobbyScreen game={game} />}
      {phase === "pools" && <PoolReviewScreen game={game} />}
      {phase === "playing" && game.round !== null && (
        <GameScreen key={game.round.index} game={game} round={game.round} />
      )}
      {phase === "playing" && game.round === null && (
        <div className="flex min-h-dvh items-center justify-center">
          <Spinner />
        </div>
      )}
      {phase === "results" && <ResultsScreen game={game} />}
    </div>
  );
}
