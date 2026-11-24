import { useEffect } from "react";

import type { MediaItem } from "@snaproulette/shared";

export function Lightbox({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Medio ampliado"
      className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center rounded-none bg-night/95 p-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink"
      >
        ✕
      </button>
      <div className="max-h-full max-w-full">
        {item.kind === "video" ? (
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            className="max-h-[80dvh] max-w-full rounded-2xl"
          >
            <track kind="captions" src="data:text/vtt,WEBVTT" label="Sin subtítulos" />
          </video>
        ) : (
          <img
            src={item.url}
            alt="Foto ampliada"
            className="max-h-[80dvh] max-w-full rounded-2xl object-contain"
          />
        )}
      </div>
    </dialog>
  );
}
