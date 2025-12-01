# Gambler Helper (Unbelieva assistant)

Asistente de Discord diseñado para observar partidas de blackjack y ruleta de **UnbelievaBot**, registrar decisiones reales de los jugadores y ofrecer sugerencias basadas en probabilidades empíricas.

## 1. Plan técnico

1. **Lenguaje y SDK**: Python 3.11+ con `discord.py` v2 (intents con `message_content` activado).
2. **Captura de contexto**: escuchar mensajes en tiempo real, detectar comandos `.bj`, `.bj all`, `.blackjack`, etc., y leer los *embeds* generados por UnbelievaBot.
3. **Inferencia de decisiones**:
   - Si el total del jugador aumenta: `Hit`.
   - Si el total no cambia y finaliza la mano: `Stand`.
   - Si la apuesta aumenta tras la mano inicial: `Double Down`.
   - Mensajes de texto como "hit", "stand", "double" refuerzan la inferencia.
4. **Persistencia**: SQLite para empezar (simple, portable). Se guardan manos de blackjack con mano inicial, carta visible del dealer, decisión, resultado y apuesta.
5. **Estadística**: agregados por `(total_jugador, carta_dealer, decisión)` calculan tasas de victoria/derrota/empate y producen recomendaciones en tiempo real.
6. **Respuesta en vivo**: al detectar un embed de blackjack, se consulta la base y se envía un mensaje de sugerencia con la decisión que maximiza la tasa de victoria observada.
7. **Ruleta**: almacenar historial básico (apuesta, tipo de apuesta, color/número resultante) para futuras heurísticas sencillas y consejos de gestión de banca.

## 2. Estructura del proyecto

```
.
├── README.md
└── src/
    ├── __init__.py
    ├── analysis.py        # Agregados y recomendaciones de blackjack
    ├── bot.py             # Punto de entrada del bot de Discord
    ├── config.py          # Carga de variables de entorno
    ├── models.py          # Dataclasses y enums de dominio
    ├── storage.py         # Persistencia SQLite
    └── tracker.py         # Detección de comandos, parsing de embeds e inferencia de decisiones
```

## 3. Ejecución rápida

1. Crear un bot en el Portal de Discord, habilitar **Message Content Intent**.
2. Definir variables de entorno (ejemplo):

```bash
export DISCORD_TOKEN="TU_TOKEN"
export DATABASE_PATH="data/gambler_helper.db"           # opcional
export GUILD_WHITELIST="1234567890,9876543210"          # opcional
export UNBELIEVA_BOT_IDS="292953664492929025"           # opcional (ID oficial de Unbelieva)
```

3. Instalar dependencias mínimas:

```bash
pip install discord.py
```

4. Ejecutar:

```bash
python -m src.bot
```

## 4. Modelo de datos (SQLite)

Tabla `blackjack_records`:

- `player_id`, `guild_id`
- `bet_amount`
- `initial_cards` / `initial_total`
- `dealer_card`
- `decision` (`hit` | `stand` | `double`)
- `final_cards` / `final_total`
- `result` (`win` | `lose` | `tie`)
- `timestamp`

Ejemplo de documento equivalente:

```json
{
  "playerId": "1234567890",
  "guildId": "987654321",
  "betAmount": 1000,
  "initialHand": {"cards": ["K♠", "6♥"], "total": 16},
  "dealerCard": "10♦",
  "decision": "hit",
  "finalHand": {"cards": ["K♠", "6♥", "4♣"], "total": 20, "result": "win"},
  "timestamp": "..."
}
```

## 5. Flujo de captura e inferencia

1. Un jugador escribe `.bj all` o `.blackjack 1000` → `GameTracker.track_command` marca el usuario como activo.
2. Llega un embed de Unbelieva con la mano inicial → `parse_blackjack_embed` registra mano y carta visible del dealer.
3. Cambios posteriores de total/apuesta deducen `Hit`/`Stand`/`Double`.
4. Cuando el embed incluye resultado (win/lose/tie), se guarda la mano en SQLite y se calcula una recomendación basada en historial similar.
5. El bot responde en el canal con la sugerencia.

## 6. Lógica de recomendación

`analysis.BlackjackAnalyzer` agrega estadísticas por `(total_jugador, carta_dealer, decisión)` y calcula tasas de victoria. La recomendación devuelve el movimiento con mayor win-rate observado, junto con el desglose para transparencia.

Ejemplo de respuesta:

```
Sugerencia Gambler Helper para @jugador:
Recomendación basada en 18 manos similares:
Hit: 40.0% win / 55.0% lose / 5.0% tie (n=10)
Stand: 25.0% win / 70.0% lose / 5.0% tie (n=8)
Sugerencia: Hit
```

## 7. Ruleta (base para expansión)

- Guardar cada giro con: jugador, apuesta, tipo (rojo/negro/número), resultado, monto ganado.
- Calcular histogramas de color y rachas recientes para mostrar probabilidad teórica (48.6% rojo/negro en rueda europea) y consejos de gestión de banca (no apostar todo, evitar martingala infinita).

## 8. Extensiones futuras

- Ajustar parsers de embed según idioma/plantilla del servidor.
- Añadir normalización de cartas (A=1/11, manejo de ases suaves) para estrategias más finas.
- Entrenar un modelo bayesiano simple para estimar EV de `Double` con pocos datos.
- Comandos de administración para resetear datos, exportar CSV o migrar a MongoDB.
- Panel web ligero (FastAPI + Chart.js) para visualizar el mapa de decisiones.

## 9. Advertencia

El bot es puramente informativo: **no ejecuta apuestas ni garantiza ganancias**. Úsalo de manera responsable y conforme a las reglas de tu servidor.
