import { app } from './app.js';
import { disconnectDatabase } from './database.js';
import { config } from './config.js';
const server = app.listen(config.port, '0.0.0.0', () => console.info(`FRISANCHO AP disponível na porta ${config.port}`));
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  const force = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 15000); force.unref();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await disconnectDatabase(); clearTimeout(force); process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// Used by the isolated process/restart checks; normal deployments have no IPC channel.
process.on('message', message => { if (message === 'shutdown') void shutdown(); });
