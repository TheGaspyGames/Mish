import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { TrustUser } from '../models/TrustUser.js';

const OWNER_ID = '684395420004253729';

async function handleInteraction(interaction) {
  if (interaction.user.id !== OWNER_ID) {
    await interaction.reply({ content: '⛔ Este comando solo puede ser usado por el propietario del bot.', ephemeral: true });
    return true;
  }

  const targetUser = interaction.options.getUser('usuario');
  if (!targetUser) {
    await interaction.reply({ content: 'Debes elegir un usuario.', ephemeral: true });
    return true;
  }

  if (targetUser.bot) {
    await interaction.reply({ content: '⛔ No puedes remover trust a un bot.', ephemeral: true });
    return true;
  }

  const trustUser = await TrustUser.findOne({ userId: targetUser.id });
  if (!trustUser || !trustUser.hasTrust) {
    await interaction.reply({ content: 'Ese usuario no tiene trust asignado.', ephemeral: true });
    return true;
  }

  trustUser.hasTrust = false;
  trustUser.assistsUsedToday = 0;
  trustUser.lastResetAt = new Date();
  await trustUser.save();

  const embed = new EmbedBuilder()
    .setTitle('🔧 Trust removido')
    .setColor(0xff0000)
    .setDescription('Se ha removido el trust de este usuario exitosamente.')
    .addFields(
      { name: 'Usuario', value: `${targetUser} (${targetUser.id})`, inline: false },
      { name: 'Trust activo', value: 'No', inline: true }
    );

  console.log(`[trust] Trust removido para ${targetUser.tag} (${targetUser.id}) por ${interaction.user.tag}`);

  await interaction.reply({ embeds: [embed], ephemeral: false });
  return true;
}

export const removeTrustCommand = {
  name: 'removetrust',
  description: 'Remover manualmente el trust de un usuario (owner)',
  options: [
    {
      name: 'usuario',
      description: 'Usuario al que se le removerá el trust',
      type: ApplicationCommandOptionType.User,
      required: true,
    },
  ],
  matches() {
    return false;
  },
  async handleInteraction(interaction) {
    return handleInteraction(interaction);
  },
};
