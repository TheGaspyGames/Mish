import { ApplicationCommandOptionType } from 'discord.js';
import { analyzeStateStats } from '../analysis.js';
import { basicStrategy } from '../utils/basicStrategy.js';
import { buildStateMeta, describeState } from '../utils/state.js';
import { DAILY_LIMIT, checkAndConsumeAssist } from '../utils/trust.js';
import { makeCommandRegex, parseBool } from './utils.js';

const MIN_STATE_SAMPLES = 10;
const CONFIDENT_ACTION_SAMPLES = 20;

const regexCache = new Map();

function getRegex(prefix) {
  if (!regexCache.has(prefix)) {
    regexCache.set(prefix, makeCommandRegex('calcular', prefix));
  }
  return regexCache.get(prefix);
}

function parseCalcOptions(content, prefix) {
  const opts = { detallado: false, base: true };
  if (!content) return opts;
  const parts = content.trim().split(/\s+/);
  if (parts.length) {
    parts.shift(); // drop command token
  }
  for (const token of parts) {
    const [rawKey, rawVal] = token.split(/[:=]/);
    const key = rawKey?.toLowerCase();
    if (key === 'detallado') {
      opts.detallado = parseBool(rawVal, opts.detallado);
    } else if (key === 'base') {
      opts.base = parseBool(rawVal, opts.base);
    }
  }
  return opts;
}

function formatActionLine(action, detail) {
  const evLabel = detail.ev >= 0 ? `+${detail.ev.toFixed(2)}` : detail.ev.toFixed(2);
  return `• ${action.toUpperCase()} -> EV ${evLabel} | ${detail.plays} jugadas (${detail.wins}W / ${detail.losses}L / ${detail.pushes}P)`;
}

async function buildCalcResponse(playerId, guildId, channelId, options, ctx) {
  const game = ctx.findActiveGameFor(playerId, guildId, channelId);
  if (!game) {
    return { ok: false, embed: { description: 'No veo una ronda activa tuya de blackjack ahora mismo.', color: 0xed4245 } };
  }

  if (game.finished) {
    return { ok: false, embed: { description: 'La ronda ya terminó, no puedo calcular sobre una mano cerrada.', color: 0xed4245 } };
  }

  const state = ctx.currentStateFromRecord(game);
  const stateMeta = buildStateMeta(state);
  if (stateMeta.playerTotal == null || !stateMeta.dealerUpCard) {
    return { ok: false, embed: { description: 'No pude leer bien tu mano ahora mismo, espera la siguiente actualización del embed.', color: 0xed4245 } };
  }
  if (stateMeta.playerTotal > 21) {
    return { ok: false, embed: { description: `Ya estás en ${stateMeta.playerTotal} (bust). Esa mano ya está decidida 💀`, color: 0xed4245 } };
  }

  const usage = await checkAndConsumeAssist(playerId);
  if (!usage.allowed) {
    return {
      ok: false,
      embed: {
        description: `⛔ Has usado tus ${DAILY_LIMIT} jugadas asistidas de hoy.\nEl entrenamiento sigue activo, pero no recibirás consejos automáticos hasta dentro de 24 horas.`,
        color: 0xed4245,
      },
    };
  }
  const analysis = await analyzeStateStats(state);
  const best = analysis.bestAction;
  const actions = Object.entries(analysis.actions).sort((a, b) => b[1].plays - a[1].plays);

  const basic = basicStrategy(stateMeta);
  const hasData = analysis.totalPlays >= MIN_STATE_SAMPLES && best;
  const confident = best && best.detail.plays >= CONFIDENT_ACTION_SAMPLES;

  let recommendation = 'No hay suficientes datos para recomendar accion con confianza.';
  if (hasData && (confident || !options.base)) {
    const evLabel = best.detail.ev >= 0 ? `+${best.detail.ev.toFixed(2)}` : best.detail.ev.toFixed(2);
    recommendation = `Recomendacion: **${best.name.toUpperCase()}** (EV ${evLabel} con ${best.detail.plays} manos).`;
    if (!confident && options.base) {
      recommendation += '\nNota: datos limitados, se omite estrategia basica por tu solicitud.';
    }
  } else if (hasData && basic && options.base && !confident) {
    recommendation = `Datos reales limitados (${best?.detail.plays ?? 0} muestras en la mejor accion). Estrategia basica: **${basic.toUpperCase()}**.`;
  } else if (options.base && basic) {
    recommendation = `No hay suficientes datos reales (min ${MIN_STATE_SAMPLES}). Estrategia basica: **${basic.toUpperCase()}**.`;
  }

  const actionLines = actions.length
    ? actions.map(([action, detail]) => formatActionLine(action, detail)).join('\n')
    : 'Sin datos aprendidos para este estado.';

  const embed = {
    title: '📟 /calcular',
    description: `Estado detectado: ${describeState(stateMeta)}\nCoincidencias: ${analysis.totalPlays}`,
    color: 0x5865f2,
    fields: [
      { name: 'Acciones registradas', value: actionLines },
      { name: 'Recomendacion', value: recommendation },
    ],
  };

  if (options.detallado) {
    embed.fields.push({ name: 'StateKey', value: stateMeta.stateKey });
  }

  return { ok: true, embed };
}

async function handleMessage(message, ctx) {
  const options = parseCalcOptions(message.content || '', ctx.prefix);
  const response = await buildCalcResponse(message.author.id, message.guildId, message.channelId, options, ctx);
  if (response.embed) {
    await message.reply({ embeds: [response.embed] });
  } else {
    await message.reply(response.message);
  }
  return true;
}

async function handleInteraction(interaction, ctx) {
  const options = {
    detallado: interaction.options.getBoolean('detallado') || false,
    base: interaction.options.getBoolean('base'),
  };
  if (options.base === undefined || options.base === null) options.base = true;
  const response = await buildCalcResponse(
    interaction.user.id,
    interaction.guildId,
    interaction.channelId,
    options,
    ctx
  );
  if (response.embed) {
    await interaction.reply({ embeds: [response.embed], ephemeral: false });
  } else {
    await interaction.reply({ content: response.message, ephemeral: false });
  }
  return true;
}

export const calcularCommand = {
  name: 'calcular',
  description: 'Analiza manos similares y recomienda la mejor accion',
  options: [
    {
      name: 'detallado',
      description: 'Mostrar informacion detallada',
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    },
    {
      name: 'base',
      description: 'Usar estrategia basica si faltan datos (default: true)',
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    },
  ],
  matches(content, prefix) {
    return Boolean(content && getRegex(prefix).test(content));
  },
  handleMessage,
  handleInteraction,
};
