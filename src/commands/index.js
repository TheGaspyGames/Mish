import { calcularCommand } from './calcular.js';
import { updateCommand } from './update.js';

export const commands = [calcularCommand, updateCommand];

export function findCommandByName(name) {
  return commands.find((c) => c.name === name);
}
