import { MAX_UPLOAD_BYTES } from "@snaproulette/shared";
import { describe, expect, it } from "vitest";
import { MediaStore, MediaTooLargeError } from "../src/media/store.js";

describe("MediaStore", () => {
  it("guarda y recupera un medio", () => {
    const store = new MediaStore();
    const added = store.add(Buffer.from("hola"), "image/png");
    const stored = store.get(added.id);
    expect(stored?.buffer.toString()).toBe("hola");
    expect(stored?.contentType).toBe("image/png");
    expect(added.url).toBe(`/media/${added.id}`);
  });

  it("guarda y recupera un thumbnail", () => {
    const store = new MediaStore();
    const added = store.add(Buffer.from("data"), "video/mp4", Buffer.from("thumb"));
    const thumb = store.getThumb(added.id);
    expect(thumb?.buffer.toString()).toBe("thumb");
    expect(thumb?.contentType).toBe("image/jpeg");
    expect(added.thumbUrl).toBe(`/media/${added.id}/thumb`);
  });

  it("lanza si el medio supera MAX_UPLOAD_BYTES", () => {
    const store = new MediaStore();
    expect(() => store.add(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "image/png")).toThrow(
      MediaTooLargeError,
    );
  });

  it("get de id inexistente → undefined", () => {
    const store = new MediaStore();
    expect(store.get("no-existe")).toBeUndefined();
    expect(store.getThumb("no-existe")).toBeUndefined();
  });
});
