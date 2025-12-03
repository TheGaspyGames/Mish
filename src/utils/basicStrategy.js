import { dealerCardValue, normalizeCardRank, buildStateMeta } from './state.js';

function pickByDealerRange(dealer, ranges) {
  for (const [test, action] of ranges) {
    if (typeof test === 'function') {
      if (test(dealer)) return action;
    } else if (Array.isArray(test) && test.length === 2) {
      if (dealer >= test[0] && dealer <= test[1]) return action;
    } else if (dealer === test) {
      return action;
    }
  }
  return null;
}

function hardStrategy(total, dealer, canDouble) {
  if (total >= 17) return 'stand';
  if (total === 16) return dealer >= 2 && dealer <= 6 ? 'stand' : 'hit';
  if (total === 15) return dealer >= 2 && dealer <= 6 ? 'stand' : 'hit';
  if (total === 14 || total === 13) return dealer >= 2 && dealer <= 6 ? 'stand' : 'hit';
  if (total === 12) return dealer >= 4 && dealer <= 6 ? 'stand' : 'hit';
  if (total === 11) return canDouble ? 'double' : 'hit';
  if (total === 10) return dealer <= 9 && dealer >= 2 && canDouble ? 'double' : 'hit';
  if (total === 9) return dealer >= 3 && dealer <= 6 && canDouble ? 'double' : 'hit';
  return 'hit';
}

function softStrategy(total, dealer, canDouble) {
  // totals are already the hand total (e.g., soft 18 == 18)
  if (total >= 19) return 'stand';
  if (total === 18) {
    if (dealer >= 3 && dealer <= 6 && canDouble) return 'double';
    if (dealer === 2 || dealer === 7 || dealer === 8) return 'stand';
    return 'hit';
  }
  if (total === 17) return dealer >= 3 && dealer <= 6 && canDouble ? 'double' : 'hit';
  if (total === 16) return dealer >= 4 && dealer <= 6 && canDouble ? 'double' : 'hit';
  if (total === 15) return dealer >= 4 && dealer <= 6 && canDouble ? 'double' : 'hit';
  if (total === 14) return dealer >= 5 && dealer <= 6 && canDouble ? 'double' : 'hit';
  if (total === 13) return dealer >= 5 && dealer <= 6 && canDouble ? 'double' : 'hit';
  return 'hit';
}

function pairStrategy(rank, dealer, canDouble, canSplit) {
  if (!canSplit) return null;

  if (rank === 'A') return 'split';
  if (rank === '10') return 'stand';
  if (rank === '9') {
    if (dealer === 7 || dealer >= 10) return 'stand';
    return 'split';
  }
  if (rank === '8') return dealer >= 2 && dealer <= 9 ? 'split' : 'hit';
  if (rank === '7') return dealer <= 7 ? 'split' : 'hit';
  if (rank === '6') return dealer >= 2 && dealer <= 6 ? 'split' : 'hit';
  if (rank === '5') return canDouble ? 'double' : 'hit';
  if (rank === '4') return dealer >= 5 && dealer <= 6 ? 'split' : 'hit';
  if (rank === '3' || rank === '2') return dealer >= 2 && dealer <= 7 ? 'split' : 'hit';
  return null;
}

export function basicStrategy(meta) {
  const dealerRank = normalizeCardRank(meta.dealerUpCard);
  const dealer = dealerCardValue(dealerRank);
  const total = meta.playerTotal;
  if (!total || !dealer) return null;

  const maybePairRank =
    meta.isPair && Array.isArray(meta.playerCards) && meta.playerCards.length
      ? normalizeCardRank(meta.playerCards[0])
      : null;

  if (meta.isPair && maybePairRank) {
    const action = pairStrategy(maybePairRank, dealer, meta.canDouble, meta.canSplit);
    if (action) {
      return finalizeAction(action, meta);
    }
  }

  const action = meta.isSoft
    ? softStrategy(total, dealer, meta.canDouble)
    : hardStrategy(total, dealer, meta.canDouble);

  return finalizeAction(action, meta);
}

function finalizeAction(action, meta) {
  if (action === 'double' && !meta.canDouble) return 'hit';
  if (action === 'split' && !meta.canSplit) {
    // fall back to hard/soft logic without split
    return meta.isSoft ? softStrategy(meta.playerTotal, dealerCardValue(meta.dealerUpCard), meta.canDouble) : hardStrategy(meta.playerTotal, dealerCardValue(meta.dealerUpCard), meta.canDouble);
  }
  return action;
}

export function getBasicAction(rawState = {}) {
  const meta = rawState.stateKey ? rawState : buildStateMeta(rawState);
  const dealerRank = normalizeCardRank(meta.dealerUpCard);
  const dealer = dealerCardValue(dealerRank);
  const total = meta.playerTotal ?? 0;
  const canDouble = Boolean(meta.canDouble);
  const canSplit = Boolean(meta.canSplit);
  const isPair = Boolean(meta.isPair);
  const isSoft = Boolean(meta.isSoft);
  const pairRank = normalizeCardRank(meta.playerCards?.[0]);

  if (total > 21) return 'NONE';
  if (!dealer || !total) return 'HIT';

  // Splits
  if (isPair && canSplit && pairRank) {
    if (pairRank === 'A' || pairRank === '8') return 'SPLIT';
    if (pairRank === '5' || pairRank === '10' || pairRank === 'J' || pairRank === 'Q' || pairRank === 'K') {
      // Treat as normal hand
    }
  }

  // Soft hands
  if (isSoft) {
    if (total >= 19) return 'STAND';
    if (total === 18) {
      if (dealer >= 3 && dealer <= 6 && canDouble) return 'DOUBLE';
      if (dealer === 2 || dealer === 7 || dealer === 8) return 'STAND';
      return 'HIT';
    }
    if (total >= 13 && total <= 17) {
      if (dealer === 5 || dealer === 6) {
        return canDouble ? 'DOUBLE' : 'HIT';
      }
      return 'HIT';
    }
    return 'HIT';
  }

  // Hard hands
  if (total >= 17) return 'STAND';
  if (total === 16 || total === 15 || total === 14 || total === 13) return dealer >= 2 && dealer <= 6 ? 'STAND' : 'HIT';
  if (total === 12) return dealer >= 4 && dealer <= 6 ? 'STAND' : 'HIT';
  if (total === 11) return canDouble ? 'DOUBLE' : 'HIT';
  if (total === 10) return canDouble && dealer >= 2 && dealer <= 9 ? 'DOUBLE' : 'HIT';
  if (total === 9) return canDouble && dealer >= 3 && dealer <= 6 ? 'DOUBLE' : 'HIT';

  // 5–8 default to HIT
  return 'HIT';
}
