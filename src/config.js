import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

function parseIdList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Edit these IDs directly if you prefer not to use env vars
const HARDCODED_OWNER_ID = '684395420004253729';
const HARDCODED_ALLOWED_UPDATERS = ['684395420004253729'];

const envAllowed = parseIdList(process.env.ALLOWED_UPDATERS || process.env.ALLOWED_UPDATER_IDS);
const allowedUpdaters = Array.from(
  new Set([...HARDCODED_ALLOWED_UPDATERS.map((v) => v.toString()), ...envAllowed])
);

export const config = {
  token: required('DISCORD_TOKEN'),
  mongoUri: required('MONGO_URI'),
  unbBotId: required('UNB_BOT_ID'),
  prefix: process.env.PREFIX || '.',
  updateBranch: process.env.UPDATE_BRANCH || 'main',
  restartCommand: process.env.RESTART_CMD || process.env.UPDATE_RESTART_CMD || '',
  ownerId: process.env.OWNER_ID || HARDCODED_OWNER_ID || null,
  allowedUpdaters,
};
