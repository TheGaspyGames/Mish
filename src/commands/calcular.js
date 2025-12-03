import { ApplicationCommandOptionType } from 'discord.js';
import { analyzeStateStats } from '../analysis.js';
import { basicStrategy } from '../utils/basicStrategy.js';
import { buildStateMeta, describeState } from '../utils/state.js';
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
    const first = parts[0];
    if (getRegex(prefix).test(first)) {
      parts.shift();
    } else {
      parts.shift();
    }
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
  return `- ${action.toUpperCase()} -> EV ${evLabel} | ${detail.plays} jugadas (${detail.wins}W / ${detail.losses}L / ${detail.pushes}P)`;
}

async function buildCalcResponse(playerId, guildId, options, ctx) {
  const game = ctx.findActiveGame(playerId, guildId);
  if (!game) {
    return { ok: false, message: 'No veo una ronda activa tuya de blackjack ahora mismo.' };
  }

  const state = ctx.currentStateFromRecord(game);
  const stateMeta = buildStateMeta(state);
  const analysis = await analyzeStateStats(state);
  const best = analysis.bestAction;
  const actions = Object.entries(analysis.actions).sort((a, b) => b[1].plays - a[1].plays);

  const lines = [];
  lines.push('📟 /calcular - Analisis de jugadas similares');
  lines.push(`Estado detectado: ${describeState(stateMeta)}`);
  if (options.detallado) {
    lines.push(`StateKey: ${stateMeta.stateKey}`);
  }
  lines.push(`Coincidencias: ${analysis.totalPlays}`);

  if (actions.length) {
    lines.push('Acciones registradas:');
    for (const [action, detail] of actions) {
      lines.push(formatActionLine(action, detail));
    }
  } else {
    lines.push('Sin datos aprendidos para este estado.');
  }

  const basic = basicStrategy(stateMeta);
  const hasData = analysis.totalPlays >= MIN_STATE_SAMPLES && best;
  const confident = best && best.detail.plays >= CONFIDENT_ACTION_SAMPLES;

  if (hasData && (confident || !options.base)) {
    const evLabel = best.detail.ev >= 0 ? `+${best.detail.ev.toFixed(2)}` : best.detail.ev.toFixed(2);
    lines.push(`Recomendacion: ${best.name.toUpperCase()} (EV ${evLabel} con ${best.detail.plays} manos).`);
    if (!confident && options.base) {
      lines.push('Nota: datos limitados, se omite estrategia basica por tu solicitud.');
    }
  } else if (hasData && basic && options.base && !confident) {
    lines.push(
      `Datos reales limitados (${best?.detail.plays ?? 0} muestras en la mejor accion). Estrategia basica: ${basic.toUpperCase()}.`
    );
  } else if (options.base && basic) {
    lines.push(
      `No hay suficientes datos reales (min ${MIN_STATE_SAMPLES}). Estrategia basica: ${basic.toUpperCase()}.`
    );
  } else {
    lines.push('No hay suficientes datos para recomendar accion con confianza.');
  }

  return { ok: true, message: lines.join('\n') };
}

async function handleMessage(message, ctx) {
  const options = parseCalcOptions(message.content || '', ctx.prefix);
  const response = await buildCalcResponse(message.author.id, message.guildId, options, ctx);
  await message.reply(response.message);
  return true;
}

async function handleInteraction(interaction, ctx) {
  const options = {
    detallado: interaction.options.getBoolean('detallado') || false,
    base: interaction.options.getBoolean('base'),
  };
  if (options.base === undefined || options.base === null) options.base = true;
  const response = await buildCalcResponse(interaction.user.id, interaction.guildId, options, ctx);
  await interaction.reply({ content: response.message, ephemeral: false });
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
