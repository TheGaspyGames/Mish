import { config } from './config.js';
import { Hand } from './models/Hand.js';
import { analyzeStateStats } from './analysis.js';
import { buildStateMeta, mergeStates } from './utils/state.js';
import { detectOutcome, isBlackjackEmbed, parseBlackjackState } from './utils/unbParse.js';
import { commands, findCommandByName } from './commands/index.js';
import { DAILY_LIMIT, checkAndConsumeAssist } from './utils/trust.js';
import { getBasicAction } from './utils/basicStrategy.js';

const games = new Map(); // messageId -> state
const pendingCommands = new Map(); // channelId -> { playerId, at }

const COMMAND_WINDOW_MS = 2 * 60 * 1000;
const FINISHED_TTL_MS = 5 * 60 * 1000;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isStaleFinished(record) {
  if (!record?.finished) return false;
  if (!record.finishedAt) return false;
  return Date.now() - record.finishedAt > FINISHED_TTL_MS;
}

function isBlackjackCommand(content) {
  if (!content) return false;
  const pattern = new RegExp(`^\\s*${escapeRegExp(config.prefix)}?(bj|blackjack)(\\s+all|\\s+\\d+)?`, 'i');
  return pattern.test(content);
}

function isAllowedUpdater(userId) {
  if (!userId) return false;
  if (config.ownerId && config.ownerId === userId) return true;
  return Array.isArray(config.allowedUpdaters) && config.allowedUpdaters.includes(userId);
}

function isTrustOwner(userId) {
  if (!userId) return false;
  if (config.ownerId && config.ownerId === userId) return true;
  return Array.isArray(config.trustOwnerIds) && config.trustOwnerIds.includes(userId);
}

