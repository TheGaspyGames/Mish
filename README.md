# Gambler Helper (Discord)

Helper bot for UnbelievaBot blackjack/roulette that watches embeds, learns from real plays, and suggests actions in real time.

## Requisitos
- Node.js 18+
- MongoDB accesible (local o remoto)

## Configuración
1. Copia `.env.example` a `.env` y completa:
   - `DISCORD_TOKEN` de tu bot
   - `MONGO_URI` cadena de conexión
   - `UNB_BOT_ID` (por defecto 292953664492929025 para UnbelievaBot)
   - `PREFIX` prefijo de comandos de los jugadores (ej. `.`)
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Arranca el bot:
   ```bash
   npm start
   ```

## Estructura
- `src/index.js`: entrypoint, arranca Discord y DB.
- `src/config.js`: carga variables de entorno.
- `src/db.js`: conexión a MongoDB.
- `src/models/Hand.js`: modelo de manos jugadas.
- `src/utils/unbParse.js`: parseo de embeds de Unbelieva.
- `src/analysis.js`: cálculos de estadísticas y recomendación.
- `src/tracker.js`: escucha mensajes/updates, deduce acciones, guarda datos y responde con consejos.

## Cómo funciona
- Detecta comandos `.bj` / `.blackjack` de jugadores para saber quién está jugando.
- Lee los embeds de Unbelieva (messageCreate/messageUpdate) y extrae total del jugador, carta visible del dealer, apuesta y cartas.
- Deduce la acción:
  - Subida de apuesta → `double`
  - Subida de total → `hit`
  - Resultado sin cambios previos → `stand`
- Cuando llega el resultado final, guarda la mano en Mongo.
- Consulta el histórico `(totalJugador, cartaDealer)` para sugerir la decisión con mejor win rate.

## Siguientes pasos sugeridos
- Ajusta las regex de `unbParse.js` al formato exacto de los embeds en tu servidor.
- Añade smoothing mezclando con estrategia básica cuando haya pocas muestras.
- Añade cooldown/spam-control para respuestas en canales concurridos.
- Extiende a ruleta guardando historial de colores/números y consejos de banca.
