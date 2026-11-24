type MediaType = "jpeg" | "png" | "gif" | "webp" | "mp4" | "webm" | "mov" | "avif";

/**
 * Detecta el tipo de medio real de un buffer usando firmas binarias (magic bytes).
 * Implementado manualmente sin librerías externas para mayor seguridad.
 *
 * @param buffer El buffer de datos del archivo.
 * @returns El tipo de medio detectado o `null` si no se reconoce.
 */
export function detectMediaType(buffer: Buffer): MediaType | null {
  if (buffer.length < 12) return null; // La mayoría de las firmas requieren al menos 12 bytes

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  // GIF: "GIF87a" o "GIF89a"
  if (
    (buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38 &&
      buffer[4] === 0x37 &&
      buffer[5] === 0x61) ||
    (buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38 &&
      buffer[4] === 0x39 &&
      buffer[5] === 0x61)
  ) {
    return "gif";
  }

  // WebP: "RIFF".... "WEBP" (bytes 0-3 y 8-11)
  if (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return "webp";
  }

  // Comprobaciones para formatos de vídeo que usan el box 'ftyp' (MP4, MOV, AVIF)
  // 'ftyp' siempre está en offset 4, y el brand en offset 8 (4 bytes)
  if (
    buffer[4] === 0x66 && // f
    buffer[5] === 0x74 && // t
    buffer[6] === 0x79 && // y
    buffer[7] === 0x70 // p
  ) {
    const brand = buffer.toString("ascii", 8, 12);
    switch (brand) {
      // MP4: los fabricantes usan brands distintos (Android → mp41/avc1,
      // iOS → isom/iso5). Aceptar solo mp42/isom rechazaba vídeos legítimos.
      case "mp41":
      case "mp42":
      case "isom":
      case "iso2":
      case "iso4":
      case "iso5":
      case "iso6":
      case "avc1":
      case "dash":
      case "M4V ":
      case "MSNV":
        return "mp4";
      case "qt  ": // QuickTime / MOV
        return "mov";
      case "avif": // AVIF
      case "avis":
        return "avif";
    }
  }

  // WebM: EBML (1A 45 DF A3)
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "webm";
  }

  return null;
}

/**
 * Mapea un `MediaType` a su `Content-Type` MIME estándar.
 *
 * @param mediaType El tipo de medio detectado.
 * @returns El string del `Content-Type` MIME.
 */
export function getMimeType(mediaType: MediaType): string {
  switch (mediaType) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "avif":
      return "image/avif";
    // Fallback por si acaso, aunque detectMediaType debería ser exhaustivo para los casos que soporta
    default:
      return "application/octet-stream";
  }
}
