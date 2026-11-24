import {
  createRoomPayloadSchema,
  joinRoomPayloadSchema,
  roomConfigSchema,
  uploadItemPayloadSchema,
} from "@snaproulette/shared";
import { describe, expect, it } from "vitest";

const config = { mode: "photos" as const, rounds: 10, roundDurationMs: 5_000 };

describe("schemas de entrada del servidor", () => {
  it("acepta una sala válida", () => {
    const parsed = createRoomPayloadSchema.safeParse({ name: "Enric", avatar: "🦊", config });
    expect(parsed.success).toBe(true);
  });

  it("rechaza rondas fuera de rango", () => {
    const parsed = createRoomPayloadSchema.safeParse({
      name: "Enric",
      avatar: "🦊",
      config: { ...config, rounds: 2 },
    });
    expect(parsed.success).toBe(false);
  });

  it("normaliza el código de sala a mayúsculas y sin espacios", () => {
    const parsed = joinRoomPayloadSchema.safeParse({
      code: " ab3de ",
      name: "Enric",
      avatar: "🦊",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.code).toBe("AB3DE");
  });

  it("aplica la duración por defecto y rechaza duraciones imposibles", () => {
    const withDefault = roomConfigSchema.safeParse({ mode: "mixed", rounds: 5 });
    expect(withDefault.success).toBe(true);
    expect(withDefault.data?.roundDurationMs).toBe(5_000);

    expect(
      roomConfigSchema.safeParse({ mode: "mixed", rounds: 5, roundDurationMs: 500 }).success,
    ).toBe(false);
  });

  it("limita el índice del archivo a las 12 posiciones del pool", () => {
    const item = { kind: "photo" as const, data: "data:image/jpeg;base64,AAAA" };
    expect(uploadItemPayloadSchema.safeParse({ index: 11, item }).success).toBe(true);
    expect(uploadItemPayloadSchema.safeParse({ index: 12, item }).success).toBe(false);
    expect(uploadItemPayloadSchema.safeParse({ index: -1, item }).success).toBe(false);
    expect(
      uploadItemPayloadSchema.safeParse({ index: 0, item: { kind: "photo", data: "" } }).success,
    ).toBe(false);
  });
});
