import { describe, expect, it } from "vitest";

import { detectMediaType, getMimeType } from "../src/media/sniff.js";

describe("detectMediaType", () => {
  it("should detect JPEG", () => {
    const buffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    ]);
    expect(detectMediaType(buffer)).toBe("jpeg");
  });

  it("should detect PNG", () => {
    // Magic bytes for PNG: 89 50 4E 47 0D 0A 1A 0A
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    expect(detectMediaType(buffer)).toBe("png");
  });

  it("should detect GIF87a", () => {
    const buffer = Buffer.from(
      "GIF87a" +
        "\x01\x00\x01\x00\x80\x00\x00\xFF\xFF\xFF\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02L\x01\x00;",
    );
    expect(detectMediaType(buffer)).toBe("gif");
  });

  it("should detect GIF89a", () => {
    const buffer = Buffer.from(
      "GIF89a" +
        "\x01\x00\x01\x00\x80\x00\x00\xFF\xFF\xFF\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02L\x01\x00;",
    );
    expect(detectMediaType(buffer)).toBe("gif");
  });

  it("should detect WebP", () => {
    // RIFF....WEBP (bytes 0-3 y 8-11)
    const buffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00,
      0x00,
    ]);
    expect(detectMediaType(buffer)).toBe("webp");
  });

  it("should detect MP4 (isom brand)", () => {
    // ....ftypisom....
    const buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00,
      0x01,
    ]);
    expect(detectMediaType(buffer)).toBe("mp4");
  });

  it("should detect MP4 (mp42 brand)", () => {
    // ....ftypmp42....
    const buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00,
      0x01,
    ]);
    expect(detectMediaType(buffer)).toBe("mp4");
  });

  it.each(["mp41", "avc1", "iso5", "iso6", "M4V ", "MSNV"])(
    "should detect MP4 with the %s brand (Android/iPhone)",
    (brand) => {
      const buffer = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70]),
        Buffer.from(brand, "ascii"),
      ]);
      expect(detectMediaType(buffer)).toBe("mp4");
    },
  );

  it("should detect WebM (EBML)", () => {
    // EBML: 1A 45 DF A3
    const buffer = Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(detectMediaType(buffer)).toBe("webm");
  });

  it("should detect MOV (qt  brand)", () => {
    // ....ftypqt  ....
    const buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0x00, 0x00, 0x00,
      0x01,
    ]);
    expect(detectMediaType(buffer)).toBe("mov");
  });

  it("should detect AVIF (avif brand)", () => {
    // ....ftypavif....
    const buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00,
      0x01,
    ]);
    expect(detectMediaType(buffer)).toBe("avif");
  });

  it("should return null for plain text", () => {
    const buffer = Buffer.from("hello world");
    expect(detectMediaType(buffer)).toBeNull();
  });

  it("should return null for HTML", () => {
    const buffer = Buffer.from("<!DOCTYPE html><p>hello</p>");
    expect(detectMediaType(buffer)).toBeNull();
  });

  it("should return null for JSON", () => {
    const buffer = Buffer.from('{ "key": "value" }');
    expect(detectMediaType(buffer)).toBeNull();
  });

  it("should return null for short buffers", () => {
    const buffer = Buffer.from([0x01, 0x02, 0x03]);
    expect(detectMediaType(buffer)).toBeNull();
  });
});

describe("getMimeType", () => {
  it("should return correct MIME type for jpeg", () => {
    expect(getMimeType("jpeg")).toBe("image/jpeg");
  });

  it("should return correct MIME type for png", () => {
    expect(getMimeType("png")).toBe("image/png");
  });

  it("should return correct MIME type for gif", () => {
    expect(getMimeType("gif")).toBe("image/gif");
  });

  it("should return correct MIME type for webp", () => {
    expect(getMimeType("webp")).toBe("image/webp");
  });

  it("should return correct MIME type for mp4", () => {
    expect(getMimeType("mp4")).toBe("video/mp4");
  });

  it("should return correct MIME type for webm", () => {
    expect(getMimeType("webm")).toBe("video/webm");
  });

  it("should return correct MIME type for mov", () => {
    expect(getMimeType("mov")).toBe("video/quicktime");
  });

  it("should return correct MIME type for avif", () => {
    expect(getMimeType("avif")).toBe("image/avif");
  });
});
