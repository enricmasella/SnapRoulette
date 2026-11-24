import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { poolSizeFor } from "@snaproulette/shared";
import type { GameMode, MediaItem, UploadedItem } from "@snaproulette/shared";

import { Lightbox } from "../components/Lightbox";
import { MediaTile } from "../components/MediaTile";
import { Button, Logo, Spinner } from "../components/ui";
import { usePhotoPool } from "../lib/usePhotoPool";
import type { SnapGame } from "../lib/useSnapGame";

const ACCEPT_BY_MODE: Record<GameMode, string> = {
  photos: "image/*,image/heic,image/heif",
  videos: "video/*",
  mixed: "image/*,video/*,image/heic,image/heif",
};

/** Archivo convertido y aún no subido: se ve en la rejilla local. */
interface PreviewItem {
  id: string;
  kind: UploadedItem["kind"];
  url: string;
  thumbUrl?: string;
}

function isHeic(file: File): boolean {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("No se pudo leer el archivo"));
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(blob);
  });
}

function videoThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = objectUrl;
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    video.onloadeddata = () => {
      try {
        video.currentTime = 0.1;
      } catch {
        // algunos navegadores lanzan al buscar antes de tener metadata
      }
    };
    video.onseeked = () => {
      try {
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          throw new Error("vídeo sin dimensiones");
        }
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("sin contexto de canvas");
        ctx.drawImage(video, 0, 0);
        cleanup();
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error("No se pudo generar la miniatura"));
      }
    };
    video.onerror = () => {
      cleanup();
      reject(new Error(`No se pudo generar la miniatura de ${file.name}`));
    };
  });
}

async function fileToUploadedItem(file: File): Promise<UploadedItem> {
  const isVideo = file.type.startsWith("video/");
  const kind = isVideo ? "video" : "photo";
  let data: string;
  if (isHeic(file)) {
    try {
      // Import dinámico: heic2any pesa ~2,7 MB y solo se usa si el usuario
      // elige un HEIC. Estático inflaba el bundle inicial (447 KB gzip).
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      if (blob === undefined) throw new Error("conversión vacía");
      data = await blobToDataUrl(blob);
    } catch {
      throw new Error(`No se pudo convertir ${file.name} (HEIC). Prueba con otro archivo.`);
    }
  } else {
    data = await blobToDataUrl(file);
  }
  let thumbData: string | undefined;
  if (isVideo) {
    thumbData = await videoThumbnail(file);
  }
  return {
    kind,
    data,
    ...(thumbData !== undefined ? { thumbData } : {}),
  };
}

function toPreviewItem(item: UploadedItem, file: File | undefined, index: number): PreviewItem {
  return {
    id: file === undefined ? `preview-${index}` : `${index}-${file.name}-${file.size}`,
    kind: item.kind,
    url: item.data,
    ...(item.thumbData !== undefined ? { thumbUrl: item.thumbData } : {}),
  };
}

function toMediaItem(item: PreviewItem): MediaItem {
  return {
    id: item.id,
    kind: item.kind,
    url: item.url,
    ...(item.thumbUrl !== undefined ? { thumbUrl: item.thumbUrl } : {}),
  };
}

function toUploadedItem(item: PreviewItem): UploadedItem {
  return {
    kind: item.kind,
    data: item.url,
    ...(item.thumbUrl !== undefined ? { thumbData: item.thumbUrl } : {}),
  };
}

