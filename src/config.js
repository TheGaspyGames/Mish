import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  mongoUri: required('MONGO_URI'),
  unbBotId: required('UNB_BOT_ID'),
  prefix: process.env.PREFIX || '.',
};
