import { config } from './config.js';
import { Hand } from './models/Hand.js';
import { fetchStats, pickDecision } from './analysis.js';
import { detectOutcome, isBlackjackEmbed, parseBlackjackState } from './utils/unbParse.js';

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
      `<@${playerId}> Aún no tengo datos para ${state.playerTotal} vs ${state.dealerUpCard}. Juega y aprenderé.`
    );
  }

  const detail = choice.detail;
  const winPct = (detail.winRate * 100).toFixed(1);
  const tiePct = (detail.tieRate * 100).toFixed(1);
  return message.channel.send(
    `<@${playerId}> Consejo: **${choice.decision.toUpperCase()}** suele rendir mejor aquí. WinRate ${winPct}% | Tie ${tiePct}% | Muestras ${detail.plays}/${stats.totalSamples}.`
  );
}

export async function onMessageCreate(message) {
  try {
    if (message.partial) {
      await message.fetch();
    }
    if (!message.author) return;

    // Track commands from humans
    if (!message.author.bot && isBlackjackCommand(message.content)) {
      pendingCommands.set(message.channelId, { playerId: message.author.id, at: Date.now() });
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
    initialHand: {
      cards: state.playerCards,
      total: state.playerTotal,
    },
    dealerCard: state.dealerUpCard,
    lastTotal: state.playerTotal,
    lastBet: state.betAmount,
    pendingDecision: null,
  };

  games.set(message.id, record);

  if (playerId && state.playerTotal != null && state.dealerUpCard) {
    await respondWithAdvice(message, state, playerId);
  }

  const outcome = detectOutcome(embed);
  if (outcome) {
    await persistAndClear(message.id, state, outcome, 'stand');
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

  let decision = null;
  if (record.lastBet && state.betAmount && state.betAmount > record.lastBet) {
    decision = 'double';
  } else if (record.lastTotal && state.playerTotal && state.playerTotal > record.lastTotal) {
    decision = 'hit';
  }

  if (decision) {
    record.pendingDecision = decision;
  }

  record.lastTotal = state.playerTotal ?? record.lastTotal;
  record.lastBet = state.betAmount ?? record.lastBet;
  games.set(message.id, record);

  const outcome = detectOutcome(embed);
  if (outcome) {
    const finalDecision = record.pendingDecision || 'stand';
    await persistAndClear(message.id, state, outcome, finalDecision);
  }
}

async function persistAndClear(messageId, state, outcome, decision) {
  const record = games.get(messageId);
  if (!record || !record.playerId) {
    games.delete(messageId);
    return;
  }

  const finalCards = state.playerCards && state.playerCards.length ? state.playerCards : record.initialHand.cards;
  const finalTotal = state.playerTotal ?? record.lastTotal ?? record.initialHand.total;

  await Hand.create({
    playerId: record.playerId,
    guildId: record.guildId,
    channelId: record.channelId,
    betAmount: record.lastBet,
    initialHand: record.initialHand,
    dealerCard: record.dealerCard,
    decision,
    finalHand: {
      cards: finalCards,
      total: finalTotal,
      result: outcome,
    },
  });

  games.delete(messageId);
}
