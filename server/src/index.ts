import { env } from './config/env.js';
import { buildApp } from './app.js';

async function start() {
  const app = await buildApp();
  app.log.info({
    appEnv: env.APP_ENV,
    projectRefActual: env.SUPABASE_PROJECT_REF_ACTUAL,
    projectRefExpected: env.SUPABASE_PROJECT_REF_EXPECTED
  }, 'API environment guard active');
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(`API listening on ${env.API_HOST}:${env.API_PORT}`);
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
