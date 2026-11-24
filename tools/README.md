# Herramientas

## `bot.mjs` — jugadores simulados

Se conectan a una sala como jugadores más, suben placeholders PNG generados en
memoria (un `upload_item` por archivo) y adivinan al azar. Sirve para probar una
partida completa sin abrir varios navegadores y para verificar que el servidor
sigue aceptando el flujo entero.

```bash
npm run dev                          # servidor + cliente en otra terminal
npm run bot -- ABCDE                 # un bot en la sala ABCDE
npm run bot -- ABCDE --bots 3       # tres bots de golpe
npm run bot -- ABCDE --url http://localhost:3123   # contra el build de producción
```

El host tiene que empezar la partida desde el navegador: los bots entran en el
lobby y, en cuanto la sala pasa a `pools`, suben su pool y lo aceptan solos.
Requiere que la sala exista. No se usa en producción.
