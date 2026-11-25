# Guía de Despliegue de SnapRoulette

SnapRoulette es un monorepo que compila en una única aplicación Node.js sirviendo tanto la SPA cliente (Vite) como el servidor de WebSockets y API (Socket.IO + Express/Node HTTP).

## Requisitos
- **Node.js**: v20+ o v22+
- **Puerto**: configurable vía variable `PORT` (por defecto `3001`).
- **Healthcheck**: endpoint `/healthz` que devuelve `{ "ok": true }`.

---

## Opciones de Despliegue

### 1. Railway (Recomendado - 1 Click con Docker)
1. Conecta tu repositorio de GitHub en [Railway](https://railway.com).
2. Railway detectará automáticamente el archivo `railway.json` y `Dockerfile`.
3. Variables de entorno automáticas o añadidas:
   - `PORT`: inyectado por Railway automáticamente.
   - `TRUST_PROXY`: `1`
   - `CORS_ORIGIN`: `*`
4. El healthcheck apunta a `/healthz`.

### 2. Render
1. En [Render](https://render.com), crea un nuevo **Web Service**.
2. Conecta el repo o utiliza `render.yaml` (Blueprint).
3. Runtime: **Docker**.
4. Variables de entorno:
   - `PORT`: `3001`
   - `TRUST_PROXY`: `1`
   - `CORS_ORIGIN`: `*`
5. Health Check Path: `/healthz`.

### 3. Fly.io
Ejecuta en la raíz del proyecto:
```bash
fly launch
```
Fly detectará el `Dockerfile`. Asegúrate de que el puerto interno configurado en `fly.toml` sea `3001`.

### 4. Docker / Servidor VPS Propio
```bash
# Construir la imagen
docker build -t snaproulette .

# Ejecutar el contenedor
docker run -d \
  -p 3001:3001 \
  -e PORT=3001 \
  -e TRUST_PROXY=1 \
  -e CORS_ORIGIN=* \
  --name snaproulette \
  snaproulette
```
O con Docker Compose:
```bash
docker compose up -d
```

### 5. Despliegue en Node.js directo (PM2 / Systemd / Bare Metal)
```bash
npm ci
npm run build
npm run start
```
El comando `npm run start` lanzará `node apps/server/dist/index.js`, que automáticamente sirve el bundle de cliente generado en `apps/client/dist`.

---

## Variables de Entorno

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `PORT` | Puerto HTTP / WebSocket | `3001` |
| `TRUST_PROXY` | Activar para leer IP real tras proxies/load balancers (`1`) | `1` en Docker/prod |
| `CORS_ORIGIN` | Orígenes permitidos (`*` o URL del cliente si estuviera separado) | `*` |
| `CLIENT_DIST` | Ruta a los archivos estáticos generados por Vite | Auto-detectada (`apps/client/dist`) |
