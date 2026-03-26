import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const serverDistDir = resolve(projectRoot, 'server/dist');
const envOutputPath = resolve(serverDistDir, '.env');

function run(command) {
  execSync(command, { cwd: projectRoot, stdio: 'inherit' });
}

function copyRuntimeEnvFile() {
  const candidates = [
    resolve(projectRoot, 'server/.env.prod'),
    resolve(projectRoot, 'server/.env')
  ];

  const selected = candidates.find((candidate) => existsSync(candidate));
  if (selected) {
    copyFileSync(selected, envOutputPath);
    console.log(`[bundle] API env file copied: ${selected} -> ${envOutputPath}`);
    return;
  }

  const fallback = resolve(projectRoot, 'server/.env.prod.example');
  if (existsSync(fallback)) {
    copyFileSync(fallback, envOutputPath);
    console.warn(
      `[bundle] WARNING: no server/.env.prod or server/.env found. Copied fallback ${fallback} -> ${envOutputPath}`
    );
    return;
  }

  console.warn('[bundle] WARNING: API env file not found; bundled API may fail at runtime.');
}

run('npm run build');
run('npm --prefix server run build');
copyRuntimeEnvFile();
