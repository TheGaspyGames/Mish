import { ApplicationCommandOptionType } from 'discord.js';
import { config } from '../config.js';
import { getUpdateStatus, needsRestart, performUpdate, restartProcess, rollbackLastReset } from '../utils/updater.js';
import { makeCommandRegex } from './utils.js';

const regexCache = new Map();

function getRegex(prefix) {
  if (!regexCache.has(prefix)) {
    regexCache.set(prefix, makeCommandRegex('update', prefix));
  }
  return regexCache.get(prefix);
}

function parseUpdateOptions(content, prefix) {
  const tokens = (content || '').trim().split(/\s+/);
  if (tokens.length) {
    tokens.shift(); // drop command
  }
  const result = { mode: 'update', force: false };

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'status') result.mode = 'status';
    else if (lower === 'force') {
      result.mode = 'update';
      result.force = true;
    } else if (lower === 'rollback') {
      result.mode = 'rollback';
    }
  }

  return result;
}

async function runUpdate(opts) {
  const branch = config.updateBranch || 'main';
  if (opts.mode === 'status') {
    const status = await getUpdateStatus(branch);
    const lines = [
      '📡 Estado del repo',
      `Rama objetivo: ${branch}`,
      `Local: ${status.localRef}`,
      `Remoto: ${status.remoteRef}`,
      `Divergencia -> behind ${status.behind} | ahead ${status.ahead}`,
      status.dirty ? '⚠️ Hay cambios locales sin commit.' : '✅ Working tree limpia.',
    ];
    return lines.join('\n');
  }

  if (opts.mode === 'rollback') {
    const res = await rollbackLastReset();
    const lines = ['↩️ Rollback ejecutado (git reset --hard HEAD@{1})', `HEAD actual: ${res.head}`];
    return lines.join('\n');
  }

  const result = await performUpdate(branch, { force: opts.force });
  const changed = result.changed || [];
  const lines = ['📥 Descargando ultima version del repositorio...', `De ${result.oldHead} a ${result.newHead}`];

  if (!changed.length) {
    lines.push('No hay cambios nuevos. El repositorio ya estaba actualizado.');
  } else {
    lines.push('Archivos actualizados:');
    const list = changed.slice(0, 10).map((f) => `- ${f}`);
    lines.push(...list);
    if (changed.length > list.length) {
      lines.push(`... y ${changed.length - list.length} mas.`);
    }
  }

  const restartNeeded = needsRestart(changed);
  if (restartNeeded) {
    if (config.restartCommand) {
      lines.push('🚀 Reiniciando bot...');
      try {
        const restartRes = await restartProcess(config.restartCommand);
        if (!restartRes.skipped) {
          lines.push('Reinicio lanzado.');
        }
      } catch (restartErr) {
        console.error('[update] restart error', restartErr);
        lines.push('⚠️ No se pudo reiniciar automaticamente, hazlo manualmente.');
      }
    } else {
      lines.push('ℹ️ Cambios detectados en codigo/config. Reinicia el proceso manualmente.');
    }
  } else {
    lines.push('No se requiere reinicio (sin cambios en codigo/config).');
  }

  return lines.join('\n');
}

async function handleMessage(message, ctx) {
  if (!ctx.isAllowedUpdater(message.author?.id)) {
    await message.reply('⛔ No tienes permisos para usar /update.');
    return true;
  }

  const opts = parseUpdateOptions(message.content || '', ctx.prefix);
  try {
    const text = await runUpdate(opts);
    await message.reply(text);
  } catch (err) {
    console.error('[update] message error', err);
    const lines = ['❌ Error al actualizar.'];
    if (err.code === 'DIRTY') {
      lines.push('Hay cambios locales sin commit. Usa ".update force" para forzar el reset.');
    }
    await message.reply(lines.join('\n'));
  }
  return true;
}

async function handleInteraction(interaction, ctx) {
  if (!ctx.isAllowedUpdater(interaction.user?.id)) {
    await interaction.reply({ content: '⛔ No tienes permisos para usar /update.', ephemeral: true });
    return true;
  }

  const modeOpt = interaction.options.getString('modo') || 'update';
  const opts = {
    mode: modeOpt === 'force' ? 'update' : modeOpt,
    force: modeOpt === 'force',
  };

  await interaction.deferReply({ ephemeral: false });
  try {
    const text = await runUpdate(opts);
    await interaction.editReply(text);
  } catch (err) {
    console.error('[update] interaction error', err);
    const lines = ['❌ Error al actualizar.'];
    if (err.code === 'DIRTY') {
      lines.push('Hay cambios locales sin commit. Usa modo "force" para forzar el reset.');
    }
    await interaction.editReply(lines.join('\n'));
  }
  return true;
}

export const updateCommand = {
  name: 'update',
  description: 'Actualizar el bot desde git',
  options: [
    {
      name: 'modo',
      description: 'status | update | force | rollback',
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: 'status', value: 'status' },
        { name: 'update', value: 'update' },
        { name: 'force', value: 'force' },
        { name: 'rollback', value: 'rollback' },
      ],
    },
  ],
  matches(content, prefix) {
    return Boolean(content && getRegex(prefix).test(content));
  },
  handleMessage,
  handleInteraction,
};
