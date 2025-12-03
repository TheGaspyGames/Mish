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

function extractRanksFromLine(line) {
  if (!line) return [];
  const ranks = [];
  const tokens = line
    .replace(/[,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const token of tokens) {
    const m = token.match(/(10|[2-9]|[AKQJ])/i);
    if (m) ranks.push(m[1].toUpperCase());
  }
  return ranks;
}

function extractHand(lines, marker) {
  const idx = lines.findIndex((l) => l.toLowerCase().includes(marker));
  if (idx === -1) return { cards: [], total: null };
  const cards = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^value/i.test(line)) break;
    if (line.toLowerCase().includes('value')) break;
    const ranks = extractRanksFromLine(line);
    cards.push(...ranks);
    // stop if the line had any ranks to avoid reading further text
    if (ranks.length) break;
  }

  let total = null;
  for (let i = idx + 1; i < Math.min(lines.length, idx + 5); i++) {
    const valLine = lines[i];
    const m = valLine.match(/value:\s*([0-9]{1,2})/i);
    if (m) {
      total = Number(m[1]);
      break;
    }
    if (/value:\s*blackjack/i.test(valLine)) {
      total = 21;
      break;
    }
  }

  return { cards, total };
}

export function isBlackjackEmbed(embed) {
  const txt = embedText(embed).toLowerCase();
  return txt.includes('blackjack') || txt.includes('your hand') || txt.includes('dealer hand');
}

function extractActionsFromMessage(message) {
  if (!message?.components) return {};
  let canDouble = false;
  let canSplit = false;
  for (const row of message.components) {
    for (const comp of row.components || []) {
      const label = (comp.label || '').toLowerCase();
      if (label.includes('double')) {
        canDouble = !comp.disabled;
      }
      if (label.includes('split')) {
        canSplit = !comp.disabled;
      }
    }
  }
  return { canDouble, canSplit };
}

export function parseBlackjackState(embed, message) {
  const raw = embedText(embed);
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const lower = raw.toLowerCase();

  const playerHand = extractHand(lines, 'your hand');
  const dealerHand = extractHand(lines, 'dealer hand');

  const dealerMatch = lower.match(/dealer[^akqj0-9]*([akqj]|10|[2-9])/);
  const betMatch = lower.match(/(bet|apuesta)[^0-9]*([0-9][0-9,\.]*)/);

  const dealerUpCard = dealerHand.cards[0] || (dealerMatch ? dealerMatch[1].toUpperCase() : null);
  const actions = extractActionsFromMessage(message);

  return {
    raw,
    playerTotal: playerHand.total,
    dealerUpCard,
    betAmount: betMatch ? Number(betMatch[2].replace(/[,\.]/g, '')) : null,
    playerCards: playerHand.cards,
    canDouble: actions.canDouble,
    canSplit: actions.canSplit,
  };
}

export function detectOutcome(embed) {
  const txt = embedText(embed).toLowerCase();
  if (txt.includes('result:')) {
    if (txt.includes('loss') || txt.includes('lost') || txt.includes('perdiste')) return 'lose';
    if (txt.includes('dealer bust') || txt.includes('win') || txt.includes('ganaste')) return 'win';
    if (txt.includes('push') || txt.includes('tie') || txt.includes('empate')) return 'tie';
  }
  if (txt.includes('you won') || txt.includes('ganaste')) return 'win';
  if (txt.includes('you lost') || txt.includes('perdiste')) return 'lose';
  if (txt.includes('push') || txt.includes('tie') || txt.includes('empate')) return 'tie';
  return null;
}
