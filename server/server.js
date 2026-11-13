// INFINI AI — standalone server.  `node server/server.js`  (PORT, HOST and the options in docs/CONFIGURATION.md)
import http from 'node:http';
import { createApp } from './app.js';

const app = createApp();
const server = http.createServer((req, res) => { app.handle(req, res); });
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 10_000;
server.listen(app.cfg.port, app.cfg.host, () => {
  const m = app.neural ? app.neural.info() : { available: false, reason: 'switched off' };
  console.log(`INFINI AI ${app.cfg.version} listening on http://${app.cfg.host}:${app.cfg.port}  (${m.available ? `Infinity LLM ${m.version}: ${m.parameters.toLocaleString('en-US')} parameters, own weights, own inference engine` : `Infinity LLM not loaded (${m.reason}): chat comes from the built-in brain`}; facts from live retrieval)`);
  if (!app.cfg.contact) console.log('Tip: set INFINI_CONTACT (a URL or e-mail) so Wikimedia APIs grant the identified-client rate limit (200/min instead of 10/min).');
});
const stop = () => { server.close(() => { app.close(); process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
