const flavors = {
  almost21: [
    'UFFFFF, cerquísima del 21 👀🔥',
    'Bro… a un soplido del 21 💨',
    'CASIIIII, estás a nada hermano 😭🔥',
    'Hermano, estás literalmente bailando con el 21 💃🕺',
    'OMG, eso fue demasiado cerca… casi me da un infarto 😵‍💫💙',
  ],
  near: [
    'Va bien la cosa, estás cerca 👌🔥',
    'Aún es una buena posición, bien jugado.',
    'No estás mal, la jugada sigue viva.',
    'Te estás acercando, no sueltes el ritmo 🎶.',
    'Buen total, se puede trabajar con esto.',
  ],
  midLuck: [
    'Bro… tu suerte está dudosa 😭',
    'Hmmmm… esa mano está media rara, cuidado.',
    'Ni tan mal, ni tan bien… estás ahí nomás 😂',
    'Podría ser mejor, podría ser peor, vibes mixtas.',
    "Hermano, estás en modo 'veremos qué pasa' 🤣",
  ],
  far: [
    'BROOOOO Y ESA SUERTE 💀💀💀',
    '¿Qué es esa mano? JAJAJA 😭',
    'Hermano… eso parece un 6 del Loto más que blackjack.',
    'Dios mío pana, fuiste bendecido por el anti-RNG.',
    'JAJAJA ese total está a 8 comunas del 21.',
  ],
  bust: [
    'Ya te pasaste bro 😭💀',
    'BUST… te vas directo al infierno del RNG.',
    'Nah… imposible levantar esto 😭',
    'Fin, GG bro 💀',
    'Jajaja qué hiciste bro, esa carta no era 😭🔥',
    'BROOOOO, TE VOLASTE EL 21 COMO SI FUERA NADA 💀💨',
    'Hermano… eso dejó de ser blackjack, ahora estás jugando Jenga.',
    'Dios mío, qué clase de autodestrucción fue esa 😭🔥',
    'JAJAJA bro ese 22 fue criminal.',
    'Eso no es bust, es super bust 🫠',
    'Bro… esa mano murió antes de nacer.',
    'Te fuiste a Marte con ese puntaje 💀🚀',
    'Ese 23 pegó más fuerte que mi vida amorosa.',
    'Nah bro, eso no lo arregla ni Gaspy con buff de suerte.',
    'Hermano… el dealer ni necesitaba jugar, tú solo te eliminaste 😂🔥',
  ],
};

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function getFlavorMessage(playerTotal) {
  if (typeof playerTotal !== 'number' || Number.isNaN(playerTotal)) {
    return 'Sigue atento, cada carta cuenta en el camino al 21.';
  }

  if (playerTotal > 21) {
    return pickRandom(flavors.bust);
  }

  const distance = 21 - playerTotal;
  if (distance >= 0 && distance <= 2) {
    return pickRandom(flavors.almost21);
  }
  if (distance >= 3 && distance <= 5) {
    return pickRandom(flavors.near);
  }
  if (distance >= 6 && distance <= 9) {
    return pickRandom(flavors.midLuck);
  }
  return pickRandom(flavors.far);
}
