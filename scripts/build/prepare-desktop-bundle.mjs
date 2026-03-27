import { execSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const serverDistSourceDir = resolve(projectRoot, 'server/dist');
const serverNodeModulesDir = resolve(projectRoot, 'server/node_modules');
const serverFastifyPackageJson = resolve(serverNodeModulesDir, 'fastify/package.json');
const desktopRuntimeDir = resolve(projectRoot, 'desktop-runtime');
const embeddedServerDir = resolve(desktopRuntimeDir, 'server');
const embeddedServerDistDir = resolve(embeddedServerDir, 'dist');
const envOutputPath = resolve(embeddedServerDistDir, '.env');
const bundledNodeFilename = process.platform === 'win32' ? 'node.exe' : 'node';
const bundledNodePath = resolve(embeddedServerDistDir, 'runtime', bundledNodeFilename);
const LOCALHOST_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1']);
const VALID_DESKTOP_API_MODES = new Set(['remote', 'embedded']);

function run(command) {
  execSync(command, { cwd: projectRoot, stdio: 'inherit' });
}

function runCapture(command) {
  return String(execSync(command, { cwd: projectRoot, encoding: 'utf8' })).trim();
}

function ensureServerDependencies() {
  if (existsSync(serverNodeModulesDir) && existsSync(serverFastifyPackageJson)) {
    return;
  }

  console.log('[bundle] server/node_modules non trovato o incompleto: eseguo npm --prefix server ci');
  run('npm --prefix server ci');
}

function resolveDesktopApiMode() {
  const explicitMode = String(process.env.GMD_DESKTOP_API_MODE ?? '')
    .trim()
    .toLowerCase();
  if (explicitMode) {
    if (!VALID_DESKTOP_API_MODES.has(explicitMode)) {
      throw new Error(
        `[bundle] Invalid GMD_DESKTOP_API_MODE="${explicitMode}". Allowed values: remote | embedded`
      );
    }
    return explicitMode;
  }

  const appEnv = String(process.env.VITE_APP_ENV ?? '').trim().toLowerCase();
  return appEnv === 'production' ? 'remote' : 'embedded';
}

function normalizeApiBaseUrl(rawValue) {
  const raw = rawValue.trim();
  if (!raw) {
    throw new Error(
      '[bundle] VITE_API_BASE_URL obbligatorio in modalità remote. Inserisci URL HTTPS pubblico (es: https://api.example.com).'
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch {
    throw new Error(
      `[bundle] VITE_API_BASE_URL non valido (${raw}). Inserisci un URL assoluto HTTPS valido.`
    );
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(
      `[bundle] VITE_API_BASE_URL deve usare HTTPS in release remote. Valore attuale: ${raw}`
    );
  }

  if (LOCALHOST_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error(
      `[bundle] VITE_API_BASE_URL non può puntare a localhost in release remote. Valore attuale: ${raw}`
    );
  }

  return parsedUrl.origin;
}

function resetDesktopRuntimeDirectory() {
  rmSync(desktopRuntimeDir, { recursive: true, force: true });
  mkdirSync(desktopRuntimeDir, { recursive: true });
}

function writeDesktopRuntimeMetadata(mode, details = {}) {
  writeFileSync(
    resolve(desktopRuntimeDir, 'mode.json'),
    JSON.stringify(
      {
        mode,
        generatedAt: new Date().toISOString(),
        ...details
      },
      null,
      2
    )
  );
}

function copyEmbeddedServerRuntime() {
  cpSync(serverDistSourceDir, embeddedServerDistDir, { recursive: true });
  cpSync(serverNodeModulesDir, resolve(embeddedServerDir, 'node_modules'), { recursive: true });
  copyFileSync(resolve(projectRoot, 'server/package.json'), resolve(embeddedServerDir, 'package.json'));
}

function listDynamicLibraries(binaryPath) {
  if (process.platform !== 'darwin') {
    return [];
  }

  try {
    const output = runCapture(`otool -L "${binaryPath}"`);
    return output
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(' ')[0]);
  } catch {
    return [];
  }
}

function hasHomebrewLinkedLibraries(binaryPath) {
  const libs = listDynamicLibraries(binaryPath);
  return libs.some(
    (libPath) =>
      libPath.startsWith('/opt/homebrew/') ||
      libPath.startsWith('/usr/local/opt/') ||
      libPath.startsWith('/usr/local/Cellar/')
  );
}

function resolvePortableNodeBinary() {
  if (process.platform !== 'darwin') {
    return process.execPath;
  }

  if (!hasHomebrewLinkedLibraries(process.execPath)) {
    return process.execPath;
  }

  const nodeVersion = process.version.replace(/^v/, '');
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  if (!arch) {
    throw new Error(`[bundle] Architettura Node non supportata per runtime portabile: ${process.arch}`);
  }

  const runtimeDir = resolve(embeddedServerDistDir, 'runtime');
  const archiveName = `node-v${nodeVersion}-darwin-${arch}.tar.gz`;
  const archivePath = resolve(runtimeDir, archiveName);
  const extractedDir = resolve(runtimeDir, `node-v${nodeVersion}-darwin-${arch}`);
  const extractedNodePath = resolve(extractedDir, 'bin', 'node');
  const downloadUrl = `https://nodejs.org/dist/v${nodeVersion}/${archiveName}`;

  if (!existsSync(extractedNodePath)) {
    console.warn(
      `[bundle] Node locale non portabile (link Homebrew). Scarico runtime ufficiale da ${downloadUrl}`
    );
    run(`curl -L --fail -o "${archivePath}" "${downloadUrl}"`);
    run(`tar -xzf "${archivePath}" -C "${runtimeDir}"`);
  }

  if (!existsSync(extractedNodePath)) {
    throw new Error(`[bundle] Runtime Node portabile non trovato dopo estrazione: ${extractedNodePath}`);
  }

  if (hasHomebrewLinkedLibraries(extractedNodePath)) {
    throw new Error('[bundle] Runtime Node scaricato non è portabile (dipendenze Homebrew rilevate).');
  }

  return extractedNodePath;
}

function bundleNodeRuntime() {
  mkdirSync(resolve(embeddedServerDistDir, 'runtime'), { recursive: true });
  const sourceNodePath = resolvePortableNodeBinary();
  copyFileSync(sourceNodePath, bundledNodePath);
  if (process.platform !== 'win32') {
    chmodSync(bundledNodePath, 0o755);
  }
  console.log(`[bundle] Embedded Node runtime copied: ${sourceNodePath} -> ${bundledNodePath}`);
}

function copyRuntimeEnvFile() {
  const productionEnvFile = resolve(projectRoot, 'server/.env.prod');
  const localEnvFile = resolve(projectRoot, 'server/.env');
  const selected = existsSync(productionEnvFile)
    ? productionEnvFile
    : existsSync(localEnvFile)
      ? localEnvFile
      : null;

  if (!selected) {
    throw new Error(
      '[bundle] Missing server runtime env file. Required: server/.env.prod (preferred) or server/.env.'
    );
  }

  copyFileSync(selected, envOutputPath);
  const content = readFileSync(envOutputPath, 'utf8');
  const looksLikePlaceholder = /replace-with-|REPLACE_|<prod-project-ref>|\[YOUR-PASSWORD\]/i.test(content);
  if (looksLikePlaceholder) {
    throw new Error(
      `[bundle] Runtime env appears invalid (placeholder values found) in ${selected}. Build aborted.`
    );
  }

  const requiredKeys = [
    'APP_ENV',
    'API_HOST',
    'API_PORT',
    'API_JWT_SECRET',
    'SUPABASE_DB_URL',
    'SUPABASE_PROJECT_REF_EXPECTED',
    'SUPABASE_PROD_PROJECT_REF'
  ];

  const envValues = new Map();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    envValues.set(key, value);
  }

  const missingOrEmptyKeys = requiredKeys.filter((key) => {
    const value = envValues.get(key);
    return !value || value.length === 0;
  });

  if (missingOrEmptyKeys.length > 0) {
    throw new Error(
      `[bundle] Runtime env missing/empty keys (${missingOrEmptyKeys.join(', ')}) in ${selected}. Build aborted.`
    );
  }

  console.log(`[bundle] API env file copied: ${selected} -> ${envOutputPath}`);
}

const desktopApiMode = resolveDesktopApiMode();
let normalizedRemoteApiBaseUrl = null;

if (desktopApiMode === 'remote') {
  normalizedRemoteApiBaseUrl = normalizeApiBaseUrl(String(process.env.VITE_API_BASE_URL ?? ''));
  process.env.VITE_API_BASE_URL = normalizedRemoteApiBaseUrl;
}

run('npm run build');
resetDesktopRuntimeDirectory();

if (desktopApiMode === 'remote') {
  writeDesktopRuntimeMetadata('remote', { apiBaseUrl: normalizedRemoteApiBaseUrl });
  console.log(`[bundle] Desktop API mode: remote (${normalizedRemoteApiBaseUrl})`);
} else {
  ensureServerDependencies();
  run('npm --prefix server run build');
  copyEmbeddedServerRuntime();
  bundleNodeRuntime();
  copyRuntimeEnvFile();
  writeDesktopRuntimeMetadata('embedded');
  console.log('[bundle] Desktop API mode: embedded');
}
