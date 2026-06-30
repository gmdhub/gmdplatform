import { spawn } from 'node:child_process';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const child = spawn(npmBin, ['run', 'dev'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env
});

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }

  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    process.exit(code);
  }, 3000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

child.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error('[frontend] failed to start:', error);
  shutdown(1);
});

child.on('exit', (code, signal) => {
  if (shuttingDown) {
    return;
  }
  const status = signal ? `signal ${signal}` : `code ${code ?? 0}`;
  // eslint-disable-next-line no-console
  console.error(`[frontend] terminated with ${status}`);
  shutdown(typeof code === 'number' ? code : 1);
});
