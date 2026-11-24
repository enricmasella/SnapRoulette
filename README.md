# SnapRoulette

Un juego rápido para picarte con tus amigos: cada uno conecta su móvil a la misma sala, sube unas cuantas fotos o vídeos de su carrete (o deja que el juego elija una carpeta al azar), y se mezclan todas. En cada ronda sale una en pantalla y tienes pocos segundos para adivinar de quién es. Cuanto más rápido aciertes, más puntos sumas.

## Cómo va una partida

1. Creas una sala o entras con un código de 5 letras (o pasando directamente el enlace de la sala).
2. Eliges qué entra en juego: solo fotos, solo vídeos o modo mixto, y cuántas rondas queréis.
3. Cada jugador prepara su lote. Puedes darle acceso a una carpeta para que saque fotos aleatorias de tu carrete o elegir archivos a mano desde el móvil.
4. Empieza la partida: foto en pantalla, cuenta atrás y botones con los nombres de todos para votar.
5. Al terminar, podéis darle a revancha directa sin tener que volver a montar la sala.

## Cómo está montado

El proyecto es un monorepo con TypeScript dividido en tres partes:

- `packages/shared`: los tipos, esquemas de Zod y los eventos que viajan por Socket.IO.
- `apps/server`: servidor con Node.js, Express y Socket.IO. Lleva el estado de las salas, los turnos, las puntuaciones y guarda las fotos en memoria mientras dura la partida.
- `apps/client`: web hecha con React, Vite y Tailwind CSS, pensada para usarse cómoda en el móvil.
- `tools/`: un bot en Node para simular jugadores y probar partidas en local sin necesitar cuatro teléfonos a la vez.

## Ponerlo a rodar en local

Necesitas Node.js 20 o superior.

```bash
# Instalar dependencias
npm install

# Levantar servidor (:3001) y cliente (:5173) a la vez
npm run dev
```

Entras en `http://localhost:5173` y ya puedes crear sala o unirte.

Otros comandos habituales:

```bash
# Revisar formato y linter
npm run lint

# Comprobar tipos en todo el proyecto
npm run typecheck

# Correr los tests
npm test

# Meter un bot a una sala para probar
npm run bot -- CODIGO
```

## Detalles del servidor

- **Cero archivos en disco:** Las fotos y vídeos se guardan solo en la memoria RAM del servidor mientras la sala está viva. Si la sala se cierra o la gente se va, se limpian solas.
- **Comprobación real de archivos:** El servidor no se fía de la extensión que diga el navegador; mira los primeros bytes de cada archivo para confirmar que de verdad es una imagen o un vídeo válido.
- **Subidas controladas:** Cada foto se sube por separado con confirmación (ACK) para no saturar el canal del socket con paquetes gigantes.
- **Reconexión:** Si se te apaga la pantalla, se corta la red o recargas sin querer a mitad de partida, puedes volver a meter tu nombre y el código de la sala para reengancharte a la ronda en curso.

## Despliegue y producción

Para compilar y arrancar:

```bash
npm run build
npm start
```

O con Docker:

```bash
docker compose up --build
```

### Variables de entorno (opcionales)

- `PORT`: puerto donde escucha el servidor (por defecto `3001`).
- `CORS_ORIGIN`: dominios permitidos para Socket.IO (por defecto `*`).
- `TRUST_PROXY`: ponlo a `1` si tienes un proxy delante (Nginx, Cloudflare, etc.) para que el control de conexiones use la IP real del usuario.