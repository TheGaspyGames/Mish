// Utilities to read UnbelievaBot blackjack embeds. The exact wording may vary
// per server/theme, so adjust the regex if your embeds look different.

function embedText(embed) {
  const pieces = [];
  if (embed.title) pieces.push(embed.title);
  if (embed.description) pieces.push(embed.description);
  if (Array.isArray(embed.fields)) {
    for (const field of embed.fields) {
      if (field.name) pieces.push(field.name);
      if (field.value) pieces.push(field.value);
    }
  }
  return pieces.filter(Boolean).join('\n');
}

export function isBlackjackEmbed(embed) {
  const txt = embedText(embed).toLowerCase();
  return txt.includes('blackjack');
}

export function parseBlackjackState(embed) {
  const raw = embedText(embed);
  const lower = raw.toLowerCase();

  const totalMatch = lower.match(/total[^0-9]*([0-9]{1,2})/);
  const dealerMatch = lower.match(/dealer[^akqj0-9]*([akqj]|10|[2-9])/);
  const betMatch = lower.match(/(bet|apuesta)[^0-9]*([0-9][0-9,\.]*)/);

  // Card lines are usually after "hand" or similar; keep as loose tokens
  const cardLine = raw
    .split('\n')
    .find((line) => line.toLowerCase().includes('hand') && line.includes(','));
  const playerCards = cardLine
    ? cardLine
        .split(':').pop()
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  return {
    raw,
    playerTotal: totalMatch ? Number(totalMatch[1]) : null,
    dealerUpCard: dealerMatch ? dealerMatch[1].toUpperCase() : null,
    betAmount: betMatch ? Number(betMatch[2].replace(/[,\.]/g, '')) : null,
    playerCards,
  };
}

export function detectOutcome(embed) {
  const txt = embedText(embed).toLowerCase();
  if (txt.includes('you won') || txt.includes('ganaste')) return 'win';
  if (txt.includes('you lost') || txt.includes('perdiste')) return 'lose';
  if (txt.includes('push') || txt.includes('tie') || txt.includes('empate')) return 'tie';
  return null;
}
