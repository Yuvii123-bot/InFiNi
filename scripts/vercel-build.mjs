// INFINI AI — produces a Vercel Build Output (v3) directory: static files + one streaming Node function.
// Used when the project is deployed without Git (file upload); Git imports can rely on vercel.json + api/ instead.
import fs from 'node:fs';

const out = '.vercel/output';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/static`, { recursive: true });
fs.cpSync('public', `${out}/static`, { recursive: true });

// A file-upload deployment keeps a copy of the exact source bundle it was built from under an unguessable name,
// so that pressing "Redeploy" in the Vercel dashboard (for example after changing an environment variable) can rebuild itself.
const bundle = process.env.INFINI_SRC_BUNDLE || '', bundleName = process.env.INFINI_SRC_NAME || '';
if (bundle && /^[a-f0-9]{32,64}-[a-f0-9]{16}\.tgz$/.test(bundleName) && fs.existsSync(bundle)) {
  fs.mkdirSync(`${out}/static/source-bundle`, { recursive: true });
  fs.copyFileSync(bundle, `${out}/static/source-bundle/${bundleName}`);
}

const fn = `${out}/functions/api/index.func`;
fs.mkdirSync(fn, { recursive: true });
for (const dir of ['api', 'server', 'engine']) fs.cpSync(dir, `${fn}/${dir}`, { recursive: true });
fs.writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }));
fs.writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: process.env.INFINI_RUNTIME || 'nodejs24.x', handler: 'api/index.js', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 60 }, null, 2));

const security = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
};
fs.writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/(.*)$', headers: security, continue: true },
    { src: '^/(sw\\.js|index\\.html|manifest\\.webmanifest)?$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
    { src: '^/source-bundle/(.*)$', headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/api/(.*)$', dest: '/api/index?__path=$1', check: true },
  ],
}, null, 2));
const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(`${d}/${e.name}`) : 1), 0);
console.log(`Build output ready: ${count(`${out}/static`)} static files, function with ${count(fn)} files.`);
