import crypto from 'crypto';
import { TrustKey } from '../models/TrustKey.js';
import { TrustUser } from '../models/TrustUser.js';

export const DAILY_LIMIT = 10;
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeKey(value) {
  return (value || '').trim().toUpperCase();
}

function generateKeyValue() {
  const raw = crypto.randomBytes(10).toString('base64url').toUpperCase();
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function shouldReset(user, now) {
  if (user.hasTrust) return false;
  const last = user.lastResetAt ? new Date(user.lastResetAt).getTime() : 0;
  return !last || now.getTime() - last >= RESET_WINDOW_MS;
}

async function getOrCreateUser(userId, now = new Date()) {
  let user = await TrustUser.findOne({ userId });
  let created = false;
  if (!user) {
    created = true;
    user = await TrustUser.create({
      userId,
      hasTrust: false,
      assistsUsedToday: 0,
      lastResetAt: now,
      totalAssistsUsed: 0,
    });
  }
  return { user, created };
}

export async function checkAndConsumeAssist(userId) {
  const now = new Date();
  const { user, created } = await getOrCreateUser(userId, now);
  let resetPerformed = false;

  if (shouldReset(user, now)) {
    user.assistsUsedToday = 0;
    user.lastResetAt = now;
    resetPerformed = true;
  }

  if (user.hasTrust) {
    if (user.assistsUsedToday !== 0) {
      user.assistsUsedToday = 0;
    }
    user.totalAssistsUsed += 1;
    await user.save();
    return { allowed: true, reason: 'trusted', user, created, resetPerformed };
  }

  if (user.assistsUsedToday >= DAILY_LIMIT) {
    if (resetPerformed) {
      await user.save();
    }
    return { allowed: false, reason: 'limit', user, created, resetPerformed };
  }

  user.assistsUsedToday += 1;
  user.totalAssistsUsed += 1;
  await user.save();
  return { allowed: true, reason: 'normal', user, created, resetPerformed };
}

export async function redeemTrustKey(userId, keyValue) {
  const key = normalizeKey(keyValue);
  if (!key) return { status: 'invalid' };

  const keyDoc = await TrustKey.findOne({ key });
  if (!keyDoc) return { status: 'invalid' };
  if (keyDoc.used) return { status: 'used', key: keyDoc };

  const now = new Date();
  keyDoc.used = true;
  keyDoc.usedBy = userId;
  keyDoc.usedAt = now;
  await keyDoc.save();

  const { user, created } = await getOrCreateUser(userId, now);
  user.hasTrust = true;
  user.assistsUsedToday = 0;
  user.lastResetAt = now;
  await user.save();

  return { status: 'ok', key: keyDoc, user, created };
}

export async function generateKeys(count, ownerId) {
  const target = Math.max(0, Math.min(Number(count) || 0, 500));
  const created = [];
  while (created.length < target) {
    const keyValue = generateKeyValue();
    try {
      const doc = await TrustKey.create({
        key: keyValue,
        used: false,
        usedBy: null,
        usedAt: null,
        createdBy: ownerId || null,
      });
      created.push(doc);
    } catch (err) {
      if (err.code === 11000) continue; // collision, try again
      throw err;
    }
  }
  return created;
}

export async function getKeysSummary() {
  const keys = await TrustKey.find({}).sort({ createdAt: -1 }).lean();
  const used = keys.filter((k) => k.used).length;
  return {
    total: keys.length,
    used,
    available: Math.max(0, keys.length - used),
    keys,
  };
}

export async function getTrustStatus(userId, { resetIfNeeded = false } = {}) {
  const now = new Date();
  const { user, created } = await getOrCreateUser(userId, now);
  let resetPerformed = false;
  if (resetIfNeeded && shouldReset(user, now)) {
    user.assistsUsedToday = 0;
    user.lastResetAt = now;
    resetPerformed = true;
    await user.save();
  }
  return { user, created, resetPerformed };
}

export async function resetNormalUser(userId) {
  const user = await TrustUser.findOne({ userId });
  if (!user) return { user: null, changed: false, reason: 'not_found' };
  if (user.hasTrust) return { user, changed: false, reason: 'has_trust' };

  user.assistsUsedToday = 0;
  user.lastResetAt = new Date();
  await user.save();
  return { user, changed: true };
}
