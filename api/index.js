// INFINI AI — serverless entry (Vercel and compatible platforms). All /api/* routes are rewritten to this function.
import { createApp } from '../server/app.js';

let app;
export default function handler(req, res) {
  if (!app) app = createApp();                    // created once per warm instance; caches live as long as the instance does
  if (req.query && req.query.__path) req.url = '/api/' + String(req.query.__path).replace(/^\/+/, '');
  return app.handle(req, res);
}
export const config = { api: { bodyParser: false }, maxDuration: 60 };