export function PoolReviewScreen({ game }: { game: SnapGame }) {
  const { room, pool, myId } = game;
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [converting, setConverting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const mode: GameMode = room?.config.mode ?? "mixed";
  const required = room === null ? 0 : poolSizeFor(room.config.rounds, room.players.length);
  const photoPool = usePhotoPool({ size: required, accept: ACCEPT_BY_MODE[mode], mode });

  const previewMedia = useMemo(() => (preview ?? []).map((item) => toMediaItem(item)), [preview]);

  useEffect(() => {
    if (photoPool.status !== "ready") return;
    const files = photoPool.selected;
    let cancelled = false;
    setConverting(true);
    const convert = async (): Promise<void> => {
      const items = await Promise.all(files.map(fileToUploadedItem));
      if (cancelled) return;
      setPreview(items.map((item, index) => toPreviewItem(item, files[index], index)));
      setConverting(false);
    };
    convert().catch((error: unknown) => {
      if (cancelled) return;
      setPreview(null);
      setConverting(false);
      setLocalError(
        error instanceof Error ? error.message : "No se pudieron procesar los archivos",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [photoPool.status, photoPool.selected]);

  useEffect(() => {
    if (pool !== null) setSubmitting(false);
  }, [pool]);

  // Si la subida falla (ACK con error o timeout), el hook emite errorId y la
  // pantalla vuelve al preview en vez de quedarse en "Subiendo tu pool…".
  useEffect(() => {
    if (game.errorId === 0) return;
    setSubmitting(false);
    setSubmitted(false);
  }, [game.errorId]);

  if (room === null) return null;

  const ready = room.players.filter((p) => p.poolReady).length;
  const total = room.players.length;
  const iAmReady = room.players.some((p) => p.id === myId && p.poolReady);
  const modeNoun =
    room.config.mode === "photos"
      ? "fotos"
      : room.config.mode === "videos"
        ? "vídeos"
        : "fotos o vídeos";
  const busyCopy =
    photoPool.status === "granting"
      ? "Pidiendo acceso a tus fotos…"
      : photoPool.status === "reading"
        ? "Leyendo tu carpeta…"
        : "Preparando tu pool…";

  const onFallbackFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setLocalError(null);
    photoPool.ingest(files);
  };

  const enterWithPool = () => {
    if (preview === null || submitting || converting) return;
    setLocalError(null);
    setSubmitting(true);
    setSubmitted(true);
    game.uploadPool(preview.map(toUploadedItem));
  };

  const changeMind = async () => {
    setLocalError(null);
    setSubmitted(false);
    await photoPool.grant();
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-8">
      <header className="flex items-center justify-between">
        <Logo className="text-xl" />
        <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
          {ready}/{total} listos
        </span>
      </header>

      <input
        ref={photoPool.fallbackRef}
        type="file"
        accept={ACCEPT_BY_MODE[mode]}
        multiple
        hidden
        onChange={onFallbackFiles}
      />

      <section>
        <h2 className="font-display text-lg font-semibold">Tu pool</h2>
        <p className="text-sm text-muted">
          {submitted
            ? "Se subirán a la partida y podrán caer en las rondas."
            : preview !== null
              ? `Tu pool de ${required} ${modeNoun}. Todavía no se ha subido nada: cuando te gusten, entra con ellas.`
              : `Da acceso a tus fotos y elegiremos ${required} ${modeNoun} de tu dispositivo al azar.`}
        </p>
      </section>

      {!submitted ? (
        photoPool.status === "granting" || photoPool.status === "reading" ? (
          <section className="flex flex-col items-center gap-3 py-10">
            <Spinner />
            <p className="text-sm text-muted">{busyCopy}</p>
          </section>
        ) : preview !== null ? (
          <>
            <div className="grid grid-cols-2 gap-2" aria-label="Tu pool">
              {previewMedia.map((item, index) => (
                <div key={item.id} className="relative">
                  <MediaTile item={item} onClick={() => setLightboxItem(item)} />
                  <button
                    type="button"
                    aria-label="Cambiar esta foto"
                    disabled={converting}
                    onClick={() => photoPool.rerollOne(index)}
                    className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink shadow disabled:opacity-40"
                  >
                    🎲
                  </button>
                </div>
              ))}
            </div>

            <section className="mt-auto flex flex-col gap-2 pb-2">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={photoPool.rerollAll}
                  disabled={converting}
                >
                  🎲 Otras fotos
                </Button>
                <Button
                  className="flex-1"
                  onClick={enterWithPool}
                  disabled={submitting || converting}
                >
                  Entrar con esa
                </Button>
              </div>
              {localError !== null && (
                <p className="text-center text-sm text-danger">{localError}</p>
              )}
            </section>
          </>
        ) : converting ? (
          <section className="flex flex-col items-center gap-3 py-10">
            <Spinner />
            <p className="text-sm text-muted">{busyCopy}</p>
          </section>
        ) : (
          <section className="flex flex-col items-center gap-4 py-8">
            <div className="flex w-full flex-col gap-3">
              <Button onClick={photoPool.grant} className="w-full">
                📁 Dar acceso a una carpeta
              </Button>
              <Button variant="ghost" onClick={photoPool.openFilesPicker} className="w-full">
                📸 Elegir fotos / vídeos del dispositivo
              </Button>
            </div>
            <p className="text-center text-xs text-muted">
              Puedes dar acceso a una carpeta para que el juego elija {required} {modeNoun} al azar,
              o seleccionar archivos directamente desde tu galería. Solo se suben las que aceptes.
            </p>
            {photoPool.error !== null && (
              <p className="text-center text-sm text-danger">{photoPool.error}</p>
            )}
            {localError !== null && <p className="text-center text-sm text-danger">{localError}</p>}
          </section>
        )
      ) : pool === null ? (
        <section className="flex flex-col items-center gap-3 py-10">
          <Spinner />
          <p className="text-sm text-muted">
            {game.uploadProgress === null
              ? "Subiendo tu pool…"
              : `Subiendo ${game.uploadProgress.sent} de ${game.uploadProgress.total}…`}
          </p>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2" aria-label="Tu pool">
            {pool.map((item) => (
              <MediaTile key={item.id} item={item} onClick={() => setLightboxItem(item)} />
            ))}
          </div>

          <section className="mt-auto flex flex-col gap-2 pb-2">
            {iAmReady && (
              <p className="text-center text-sm font-medium text-lime">
                ✓ Pool aceptada. Esperando a los demás…
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={changeMind} disabled={iAmReady}>
                Cambiar de opinión
              </Button>
              <Button className="flex-1" onClick={game.acceptPool} disabled={iAmReady}>
                Aceptar pool
              </Button>
            </div>
            {!iAmReady && (
              <p className="text-center text-xs text-muted">
                Si no te gusta, vuelve a sortear otras fotos; cuando te guste, acepta.
              </p>
            )}
          </section>
        </>
      )}

      {lightboxItem !== null && (
        <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      )}
    </main>
  );
}
