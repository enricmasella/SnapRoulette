import { computeVideoPlaybackRate } from "@snaproulette/shared";
import { describe, expect, it } from "vitest";

describe("computeVideoPlaybackRate", () => {
  it("escala el vídeo para que dure exactamente la ronda", () => {
    expect(computeVideoPlaybackRate(8, 4_000)).toBe(2);
  });

  it("nunca baja de 1x", () => {
    expect(computeVideoPlaybackRate(2, 4_000)).toBe(1);
  });

  it("nunca supera 16x", () => {
    expect(computeVideoPlaybackRate(600, 3_000)).toBe(16);
  });

  it("sin duración conocida → 1x", () => {
    expect(computeVideoPlaybackRate(0, 5_000)).toBe(1);
  });

  it("duración no finita → 1x", () => {
    expect(computeVideoPlaybackRate(Number.NaN, 5_000)).toBe(1);
  });
});
