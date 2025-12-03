import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { connectDb, closeDb } from './db.js';
import { config } from './config.js';
import { onInteractionCreate, onMessageCreate, onMessageUpdate, registerSlashCommands } from './tracker.js';

async function main() {
  await connectDb();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel],
  });

  client.once('ready', async () => {
    console.log(`[bot] Logged in as ${client.user.tag}`);
    await registerSlashCommands(client);
  });

  client.on('messageCreate', onMessageCreate);
  client.on('messageUpdate', onMessageUpdate);
  client.on('interactionCreate', onInteractionCreate);

  await client.login(config.token);

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await closeDb();
    client.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
