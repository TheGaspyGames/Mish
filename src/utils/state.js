const HIGH_CARDS = new Set(['10', 'J', 'Q', 'K']);

export function normalizeCardRank(card) {
  if (!card) return null;
  const cleaned = card.toString().trim().toUpperCase();
  const match = cleaned.match(/(10|[2-9]|A|K|Q|J)/);
  return match ? match[1] : null;
}

function cardNumericValue(rank) {
  if (!rank) return 0;
  if (rank === 'A') return 11;
  if (HIGH_CARDS.has(rank)) return 10;
  const n = Number(rank);
  return Number.isFinite(n) ? n : 0;
}

function computeIsSoft(cards, playerTotal) {
  if (playerTotal == null || !Array.isArray(cards) || !cards.length) return false;
  const ranks = cards.map(normalizeCardRank).filter(Boolean);
  const aceCount = ranks.filter((r) => r === 'A').length;
  if (!aceCount) return false;

  const nonAceSum = ranks.reduce((sum, rank) => {
    if (rank === 'A') return sum;
    return sum + (HIGH_CARDS.has(rank) ? 10 : Number(rank));
  }, 0);
  const minTotal = nonAceSum + aceCount; // all aces as 1
  return playerTotal <= 21 && playerTotal === minTotal + 10;
}

export function buildStateMeta(rawState = {}) {
  const playerCards = Array.isArray(rawState.playerCards) ? rawState.playerCards.filter(Boolean) : [];
  const playerTotal = rawState.playerTotal ?? null;
  const dealerUpCard = normalizeCardRank(rawState.dealerUpCard);

  const ranks = playerCards.map(normalizeCardRank).filter(Boolean);
  const isPair = ranks.length === 2 && ranks[0] && ranks[0] === ranks[1];
  const isSoft = rawState.playerIsSoft ?? computeIsSoft(ranks, playerTotal);
  const canDouble = rawState.canDouble ?? ranks.length === 2;
  const canSplit = rawState.canSplit ?? (isPair && ranks.length === 2);

  const meta = {
    playerCards: ranks,
    playerTotal,
    dealerUpCard,
    isSoft,
    isPair,
    canDouble,
    canSplit,
  };

  return {
    ...meta,
    stateKey: buildStateKey(meta),
  };
}

export function buildStateKey(meta) {
  const totalLabel = meta.playerTotal ?? 'NA';
  const dealerLabel = meta.dealerUpCard ?? 'UNK';
  const softLabel = meta.isSoft ? 'soft' : 'hard';
  const pairLabel = meta.isPair ? 'pair' : 'nopair';
  const dblLabel = meta.canDouble ? 'dbl' : 'nodbl';
  const splitLabel = meta.canSplit ? 'split' : 'nosplit';
  return `bj:${softLabel}:${totalLabel}:d${dealerLabel}:${pairLabel}:${dblLabel}:${splitLabel}`;
}

export function describeState(meta) {
  const typeLabel = meta.isSoft ? 'soft' : 'hard';
  const dealerLabel = meta.dealerUpCard ?? '?';
  const totalLabel = meta.playerTotal ?? '?';
  return `${totalLabel} ${typeLabel} vs ${dealerLabel}`;
}

export function mergeStates(prev = {}, next = {}) {
  return {
    playerTotal: next.playerTotal ?? prev.playerTotal ?? null,
    dealerUpCard: next.dealerUpCard ?? prev.dealerUpCard ?? null,
    betAmount: next.betAmount ?? prev.betAmount ?? null,
    playerIsSoft: next.playerIsSoft ?? prev.playerIsSoft ?? null,
    playerCards:
      Array.isArray(next.playerCards) && next.playerCards.length
        ? [...next.playerCards]
        : Array.isArray(prev.playerCards)
          ? [...prev.playerCards]
          : [],
    raw: next.raw ?? prev.raw ?? null,
    canDouble: next.canDouble ?? prev.canDouble ?? null,
    canSplit: next.canSplit ?? prev.canSplit ?? null,
  };
}

export function dealerCardValue(rank) {
  return cardNumericValue(normalizeCardRank(rank));
}
