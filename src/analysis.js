import { Hand } from './models/Hand.js';

export async function fetchStats(playerTotal, dealerUpCard) {
  if (playerTotal == null || !dealerUpCard) {
    return { totalSamples: 0, decisions: {} };
  }

  const results = await Hand.aggregate([
    { $match: { 'initialHand.total': playerTotal, dealerCard: dealerUpCard } },
    {
      $group: {
        _id: '$decision',
        plays: { $sum: 1 },
        wins: { $sum: { $cond: [{ $eq: ['$finalHand.result', 'win'] }, 1, 0] } },
        ties: { $sum: { $cond: [{ $eq: ['$finalHand.result', 'tie'] }, 1, 0] } },
      },
    },
  ]);

  const decisions = {};
  let totalSamples = 0;
  for (const row of results) {
    totalSamples += row.plays;
    decisions[row._id] = {
      plays: row.plays,
      winRate: row.plays ? row.wins / row.plays : 0,
      tieRate: row.plays ? row.ties / row.plays : 0,
    };
  }

  return { totalSamples, decisions };
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
