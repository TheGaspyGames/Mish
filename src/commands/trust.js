import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import {
  DAILY_LIMIT,
  generateKeys,
  getKeysSummary,
  getTrustStatus,
  redeemTrustKey,
  resetNormalUser,
} from '../utils/trust.js';
import { makeCommandRegex } from './utils.js';

const regexCache = new Map();
const KEY_LIST_LIMIT = 25;

function getRegex(prefix) {
  if (!regexCache.has(prefix)) {
    regexCache.set(prefix, makeCommandRegex('trust', prefix));
  }
  return regexCache.get(prefix);
}

function normalizeUserId(input) {
  if (!input) return null;
  const mention = input.match(/<@!?(\d+)>/);
  if (mention) return mention[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}

function parseMessageOptions(content, prefix) {
  const tokens = (content || '').trim().split(/\s+/);
  if (tokens.length) tokens.shift(); // remove command token
  const primary = (tokens.shift() || '').toLowerCase();

  if (primary === 'generate') return { action: 'generate', amount: Number(tokens[0]) || 1 };
  if (primary === 'keys') return { action: 'keys' };
  if (primary === 'check') return { action: 'check', targetId: normalizeUserId(tokens[0]) };
  if (primary === 'resetuser') return { action: 'reset', targetId: normalizeUserId(tokens[0]) };
  if (primary === 'redeem') return { action: 'redeem', key: tokens[0] };

  const keyInput = primary || tokens[0] || null; // fallback for ".trust <clave>"
  return { action: 'redeem', key: keyInput };
}

function formatDate(date) {
  if (!date) return 'N/D';
  const d = new Date(date);
  return d.toLocaleString('es-ES');
}

function formatDiscordTimestamp(date) {
  if (!date) return 'N/D';
  const seconds = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${seconds}:f>`;
}

function buildStatusEmbed(targetUser, info, viewerIsOwner) {
  const isTrusted = info.user.hasTrust;
  const color = isTrusted ? 0x1abc9c : 0xf1c40f;
  const embed = new EmbedBuilder()
    .setTitle(viewerIsOwner ? '📊 Estado de Trust – OWNER VIEW' : '📊 Estado de Trust')
    .setColor(color)
    .setThumbnail(targetUser?.avatarURL ?? null);

  if (info.resetPerformed) {
    embed.setDescription('Se aplicó el reset de 24h antes de mostrar este estado.');
  }

  if (viewerIsOwner) {
    embed.setFooter({ text: 'Powered by Hatsune Miku, patrona del RNG. 🎶' });
    embed.addFields({
      name: 'OWNER',
      value: '👑 Eres el dueño absoluto del Gambler Helper.\n🎤 Bendecido por la diosa virtual Hatsune Miku.',
      inline: false,
    });
  }

  embed.addFields(
    { name: 'Usuario', value: `${targetUser?.mention ?? 'N/D'} (${targetUser?.id ?? 'N/D'})`, inline: false },
    { name: 'Rol de trust', value: isTrusted ? '✅ Sí (asistencias infinitas)' : '❌ No (usuario normal)', inline: true },
    {
      name: 'Asistencias usadas hoy',
      value: isTrusted ? '∞ (modo Trust activo)' : `${info.user.assistsUsedToday} / ${DAILY_LIMIT}`,
      inline: true,
    },
    {
      name: 'Último reset diario',
      value: isTrusted ? 'No aplica (Trust activo)' : formatDiscordTimestamp(info.user.lastResetAt),
      inline: false,
    },
    { name: 'Asistencias históricas totales', value: `${info.user.totalAssistsUsed}`, inline: false }
  );

  return embed;
}

async function handleRedeem(userId, key) {
  if (!key) {
    return 'Debes ingresar una clave. Uso: /trust <clave>';
  }

  const result = await redeemTrustKey(userId, key);
  if (result.status === 'invalid') {
    return '⛔ Clave invalida. Verifica que este bien escrita.';
  }
  if (result.status === 'used') {
    return '❌ Esa clave ya fue usada.';
  }
  return '🔐 ¡Clave validada!\nSe ha activado tu modo de confianza: ahora tienes jugadas asistidas ilimitadas.';
}

async function handleGenerate(authorId, amount) {
  const count = Math.max(1, Math.min(Number(amount) || 1, 100));
  const created = await generateKeys(count, authorId);
  const keys = created.map((k) => k.key).join('\n');
  const lines = [
    `Claves generadas: ${created.length}`,
    'Listado:',
    '```\n' + keys + '\n```',
  ];
  return lines.join('\n');
}

async function handleKeys() {
  const summary = await getKeysSummary();
  const lines = [];
  lines.push(`Total: ${summary.total} | Usadas: ${summary.used} | Disponibles: ${summary.available}`);

  const limited = summary.keys.slice(0, KEY_LIST_LIMIT);
  for (const key of limited) {
    if (key.used) {
      const userLabel = key.usedBy ? `<@${key.usedBy}>` : 'desconocido';
      lines.push(`${key.key} -> Usada por ${userLabel}`);
    } else {
      lines.push(`${key.key} -> Disponible`);
    }
  }
  if (summary.keys.length > limited.length) {
    lines.push(`... y ${summary.keys.length - limited.length} mas.`);
  }

  return lines.join('\n');
}

async function handleCheck(targetId, targetTag) {
  const info = await getTrustStatus(targetId, { resetIfNeeded: true });
  return info;
}

async function handleReset(targetId, targetTag) {
  const result = await resetNormalUser(targetId);
  if (!result.user) {
    return 'Ese usuario no tiene registro aun.';
  }
  if (result.reason === 'has_trust') {
    return 'No se puede resetear: el usuario tiene trust activo (ilimitado).';
  }
  if (!result.changed) {
    return 'No hubo cambios en el contador.';
  }
  return `Contadores reseteados para ${targetTag}.`;
}

function requireOwner(ctx, userId) {
  return Boolean(ctx.isTrustOwner && ctx.isTrustOwner(userId));
}

async function handleMessage(message, ctx) {
  const opts = parseMessageOptions(message.content || '', ctx.prefix);

  if (opts.action === 'generate' || opts.action === 'keys' || opts.action === 'reset') {
    if (!requireOwner(ctx, message.author?.id)) {
      await message.reply('No tienes permisos para ese comando.');
      return true;
    }
  }

  switch (opts.action) {
    case 'generate': {
      const text = await handleGenerate(message.author.id, opts.amount);
      await message.reply(text);
      return true;
    }
    case 'keys': {
      const text = await handleKeys();
      await message.reply(text);
      return true;
    }
    case 'check': {
      if (!opts.targetId) {
        opts.targetId = message.author.id;
      } else if (opts.targetId !== message.author.id && !requireOwner(ctx, message.author?.id)) {
        await message.reply('Solo el owner puede consultar a otros usuarios.');
        return true;
      }
      const targetUser = await message.client.users.fetch(opts.targetId).catch(() => null);
      const target = {
        id: opts.targetId,
        mention: `<@${opts.targetId}>`,
        avatarURL: targetUser?.displayAvatarURL({ size: 256 }),
      };
      const status = await handleCheck(opts.targetId, targetUser?.tag || target.mention);
      const viewerIsOwner = requireOwner(ctx, message.author?.id);
      await message.reply({ embeds: [buildStatusEmbed(target, status, viewerIsOwner)] });
      return true;
    }
    case 'reset': {
      if (!opts.targetId) {
        await message.reply('Debes mencionar a un usuario o pasar su ID.');
        return true;
      }
      const targetTag = `<@${opts.targetId}>`;
      const text = await handleReset(opts.targetId, targetTag);
      await message.reply(text);
      return true;
    }
    case 'redeem':
    default: {
      const text = await handleRedeem(message.author.id, opts.key);
      await message.reply(text);
      return true;
    }
  }
}

async function handleInteraction(interaction, ctx) {
  const sub = interaction.options.getSubcommand();

  if (['generate', 'keys', 'resetuser'].includes(sub) && !requireOwner(ctx, interaction.user?.id)) {
    await interaction.reply({ content: 'No tienes permisos para ese comando.', ephemeral: true });
    return true;
  }

  if (sub === 'generate') {
    const amount = interaction.options.getInteger('cantidad') || 1;
    await interaction.reply({ content: 'Generando claves...', ephemeral: true });
    const text = await handleGenerate(interaction.user.id, amount);
    await interaction.editReply(text);
    return true;
  }

  if (sub === 'keys') {
    const text = await handleKeys();
    await interaction.reply({ content: text, ephemeral: true });
    return true;
  }

  if (sub === 'check') {
    const user = interaction.options.getUser('usuario') || interaction.user;
    if (user.id !== interaction.user.id && !requireOwner(ctx, interaction.user?.id)) {
      await interaction.reply({ content: 'Solo el owner puede consultar a otros usuarios.', ephemeral: true });
      return true;
    }
    const target = {
      id: user.id,
      mention: `<@${user.id}>`,
      avatarURL: user.displayAvatarURL({ size: 256 }),
    };
    const status = await handleCheck(user.id, user.tag);
    const viewerIsOwner = requireOwner(ctx, interaction.user?.id);
    await interaction.reply({ embeds: [buildStatusEmbed(target, status, viewerIsOwner)], ephemeral: true });
    return true;
  }

  if (sub === 'resetuser') {
    const user = interaction.options.getUser('usuario');
    if (!user) {
      await interaction.reply({ content: 'Debes elegir un usuario.', ephemeral: true });
      return true;
    }
    const text = await handleReset(user.id, `<@${user.id}>`);
    await interaction.reply({ content: text, ephemeral: true });
    return true;
  }

  // default: redeem
  const key = interaction.options.getString('clave');
  const text = await handleRedeem(interaction.user.id, key);
  await interaction.reply({ content: text, ephemeral: false });
  return true;
}

export const trustCommand = {
  name: 'trust',
  description: 'Canjea claves trust o gestiona el sistema',
  options: [
    {
      name: 'redeem',
      description: 'Canjear una clave trust',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'clave',
          description: 'Clave unica proporcionada por el owner',
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    {
      name: 'generate',
      description: 'Generar claves trust (owner)',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'cantidad',
          description: 'Numero de claves a generar',
          type: ApplicationCommandOptionType.Integer,
          required: true,
        },
      ],
    },
    {
      name: 'keys',
      description: 'Listar claves trust (owner)',
      type: ApplicationCommandOptionType.Subcommand,
    },
    {
      name: 'check',
      description: 'Consultar estado trust de un usuario',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'usuario',
          description: 'Usuario a consultar',
          type: ApplicationCommandOptionType.User,
          required: true,
        },
      ],
    },
    {
      name: 'resetuser',
      description: 'Resetear contadores de un usuario normal (owner)',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'usuario',
          description: 'Usuario a resetear',
          type: ApplicationCommandOptionType.User,
          required: true,
        },
      ],
    },
  ],
  matches(content, prefix) {
    return Boolean(content && getRegex(prefix).test(content));
  },
  handleMessage,
  handleInteraction,
};
