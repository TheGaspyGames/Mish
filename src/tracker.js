import { config } from './config.js';
import { Hand } from './models/Hand.js';
import { analyzeStateStats, fetchStats, pickDecision } from './analysis.js';
import { basicStrategy } from './utils/basicStrategy.js';
import { buildStateMeta, describeState, mergeStates } from './utils/state.js';
import { detectOutcome, isBlackjackEmbed, parseBlackjackState } from './utils/unbParse.js';
import { getUpdateStatus, needsRestart, performUpdate, restartProcess, rollbackLastReset } from './utils/updater.js';

const games = new Map(); // messageId -> state
const pendingCommands = new Map(); // channelId -> { playerId, at }

const COMMAND_WINDOW_MS = 2 * 60 * 1000;
const MIN_STATE_SAMPLES = 10;
const CONFIDENT_ACTION_SAMPLES = 20;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBlackjackCommand(content) {
  if (!content) return false;
  const pattern = new RegExp(`^\\s*${escapeRegExp(config.prefix)}?(bj|blackjack)(\\s+all|\\s+\\d+)?`, 'i');
  return pattern.test(content);
}

function makeCommandRegex(name) {
  const prefix = escapeRegExp(config.prefix || '.');
  return new RegExp(`^\\s*(?:\\/|${prefix}|<@!?\\d+>\\s*)?${name}\\b`, 'i');
}

const calcRegex = makeCommandRegex('calcular');
const updateRegex = makeCommandRegex('update');

function isCalcCommand(content) {
  return Boolean(content && calcRegex.test(content));
}

function isUpdateCommand(content) {
  return Boolean(content && updateRegex.test(content));
}

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const normalized = value.toString().trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'si', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseCalcOptions(content) {
  const opts = { detallado: false, base: true };
  if (!content) return opts;

  const parts = content.trim().split(/\s+/);
  parts.shift(); // remove command token
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

function parseUpdateOptions(content) {
  const tokens = (content || '').trim().split(/\s+/);
  tokens.shift(); // remove command
  const result = { mode: 'update', force: false };

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'status') result.mode = 'status';
    else if (lower === 'force') {
      result.mode = 'update';
      result.force = true;
    } else if (lower === 'rollback') {
      result.mode = 'rollback';
    }
  }

  return result;
}

function isAllowedUpdater(userId) {
  if (!userId) return false;
  if (config.ownerId && config.ownerId === userId) return true;
  return Array.isArray(config.allowedUpdaters) && config.allowedUpdaters.includes(userId);
}

function findActiveGame(playerId, guildId) {
  let latest = null;
  for (const record of games.values()) {
    if (!record.playerId || record.playerId !== playerId) continue;
    if (guildId && record.guildId !== guildId) continue;
    if (!latest || (record.startedAt || 0) > (latest.startedAt || 0)) {
      latest = record;
    }
  }
  return latest;
}

function currentStateFromRecord(record) {
  if (!record) return {};
  const snapshot = record.stateSnapshot || {};
  return {
    playerTotal: snapshot.playerTotal ?? record.lastTotal ?? record.initialHand?.total ?? null,
    dealerUpCard: snapshot.dealerUpCard ?? record.dealerCard,
    playerCards:
      Array.isArray(snapshot.playerCards) && snapshot.playerCards.length
        ? snapshot.playerCards
        : record.initialHand?.cards,
    betAmount: snapshot.betAmount ?? record.lastBet,
    canDouble: snapshot.canDouble,
    canSplit: snapshot.canSplit,
  };
}

function formatActionLine(action, detail) {
  const evLabel = detail.ev >= 0 ? `+${detail.ev.toFixed(2)}` : detail.ev.toFixed(2);
  return `- ${action.toUpperCase()} -> EV ${evLabel} | ${detail.plays} jugadas (${detail.wins}W / ${detail.losses}L / ${detail.pushes}P)`;
}

function cleanupPending(channelId) {
  const entry = pendingCommands.get(channelId);
  if (entry && Date.now() - entry.at > COMMAND_WINDOW_MS) {
    pendingCommands.delete(channelId);
  }
}

function extractMentionId(content) {
  if (!content) return null;
  const match = content.match(/<@!?(\d+)>/);
  return match ? match[1] : null;
}

