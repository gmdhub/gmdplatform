import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

function printUsageAndExit(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    [
      'Usage:',
      '  node scripts/env/run-with-env-file.mjs --env-file <path> [--set KEY=VALUE ...] -- <command> [args...]'
    ].join('\n')
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const commandSeparator = args.indexOf('--');
if (commandSeparator === -1) {
  printUsageAndExit('Missing command separator `--`.');
}

const optionArgs = args.slice(0, commandSeparator);
const commandArgs = args.slice(commandSeparator + 1);
if (commandArgs.length === 0) {
  printUsageAndExit('Missing command to execute.');
}

let envFile = '';
const envOverrides = {};

for (let i = 0; i < optionArgs.length; i += 1) {
  const option = optionArgs[i];
  if (option === '--env-file') {
    envFile = optionArgs[i + 1] ?? '';
    i += 1;
    continue;
  }

  if (option === '--set') {
    const pair = optionArgs[i + 1] ?? '';
    i += 1;
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) {
      printUsageAndExit(`Invalid --set value: ${pair}`);
    }
    const key = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);
    envOverrides[key] = value;
    continue;
  }

  printUsageAndExit(`Unsupported option: ${option}`);
}

if (!envFile.trim()) {
  printUsageAndExit('Missing --env-file value.');
}

const resolvedEnvFile = resolve(envFile.trim());
if (!existsSync(resolvedEnvFile)) {
  printUsageAndExit(`Env file not found: ${resolvedEnvFile}`);
}

function parseEnvFile(filePath) {
  const parsed = {};
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }

    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

let command = commandArgs[0];
if (!command) {
  printUsageAndExit('Missing command.');
}

if (process.platform === 'win32') {
  if (command === 'npm') {
    command = 'npm.cmd';
  } else if (command === 'npx') {
    command = 'npx.cmd';
  }
}

const child = spawn(command, commandArgs.slice(1), {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...parseEnvFile(resolvedEnvFile),
    GMD_ENV_FILE: resolvedEnvFile,
    ...envOverrides
  }
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
