import { randomUUID } from "node:crypto";

import { MAX_MEDIA_STORE_BYTES, MAX_UPLOAD_BYTES } from "@snaproulette/shared";

export class MediaTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaTooLargeError";
  }
}

export class MediaStoreFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaStoreFullError";
  }
}

interface StoredMedia {
  buffer: Buffer;
  contentType: string;
}

export interface StoredMediaRef {
  id: string;
  url: string;
  thumbUrl?: string;
}

/** Almacén en memoria de medios subidos por los jugadores, servidos por HTTP. */
export class MediaStore {
  private readonly items = new Map<string, StoredMedia>();
  private readonly thumbs = new Map<string, StoredMedia>();
  private totalBytes = 0;

  add(data: Buffer, contentType: string, thumb?: Buffer): StoredMediaRef {
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new MediaTooLargeError(`El archivo supera el límite de ${MAX_UPLOAD_BYTES} bytes`);
    }
    const thumbBytes = thumb !== undefined ? thumb.length : 0;
    const incomingBytes = data.length + thumbBytes;
    if (this.totalBytes + incomingBytes > MAX_MEDIA_STORE_BYTES) {
      throw new MediaStoreFullError("Almacén de medios lleno");
    }

    const id = randomUUID();
    this.items.set(id, { buffer: data, contentType });
    this.totalBytes += data.length;
    if (thumb !== undefined) {
      this.thumbs.set(id, { buffer: thumb, contentType: "image/jpeg" });
      this.totalBytes += thumb.length;
    }
    return {
      id,
      url: `/media/${id}`,
      ...(thumb !== undefined ? { thumbUrl: `/media/${id}/thumb` } : {}),
    };
  }

  /** Número de medios guardados (para métricas y tests). */
  get count(): number {
    return this.items.size;
  }

  /** Bytes totales ocupados, incluidos thumbnails (para métricas y tests). */
  get bytes(): number {
    return this.totalBytes;
  }

  remove(id: string): void {
    const item = this.items.get(id);
    if (item !== undefined) {
      this.totalBytes -= item.buffer.length;
      this.items.delete(id);
    }
    const thumb = this.thumbs.get(id);
    if (thumb !== undefined) {
      this.totalBytes -= thumb.buffer.length;
      this.thumbs.delete(id);
    }
  }

  removeMany(ids: Iterable<string>): void {
    for (const id of ids) {
      this.remove(id);
    }
  }

  get(id: string): StoredMedia | undefined {
    return this.items.get(id);
  }

  getThumb(id: string): StoredMedia | undefined {
    return this.thumbs.get(id);
  }
}
