import { Hand } from './models/Hand.js';
import { buildStateMeta } from './utils/state.js';

function deriveStateMetaFromDoc(doc) {
  if (doc.state?.key) {
    return { ...doc.state, stateKey: doc.state.key };
  }

  const rawState = {
    playerTotal: doc.state?.playerTotal ?? doc.initialHand?.total ?? null,
    dealerUpCard: doc.state?.dealerUpCard ?? doc.dealerCard,
    playerCards: doc.initialHand?.cards ?? [],
    canDouble: doc.state?.canDouble,
    canSplit: doc.state?.canSplit,
  };

  return buildStateMeta(rawState);
}

export async function analyzeStateStats(stateInput) {
  const target = buildStateMeta(stateInput || {});
  if (target.playerTotal == null || !target.dealerUpCard) {
    return { target, totalPlays: 0, actions: {}, bestAction: null };
  }

  const query = target.stateKey
    ? {
        $or: [
          { 'state.key': target.stateKey },
          { 'state.key': { $exists: false }, dealerCard: target.dealerUpCard, 'initialHand.total': target.playerTotal },
        ],
      }
    : { dealerCard: target.dealerUpCard, 'initialHand.total': target.playerTotal };

  const docs = await Hand.find(query, null, { lean: true }).exec();

  const actions = {};
  let totalPlays = 0;

  for (const doc of docs) {
    const meta = deriveStateMetaFromDoc(doc);
    if (meta.stateKey !== target.stateKey) continue;

    const outcome = doc.finalHand?.result;
    const decision = doc.decision || 'unknown';
    const bet = doc.betAmount || 1;

    const profit = outcome === 'win' ? bet : outcome === 'lose' ? -bet : 0;

    const bucket = actions[decision] || {
      plays: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      totalProfit: 0,
      totalBet: 0,
      ev: 0,
    };

    bucket.plays += 1;
    totalPlays += 1;
    bucket.totalProfit += profit;
    bucket.totalBet += bet;
    if (outcome === 'win') bucket.wins += 1;
    else if (outcome === 'lose') bucket.losses += 1;
    else bucket.pushes += 1;

    actions[decision] = bucket;
  }

  for (const detail of Object.values(actions)) {
    detail.ev = detail.totalBet ? detail.totalProfit / detail.totalBet : 0;
  }

  const bestAction = pickBestAction(actions);

  return { target, totalPlays, actions, bestAction };
}

export function pickBestAction(actions) {
  let best = null;
  for (const [name, detail] of Object.entries(actions)) {
    if (!best) {
      best = { name, detail };
      continue;
    }
    if (detail.ev > best.detail.ev) {
      best = { name, detail };
    } else if (detail.ev === best.detail.ev && detail.plays > best.detail.plays) {
      best = { name, detail };
    }
  }
  return best;
}

export async function fetchStats(playerTotal, dealerUpCard) {
  const analysis = await analyzeStateStats({ playerTotal, dealerUpCard });
  const decisions = {};
  for (const [decision, detail] of Object.entries(analysis.actions)) {
    decisions[decision] = {
      plays: detail.plays,
      winRate: detail.plays ? detail.wins / detail.plays : 0,
      tieRate: detail.plays ? detail.pushes / detail.plays : 0,
    };
  }
  return { totalSamples: analysis.totalPlays, decisions };
}

export function pickDecision(stats) {
  const entries = Object.entries(stats.decisions);
  if (!entries.length) {
    return { decision: null, detail: null };
  }

  const best = entries.reduce((curr, [name, detail]) => {
    if (!curr) return [name, detail];
    if (detail.winRate > curr[1].winRate) return [name, detail];
    if (detail.winRate === curr[1].winRate && detail.tieRate > curr[1].tieRate) return [name, detail];
    return curr;
  }, null);

  return { decision: best[0], detail: best[1] };
}
