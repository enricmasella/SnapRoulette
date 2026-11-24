# SnapRoulette

Party game web multijugador en tiempo real. Cada jugador sube sus propias fotos y vídeos desde su
dispositivo, la sala mezcla las pools de todos, y hay que adivinar de quién es cada medio antes de
que desaparezca. Puntos por acierto + velocidad.

- **Modos**: fotos · vídeos · mixto
- **Rondas configurables** (3-20) y **duración por ronda** (3-15 s) desde el lobby
- **2-10 jugadores** en sala privada por código (5 caracteres)
- Rejugabilidad inmediata: "Jugar de nuevo" regenera pools, sin recrear la sala

## Estructura

- `packages/shared` — tipos y schemas zod compartidos (contrato cliente/servidor)
- `apps/server` — Node + TypeScript + Socket.IO (salas, pools, rondas, puntuación, rate limiting)
- `apps/client` — React + Vite + Tailwind 4 (UI mobile-first)

## Requisitos

- Node 20+
- Sin variables de entorno obligatorias para desarrollo.

## Desarrollo

```bash
npm install
npm run dev        # server :3001 + client :5173 (concurrently)
npm run typecheck  # todos los workspaces
npm test           # tests (vitest)
npm run lint       # biome check
npm run bot -- ABCDE  # jugador simulado contra una sala local (ver tools/README.md)
```

## Seguridad del servidor

- **Sniffing de magic bytes** en cada upload: se detecta el tipo real del archivo por firma binaria
  (JPEG, PNG, GIF, WebP, MP4, WebM, MOV, AVIF) y se valida contra el `kind` declarado por el cliente.
  El `Content-Type` lo deriva el servidor; el del cliente se ignora (bloquea XSS vía `data:text/html`).
- **Rate limiting por IP** (sliding window en memoria) en creación/unión de salas y uploads, más
  límite global de salas activas (`MAX_ROOMS`).
- **Límites de tamaño**: por archivo (`MAX_UPLOAD_BYTES`), por esquema zod (base64), y total en el
  almacén de medios (`MAX_MEDIA_STORE_BYTES`, 200 MB en memoria). Cada archivo viaja en su propio
  evento `upload_item` con ACK, así que el buffer del socket (~35 MB) no crece con el pool entero.
- **`X-Content-Type-Options: nosniff`** en todas las respuestas de medios.
- Los medios subidos se liberan al abandonar la sala, al destruirse y al empezar una revancha;
  si todos se desconectan la sala se destruye en el acto (sin fugas hasta `MAX_ROOMS`).

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3001` | Puerto del servidor |
| `CORS_ORIGIN` | `*` | Origen permitido para socket.io |
| `CLIENT_DIST` | `../client/dist` | Ruta al build del cliente (solo producción) |
| `TRUST_PROXY` | `0` | `1` si hay un proxy delante: usa `X-Forwarded-For` para el rate limit por IP |

## Producción

```bash
npm run build
npm start
```

También puedes iniciar directamente el bundle generado:

```bash
node apps/server/dist/index.js
```

Para ejecutar el servicio con Docker:

```bash
docker compose up --build
```

En producción, el servidor sirve el build del cliente desde `apps/client/dist` (o la ruta indicada
por `CLIENT_DIST`).