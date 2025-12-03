import { config } from './config.js';
import { Hand } from './models/Hand.js';
import { fetchStats, pickDecision } from './analysis.js';
import { buildStateMeta, mergeStates } from './utils/state.js';
import { detectOutcome, isBlackjackEmbed, parseBlackjackState } from './utils/unbParse.js';
import { commands, findCommandByName } from './commands/index.js';
import { DAILY_LIMIT, checkAndConsumeAssist } from './utils/trust.js';

const games = new Map(); // messageId -> state
const pendingCommands = new Map(); // channelId -> { playerId, at }

const COMMAND_WINDOW_MS = 2 * 60 * 1000;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const usage = await checkAndConsumeAssist(playerId);
  if (!usage.allowed) {
    return message.channel.send(
      `⛔ Has usado tus ${DAILY_LIMIT} jugadas asistidas de hoy.\nEl entrenamiento sigue activo, pero no recibirás consejos automáticos hasta dentro de 24 horas.`
    );
  }

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

function findLatestGameByChannel(channelId, guildId) {
  let latest = null;
  for (const record of games.values()) {
    if (record.channelId !== channelId) continue;
    if (guildId && record.guildId !== guildId) continue;
    if (!latest || (record.startedAt || 0) > (latest.startedAt || 0)) {
      latest = record;
    }
  }
  return latest;
}

function findActiveGameFor(playerId, guildId, channelId) {
  let game = findActiveGame(playerId, guildId);
  if (game) return game;

  const byChannel = findLatestGameByChannel(channelId, guildId);
  if (byChannel) {
    if (!byChannel.playerId && playerId) {
      byChannel.playerId = playerId;
      games.set(byChannel.messageId, byChannel);
    }
    return byChannel;
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
  const state = parseBlackjackState(embed, message);
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
