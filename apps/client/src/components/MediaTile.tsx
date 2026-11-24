import type { MediaItem } from "@snaproulette/shared";

export function MediaTile({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  const isVideo = item.kind === "video";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isVideo ? "Ver vídeo" : "Ver foto"}
      className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-surface-2"
    >
      <img
        src={item.thumbUrl ?? item.url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
      {isVideo && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-4xl text-ink drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]"
        >
          ▶
        </span>
      )}
    </button>
  );
}