async function respondWithAdvice(message, state, playerId) {
  const stats = await fetchStats(state.playerTotal, state.dealerUpCard);
  const choice = pickDecision(stats);

  if (!choice.decision) {
    return message.channel.send(
      `<@${playerId}> Aun no tengo datos para ${state.playerTotal} vs ${state.dealerUpCard}. Juega y aprenderemos.`
    );
  }

  const detail = choice.detail;
  const winPct = (detail.winRate * 100).toFixed(1);
  const tiePct = (detail.tieRate * 100).toFixed(1);
  return message.channel.send(
    `<@${playerId}> Consejo: **${choice.decision.toUpperCase()}** suele rendir mejor aqui. WinRate ${winPct}% | Tie ${tiePct}% | Muestras ${detail.plays}/${stats.totalSamples}.`
  );
}

async function handleCalcCommand(message) {
  try {
    const options = parseCalcOptions(message.content || '');
    const game = findActiveGame(message.author.id, message.guildId);
    if (!game) {
      await message.reply('No veo una ronda activa tuya de blackjack ahora mismo.');
      return true;
    }

    const state = currentStateFromRecord(game);
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

    await message.reply(lines.join('\n'));
    return true;
  } catch (err) {
    console.error('[tracker] handleCalcCommand error', err);
    try {
      await message.reply('Hubo un error al calcular. Revisa los logs.');
    } catch (replyErr) {
      console.error('[tracker] fallback reply error', replyErr);
    }
    return true;
  }
}

async function handleUpdateCommand(message) {
  if (!isAllowedUpdater(message.author?.id)) {
    await message.reply('⛔ No tienes permisos para usar /update.');
    return true;
  }

  const opts = parseUpdateOptions(message.content || '');
  const branch = config.updateBranch || 'main';

  if (opts.mode === 'status') {
    try {
      const status = await getUpdateStatus(branch);
      const lines = [
        '📡 Estado del repo',
        `Rama objetivo: ${branch}`,
        `Local: ${status.localRef}`,
        `Remoto: ${status.remoteRef}`,
        `Divergencia -> behind ${status.behind} | ahead ${status.ahead}`,
        status.dirty ? '⚠️ Hay cambios locales sin commit.' : '✅ Working tree limpia.',
      ];
      await message.reply(lines.join('\n'));
    } catch (err) {
      console.error('[update] status error', err);
      await message.reply('Error al obtener el estado del repo. Revisa los logs.');
    }
    return true;
  }

  if (opts.mode === 'rollback') {
    try {
      const res = await rollbackLastReset();
      const lines = ['↩️ Rollback ejecutado (git reset --hard HEAD@{1})', `HEAD actual: ${res.head}`];
      await message.reply(lines.join('\n'));
    } catch (err) {
      console.error('[update] rollback error', err);
      await message.reply('No se pudo hacer rollback. Revisa los logs.');
    }
    return true;
  }

  const progressMsg = await message.reply('🔄 Actualizacion en progreso...');
  try {
    const result = await performUpdate(branch, { force: opts.force });
    const changed = result.changed || [];
    const lines = ['📥 Descargando ultima version del repositorio...', `De ${result.oldHead} a ${result.newHead}`];

    if (!changed.length) {
      lines.push('No hay cambios nuevos. El repositorio ya estaba actualizado.');
    } else {
      lines.push('Archivos actualizados:');
      const list = changed.slice(0, 10).map((f) => `- ${f}`);
      lines.push(...list);
      if (changed.length > list.length) {
        lines.push(`... y ${changed.length - list.length} mas.`);
      }
    }

    const restartNeeded = needsRestart(changed);
    if (restartNeeded) {
      if (config.restartCommand) {
        lines.push('🚀 Reiniciando bot...');
        try {
          const restartRes = await restartProcess(config.restartCommand);
          if (!restartRes.skipped) {
            lines.push('Reinicio lanzado.');
          }
        } catch (restartErr) {
          console.error('[update] restart error', restartErr);
          lines.push('⚠️ No se pudo reiniciar automaticamente, hazlo manualmente.');
        }
      } else {
        lines.push('ℹ️ Cambios detectados en codigo/config. Reinicia el proceso manualmente.');
      }
    } else {
      lines.push('No se requiere reinicio (sin cambios en codigo/config).');
    }

    await progressMsg.edit(lines.join('\n'));
  } catch (err) {
    console.error('[update] update error', err);
    const lines = ['❌ Error al actualizar.'];
    if (err.code === 'DIRTY') {
      lines.push('Hay cambios locales sin commit. Usa ".update force" para forzar el reset.');
    }
    await progressMsg.edit(lines.join('\n'));
  }
  return true;
}

