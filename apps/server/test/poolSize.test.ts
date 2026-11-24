import { poolSizeFor } from "@snaproulette/shared";
import { describe, expect, it } from "vitest";

describe("poolSizeFor", () => {
  it("garantiza un mínimo de 3 por jugador", () => {
    expect(poolSizeFor(3, 10)).toBe(3);
    expect(poolSizeFor(5, 10)).toBe(3);
  });

  it("escala con las rondas y el número de jugadores", () => {
    expect(poolSizeFor(10, 4)).toBe(5);
    expect(poolSizeFor(10, 2)).toBe(7);
    expect(poolSizeFor(20, 3)).toBe(9);
  });
});
