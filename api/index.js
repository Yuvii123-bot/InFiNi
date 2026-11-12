// INFINI AI — serverless entry (Vercel and compatible platforms). All /api/* routes are rewritten to this function.
import { createApp } from '../server/app.js';

let app;
export default function handler(req, res) {
  if (!app) app = createApp();                    // created once per warm instance; caches live as long as the instance does
  let sub = req.query && req.query.__path;
  if (!sub) { try { sub = new URL(req.url, 'http://localhost').searchParams.get('__path'); } catch { sub = null; } }
  if (sub) req.url = '/api/' + String(sub).replace(/^\/+/, '');
  return app.handle(req, res);
}
export const config = { api: { bodyParser: false }, maxDuration: 300 };          // a research run may take a few minutes (RESEARCH_MAX_SECONDS, default 170, plus the first round and the final report)
