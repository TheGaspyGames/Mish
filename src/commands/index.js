import { calcularCommand } from './calcular.js';
import { removeTrustCommand } from './removetrust.js';
import { trustCommand } from './trust.js';
import { updateCommand } from './update.js';

export const commands = [calcularCommand, updateCommand, trustCommand, removeTrustCommand];

export function findCommandByName(name) {
  return commands.find((c) => c.name === name);
}
