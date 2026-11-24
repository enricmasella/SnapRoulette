/**
 * Velocidad de reproducción para que un vídeo dure exactamente la ronda
 * ("recorte" por time-scaling, no corte duro). Sin metadatos → 1x.
 */
export function computeVideoPlaybackRate(
  videoDurationSec: number,
  roundDurationMs: number,
): number {
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) return 1;
  return Math.min(16, Math.max(1, (videoDurationSec * 1000) / roundDurationMs));
}