export async function onMessageCreate(message) {
  try {
    if (message.partial) {
      await message.fetch();
    }
    if (!message.author) return;

    if (!message.author.bot) {
      if (isUpdateCommand(message.content)) {
        await handleUpdateCommand(message);
        return;
      }

      if (isCalcCommand(message.content)) {
        await handleCalcCommand(message);
        return;
      }

      if (isBlackjackCommand(message.content)) {
        pendingCommands.set(message.channelId, { playerId: message.author.id, at: Date.now() });
      }
    }

    // Only care about Unbelieva embeds
    if (message.author.id !== config.unbBotId || !message.embeds?.length) return;
    const embed = message.embeds[0];
    if (!isBlackjackEmbed(embed)) return;

    await handleBlackjackEmbed(message, embed);
  } catch (err) {
    console.error('[tracker] onMessageCreate error', err);
  }
}

export async function onMessageUpdate(_oldMessage, newMessage) {
  try {
    const message = newMessage.partial ? await newMessage.fetch() : newMessage;
    if (!message?.author) return;
    if (message.author.id !== config.unbBotId || !message.embeds?.length) return;
    const embed = message.embeds[0];
    if (!isBlackjackEmbed(embed)) return;

    await handleBlackjackUpdate(message, embed);
  } catch (err) {
    console.error('[tracker] onMessageUpdate error', err);
  }
}

async function handleBlackjackEmbed(message, embed) {
  cleanupPending(message.channelId);

  const state = parseBlackjackState(embed);
  const mentionId = extractMentionId(message.content);
  const pending = pendingCommands.get(message.channelId);
  const playerId = mentionId || pending?.playerId || null;
  if (pending) {
    pendingCommands.delete(message.channelId);
  }

  const record = {
    playerId,
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    startedAt: Date.now(),
    initialHand: {
      cards: state.playerCards,
      total: state.playerTotal,
    },
    dealerCard: state.dealerUpCard,
    lastTotal: state.playerTotal,
    lastBet: state.betAmount,
    pendingDecision: null,
    stateSnapshot: mergeStates({}, state),
    decisionState: mergeStates({}, state),
  };

  games.set(message.id, record);

  if (playerId && state.playerTotal != null && state.dealerUpCard) {
    await respondWithAdvice(message, state, playerId);
  }

  const outcome = detectOutcome(embed);
  if (outcome) {
    await persistAndClear(message.id, outcome, 'stand');
  }
}

async function handleBlackjackUpdate(message, embed) {
  const state = parseBlackjackState(embed);
  let record = games.get(message.id);

  // If we never saw the original message (e.g., bot restarted), treat this as new
  if (!record) {
    await handleBlackjackEmbed(message, embed);
    record = games.get(message.id);
  }
  if (!record) return;

  const previousState = record.stateSnapshot || {};
  let decision = null;
  if (record.lastBet && state.betAmount && state.betAmount > record.lastBet) {
    decision = 'double';
  } else if (record.lastTotal && state.playerTotal && state.playerTotal > record.lastTotal) {
    decision = 'hit';
  }

  if (decision) {
    record.pendingDecision = decision;
    record.decisionState = mergeStates({}, previousState);
  }

  record.lastTotal = state.playerTotal ?? record.lastTotal;
  record.lastBet = state.betAmount ?? record.lastBet;
  record.stateSnapshot = mergeStates(previousState, state);
  games.set(message.id, record);

  const outcome = detectOutcome(embed);
  if (outcome) {
    if (!record.decisionState) {
      record.decisionState = mergeStates({}, record.stateSnapshot);
    }
    const finalDecision = record.pendingDecision || 'stand';
    await persistAndClear(message.id, outcome, finalDecision);
  }
}

async function persistAndClear(messageId, outcome, decision) {
  const record = games.get(messageId);
  if (!record || !record.playerId) {
    games.delete(messageId);
    return;
  }

  const snapshot = record.stateSnapshot || {};
  const decisionState = record.decisionState || snapshot;
  const stateMeta = buildStateMeta(decisionState);
  const { stateKey, ...stateData } = stateMeta;

  const finalCards =
    Array.isArray(snapshot.playerCards) && snapshot.playerCards.length
      ? snapshot.playerCards
      : record.initialHand?.cards;
  const finalTotal = snapshot.playerTotal ?? record.lastTotal ?? record.initialHand?.total;
  const betAmount = snapshot.betAmount ?? record.lastBet;

  await Hand.create({
    playerId: record.playerId,
    guildId: record.guildId,
    channelId: record.channelId,
    betAmount,
    initialHand: record.initialHand,
    dealerCard: record.dealerCard,
    state: { ...stateData, key: stateKey },
    decision,
    finalHand: {
      cards: finalCards,
      total: finalTotal,
      result: outcome,
    },
  });

  games.delete(messageId);
}
