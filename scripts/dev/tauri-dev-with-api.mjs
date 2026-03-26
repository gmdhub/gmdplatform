import { spawn } from 'node:child_process';
import net from 'node:net';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();
let shuttingDown = false;

function resolveApiTarget() {
  const fallbackUrl = 'http://127.0.0.1:8787';
  const raw = process.env.VITE_API_BASE_URL?.trim() || fallbackUrl;

  try {
    const url = new URL(raw);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    return {
      host: url.hostname,
      port,
      isLocal: ['127.0.0.1', 'localhost', '0.0.0.0'].includes(url.hostname)
    };
  } catch {
    return {
      host: '127.0.0.1',
      port: 8787,
      isLocal: true
    };
  }
}

function isPortOpen(host, port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function spawnNpm(args, label) {
  const child = spawn(npmBin, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env
  });

  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      return;
    }

    const status = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${label}] terminated with ${status}`);

    shutdown(typeof code === 'number' ? code : 1);
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[${label}] failed to start:`, error);
    shutdown(1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore child kill errors during shutdown
    }
  }

  setTimeout(() => {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore force kill failures
      }
    }
    process.exit(exitCode);
  }, 3000).unref();

  if (children.size === 0) {
    process.exit(exitCode);
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const frontendChild = spawnNpm(['run', 'dev'], 'frontend');

const apiTarget = resolveApiTarget();
if (!apiTarget.isLocal) {
  console.log(`[api] skipped local autostart: VITE_API_BASE_URL points to remote host ${apiTarget.host}`);
} else {
  const alreadyListening = await isPortOpen(apiTarget.host === '0.0.0.0' ? '127.0.0.1' : apiTarget.host, apiTarget.port);
  if (alreadyListening) {
    console.log(`[api] already running on ${apiTarget.host}:${apiTarget.port}, autostart skipped`);
  } else {
    spawnNpm(['run', 'api:dev:safe'], 'api');
  }
}

frontendChild.on('exit', () => {
  if (!shuttingDown) {
    shutdown(0);
  }
});
