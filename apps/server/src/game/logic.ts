import type { MediaItem } from "@snaproulette/shared";
import { shuffle } from "../util/random.js";

export interface RoundItem {
  item: MediaItem;
  ownerId: string;
}

/**
 * Construye las rondas de la partida: intercala equitativamente las pools
 * de todos los jugadores (deduplicando por id de medio) para que ningún
 * jugador quede sobre o sub-representado, y finalmente baraja las rondas elegidas.
 */
export function buildRounds(pools: ReadonlyMap<string, MediaItem[]>, rounds: number): RoundItem[] {
  const seen = new Set<string>();
  const playerItems = new Map<string, RoundItem[]>();

  for (const [ownerId, pool] of pools) {
    const list: RoundItem[] = [];
    for (const item of pool) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      list.push({ item, ownerId });
    }
    if (list.length > 0) {
      playerItems.set(ownerId, shuffle(list));
    }
  }

  const all: RoundItem[] = [];
  const playerIds = shuffle(Array.from(playerItems.keys()));
  let hasMore = true;
  while (hasMore && all.length < rounds) {
    hasMore = false;
    for (const pid of playerIds) {
      const items = playerItems.get(pid);
      if (items !== undefined && items.length > 0) {
        const popped = items.pop();
        if (popped !== undefined) {
          all.push(popped);
          hasMore = true;
          if (all.length >= rounds) break;
        }
      }
    }
  }

  return shuffle(all).slice(0, rounds);
}

export const OWNER_BONUS = 50;
export const BASE_CORRECT = 100;
export const SPEED_MAX_BONUS = 100;

/**
 * Puntos de una adivinanza: acierto = 100 + bonus de velocidad (hasta 100).
 * El bonus escala con el tiempo restante sobre la duración de la ronda.
 */
export function scoreFor(correct: boolean, remainingMs: number, roundDurationMs: number): number {
  if (!correct) return 0;
  const clamped = Math.min(Math.max(remainingMs, 0), roundDurationMs);
  const bonus = Math.round((clamped / roundDurationMs) * SPEED_MAX_BONUS);
  return BASE_CORRECT + bonus;
}