function findActiveGame(playerId, guildId) {
  let latest = null;
  for (const record of games.values()) {
    if (isStaleFinished(record)) {
      games.delete(record.messageId);
      continue;
    }
    if (record.finished) continue;
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
  const lastPlayable = record.lastPlayableState || {};
  const source = lastPlayable.playerTotal != null && lastPlayable.dealerUpCard ? lastPlayable : snapshot;

  return {
    playerTotal: source.playerTotal ?? record.lastTotal ?? record.initialHand?.total ?? null,
    dealerUpCard: source.dealerUpCard ?? record.dealerCard,
    playerCards:
      Array.isArray(source.playerCards) && source.playerCards.length
        ? source.playerCards
        : Array.isArray(snapshot.playerCards) && snapshot.playerCards.length
          ? snapshot.playerCards
          : record.initialHand?.cards,
    betAmount: source.betAmount ?? record.lastBet ?? snapshot.betAmount,
    canDouble: source.canDouble ?? snapshot.canDouble,
    canSplit: source.canSplit ?? snapshot.canSplit,
  };
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

const MIN_PLAYS_FOR_CONFIDENCE = 5;

async function respondWithAdvice(message, state, playerId) {
  const meta = buildStateMeta(state);
  if (meta.playerTotal == null || !meta.dealerUpCard) {
    return message.channel.send(`<@${playerId}> No pude leer bien tu mano ahora mismo, intenta de nuevo en la siguiente actualización.`);
  }
  if (meta.playerTotal != null && meta.playerTotal > 21) {
    return message.channel.send(`<@${playerId}> Ya estás en ${meta.playerTotal} (bust). Esa mano ya está decidida 💀`);
  }

  const usage = await checkAndConsumeAssist(playerId);
  if (!usage.allowed) {
    return message.channel.send(
      `⛔ Has usado tus ${DAILY_LIMIT} jugadas asistidas de hoy.\nEl entrenamiento sigue activo, pero no recibirás consejos automáticos hasta dentro de 24 horas.`
    );
  }

  const analysis = await analyzeStateStats(meta);
  const best = analysis.bestAction;
  const hasStats = best && best.detail?.plays >= MIN_PLAYS_FOR_CONFIDENCE;

  if (hasStats) {
    const detail = best.detail;
    const evLabel = detail.ev >= 0 ? `+${detail.ev.toFixed(2)}` : detail.ev.toFixed(2);
    const winPct = detail.plays ? ((detail.wins / detail.plays) * 100).toFixed(1) : '0.0';
    const tiePct = detail.plays ? ((detail.pushes / detail.plays) * 100).toFixed(1) : '0.0';
    return message.channel.send(
      `<@${playerId}> Consejo: **${best.name.toUpperCase()}** (EV ${evLabel}, Win ${winPct}% | Tie ${tiePct}%, ${detail.plays} manos en este estado).`
    );
  }

  const basic = getBasicAction(meta);
  if (basic === 'NONE') {
    return message.channel.send(`<@${playerId}> Ya estás en ${meta.playerTotal} (bust). Esa mano ya está decidida 💀`);
  }

  return message.channel.send(
    `<@${playerId}> Aún no tengo datos suficientes para este estado (${meta.stateKey}). Según estrategia básica, lo más razonable aquí es **${basic}**.`
  );
}

function findLatestGameByChannel(channelId, guildId, includeFinished = false) {
  let latest = null;
  for (const record of games.values()) {
    if (isStaleFinished(record)) {
      games.delete(record.messageId);
      continue;
    }
    if (!includeFinished && record.finished) continue;
    if (record.channelId !== channelId) continue;
    if (guildId && record.guildId !== guildId) continue;
    if (!latest || (record.startedAt || 0) > (latest.startedAt || 0)) {
      latest = record;
    }
  }
  return latest;
}

function findActiveGameFor(playerId, guildId, channelId) {
  const byPlayer = findActiveGame(playerId, guildId);
  const byChannelAny = findLatestGameByChannel(channelId, guildId, true);
  const byChannel = byChannelAny && !byChannelAny.finished ? byChannelAny : null;

  let game = null;
  if (byPlayer && byChannel) {
    game = (byChannel.startedAt || 0) >= (byPlayer.startedAt || 0) ? byChannel : byPlayer;
  } else {
    game = byPlayer || byChannel;
  }

  if (game && !game.playerId && playerId) {
    game.playerId = playerId;
    games.set(game.messageId, game);
  }

  if (game) return game;

  if (byChannelAny) {
    if (!byChannelAny.playerId && playerId) {
      byChannelAny.playerId = playerId;
      games.set(byChannelAny.messageId, byChannelAny);
    }
    return byChannelAny;
  }

  return null;
}

const commandContext = {
  findActiveGameFor,
  currentStateFromRecord,
  isAllowedUpdater,
  isTrustOwner,
  prefix: config.prefix || '.',
};

async function handleMessageCommands(message) {
  for (const cmd of commands) {
    try {
      if (cmd.matches && cmd.matches(message.content, config.prefix)) {
        await cmd.handleMessage(message, commandContext);
        return true;
      }
    } catch (err) {
      console.error(`[commands] error executing ${cmd.name} via message`, err);
      try {
        await message.reply('Hubo un error al ejecutar el comando.');
      } catch (_) {}
      return true;
    }
  }
  return false;
}

export async function onInteractionCreate(interaction) {
  try {
    if (!interaction.isChatInputCommand()) return;
    const cmd = findCommandByName(interaction.commandName);
    if (!cmd) return;
    await cmd.handleInteraction(interaction, commandContext);
  } catch (err) {
    console.error('[tracker] onInteractionCreate error', err);
  }
}

export async function onMessageCreate(message) {
  try {
    if (message.partial) {
      await message.fetch();
    }
    if (!message.author) return;

    if (!message.author.bot) {
      const handled = await handleMessageCommands(message);
      if (handled) return;

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

export async function registerSlashCommands(client) {
  if (!client?.application) return;
  const payload = commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    options: cmd.options || [],
  }));
  try {
    await client.application.commands.set(payload);
    console.log('[commands] Slash commands registered');
  } catch (err) {
    console.error('[commands] Failed to register slash commands', err);
  }
}

async function handleBlackjackEmbed(message, embed) {
  cleanupPending(message.channelId);

  const state = parseBlackjackState(embed, message);
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
    finished: false,
    finishedAt: null,
    initialHand: {
      cards: state.playerCards,
      total: state.playerTotal,
    },
    dealerCard: state.dealerUpCard,
    lastTotal: state.playerTotal,
    lastBet: state.betAmount,
    pendingDecision: null,
    lastPlayableState:
      state.playerTotal != null && state.dealerUpCard ? mergeStates({}, state) : {},
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
  const state = parseBlackjackState(embed, message);
  let record = games.get(message.id);

  // If we never saw the original message (e.g., bot restarted), treat this as new
  if (!record) {
    await handleBlackjackEmbed(message, embed);
    record = games.get(message.id);
  }
  if (!record || record.finished) return;

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
  const merged = mergeStates(previousState, state);
  record.stateSnapshot = merged;
  if (merged.playerTotal != null && merged.dealerUpCard) {
    record.lastPlayableState = merged;
  }
  games.set(message.id, record);

  const outcome = detectOutcome(embed);

  if (!outcome && record.playerId && state.playerTotal != null && state.dealerUpCard) {
    await respondWithAdvice(message, state, record.playerId);
  }

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
  if (!record || record.finished) {
    games.delete(messageId);
    return;
  }
  if (!record.playerId) {
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

  record.finished = true;
  record.finishedAt = Date.now();
  record.outcome = outcome;
  record.finalDecision = decision;
  games.set(messageId, record);
}
