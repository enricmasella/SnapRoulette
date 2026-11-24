import { ROUND_DURATION_MS } from "@snaproulette/shared";
import { describe, expect, it } from "vitest";
import {
  BASE_CORRECT,
  type RoundItem,
  SPEED_MAX_BONUS,
  buildRounds,
  scoreFor,
} from "../src/game/logic.js";

function fakeItem(id: string) {
  return { id, kind: "photo" as const, url: `https://x.test/${id}` };
}

describe("buildRounds", () => {
  const poolOf = (maps: Array<[string, string[]]>) =>
    new Map(maps.map(([player, ids]) => [player, ids.map(fakeItem)]));

  it("mezcla todas las pools y toma solo `rounds`", () => {
    const pools = poolOf([
      ["a", ["a1", "a2", "a3"]],
      ["b", ["b1", "b2", "b3"]],
    ]);
    const rounds = buildRounds(pools, 4);
    expect(rounds).toHaveLength(4);
    expect(new Set(rounds.map((r) => r.item.id)).size).toBe(4);
  });

  it("respeta el dueño de cada item", () => {
    const pools = poolOf([
      ["a", ["a1"]],
      ["b", ["b1"]],
    ]);
    const rounds = buildRounds(pools, 10);
    for (const round of rounds) {
      if (round.item.id === "a1") {
        expect(round.ownerId).toBe("a");
      } else {
        expect(round.ownerId).toBe("b");
      }
    }
  });

  it("deduplica por id: un medio repetido en dos pools no sale dos veces", () => {
    const pools = poolOf([
      ["a", ["x", "a2"]],
      ["b", ["x", "b2"]],
    ]);
    const rounds = buildRounds(pools, 10);
    const xRounds = rounds.filter((r: RoundItem) => r.item.id === "x");
    expect(xRounds).toHaveLength(1);
  });

  it("con pools vacías devuelve lista vacía", () => {
    expect(buildRounds(new Map(), 5)).toEqual([]);
  });

  it("distribuye las rondas equitativamente entre los jugadores", () => {
    const pools = poolOf([
      ["player-a", ["a1", "a2", "a3", "a4", "a5"]],
      ["player-b", ["b1", "b2", "b3", "b4", "b5"]],
    ]);
    const rounds = buildRounds(pools, 6);
    expect(rounds).toHaveLength(6);
    const countA = rounds.filter((r) => r.ownerId === "player-a").length;
    const countB = rounds.filter((r) => r.ownerId === "player-b").length;
    expect(countA).toBe(3);
    expect(countB).toBe(3);
  });
});

describe("scoreFor", () => {
  it("fallo → 0 puntos", () => {
    expect(scoreFor(false, 3_000, ROUND_DURATION_MS)).toBe(0);
  });

  it("acierto en el último instante → puntos base sin bonus", () => {
    expect(scoreFor(true, 0, ROUND_DURATION_MS)).toBe(BASE_CORRECT);
  });

  it("acierto inmediato al empezar la ronda → base + bonus máximo", () => {
    expect(scoreFor(true, ROUND_DURATION_MS, ROUND_DURATION_MS)).toBe(
      BASE_CORRECT + SPEED_MAX_BONUS,
    );
  });

  it("bonus proporcional al tiempo restante", () => {
    const mid = ROUND_DURATION_MS / 2;
    expect(scoreFor(true, mid, ROUND_DURATION_MS)).toBe(BASE_CORRECT + SPEED_MAX_BONUS / 2);
  });

  it("nunca da bonus si el tiempo ya expiró", () => {
    expect(scoreFor(true, -1_000, ROUND_DURATION_MS)).toBe(BASE_CORRECT);
  });

  it("usa la duración pasada para el bonus", () => {
    expect(scoreFor(true, 2_500, 10_000)).toBe(125);
  });
});
