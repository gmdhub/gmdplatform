import { execSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const serverDistDir = resolve(projectRoot, 'server/dist');
const envOutputPath = resolve(serverDistDir, '.env');
const serverNodeModulesDir = resolve(projectRoot, 'server/node_modules');
const serverFastifyPackageJson = resolve(serverNodeModulesDir, 'fastify/package.json');
const bundledNodeFilename = process.platform === 'win32' ? 'node.exe' : 'node';
const bundledNodePath = resolve(serverDistDir, 'runtime', bundledNodeFilename);

function run(command) {
  execSync(command, { cwd: projectRoot, stdio: 'inherit' });
}

function ensureServerDependencies() {
  if (existsSync(serverNodeModulesDir) && existsSync(serverFastifyPackageJson)) {
    return;
  }

  console.log('[bundle] server/node_modules non trovato o incompleto: eseguo npm --prefix server ci');
  run('npm --prefix server ci');
}

function bundleNodeRuntime() {
  mkdirSync(resolve(serverDistDir, 'runtime'), { recursive: true });
  copyFileSync(process.execPath, bundledNodePath);
  if (process.platform !== 'win32') {
    chmodSync(bundledNodePath, 0o755);
  }
  console.log(`[bundle] Embedded Node runtime copied: ${process.execPath} -> ${bundledNodePath}`);
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

ensureServerDependencies();
run('npm run build');
run('npm --prefix server run build');
bundleNodeRuntime();
copyRuntimeEnvFile();
