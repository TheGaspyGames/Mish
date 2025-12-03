import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const RESTART_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.json', '.env', '.config', '.yaml', '.yml'];

async function run(cmd) {
  const { stdout, stderr } = await execAsync(cmd, { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 });
  return { stdout, stderr };
}

function parseLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getUpdateStatus(branch) {
  const fetchRes = await run('git fetch --all --prune');
  const localRef = (await run('git rev-parse HEAD')).stdout.trim();
  const remoteRef = (await run(`git rev-parse origin/${branch}`)).stdout.trim();
  const status = (await run('git status --porcelain')).stdout.trim();
  const aheadBehind = await run(`git rev-list --left-right --count ${localRef}...origin/${branch}`);
  const [behind, ahead] = aheadBehind.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);

  return {
    fetchLog: fetchRes.stdout + fetchRes.stderr,
    localRef,
    remoteRef,
    dirty: Boolean(status),
    behind,
    ahead,
  };
}

export async function performUpdate(branch, { force = false } = {}) {
  const oldHead = (await run('git rev-parse HEAD')).stdout.trim();
  const status = (await run('git status --porcelain')).stdout.trim();
  if (status && !force) {
    const err = new Error('Hay cambios locales sin commitear. Usa "force" para forzar el reset.');
    err.code = 'DIRTY';
    err.details = status;
    throw err;
  }

  const logs = [];
  const fetchRes = await run('git fetch --all --prune');
  logs.push('git fetch --all --prune', fetchRes.stdout, fetchRes.stderr);

  const resetRes = await run(`git reset --hard origin/${branch}`);
  logs.push(`git reset --hard origin/${branch}`, resetRes.stdout, resetRes.stderr);

  const newHead = (await run('git rev-parse HEAD')).stdout.trim();
  const changed =
    oldHead === newHead
      ? []
      : parseLines((await run(`git diff --name-only ${oldHead} ${newHead}`)).stdout);

  return {
    oldHead,
    newHead,
    changed,
    logs: logs.filter(Boolean).join('\n').trim(),
  };
}

export async function rollbackLastReset() {
  const res = await run('git reset --hard HEAD@{1}');
  const head = (await run('git rev-parse HEAD')).stdout.trim();
  return { log: res.stdout + res.stderr, head };
}

export function needsRestart(changedFiles = []) {
  return changedFiles.some((file) => RESTART_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext)));
}

export async function restartProcess(restartCommand) {
  if (!restartCommand) return { skipped: true };
  const res = await run(restartCommand);
  return { skipped: false, log: res.stdout + res.stderr };
}
