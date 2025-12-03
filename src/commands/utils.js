function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makeCommandRegex(name, prefix = '.') {
  const pre = escapeRegExp(prefix || '.');
  return new RegExp(`^\\s*(?:\\/|${pre}|<@!?\\d+>\\s*)?${name}\\b`, 'i');
}

export function parseBool(value, fallback) {
  if (value == null) return fallback;
  const normalized = value.toString().trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'si', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}
