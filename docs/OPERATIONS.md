# INFINI AI — Installation, configuration and deployment

## Requirements

Node.js ≥ 18.17 (developed and measured on 20.x). Nothing else: there are **no npm dependencies** and no build step.
Outbound HTTPS must be allowed. No API key is required and no LLM key exists.

## Run locally

```bash
git clone <your copy> infini-ai && cd infini-ai
node server/server.js                 # → http://localhost:8787
node cli.js "Why do stars shine?"     # one question from the terminal
node cli.js                           # interactive session with follow-ups (/new, /quit)
node cli.js --depth deep --json "Compare Python and Rust"
```

`npm start`, `npm run dev` (auto-restart), `npm test`, `npm run test:ui`, `npm run bench`, `npm run bench:resources`, `npm run audit:security` are defined in `package.json`.

## Configuration (environment variables — all optional)

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Listen address. |
| `INFINI_CONTACT` | empty | A URL or e-mail of the operator. It is sent **only to Wikimedia hosts** (in the User-Agent, as their API policy asks); every other site gets a generic User-Agent. **Set this in production**: Wikimedia APIs allow identified clients 200 requests/min; without it the limit is 10/min and the engine budgets itself to 9/min (answers degrade to page fetches and other sources when the budget is used up). |
| `INFINI_USER_AGENT` | derived | Full User-Agent override. |
| `TAVILY_API_KEY` | empty | Tavily Search (free key, no payment method, about 1,000 searches a month). Server-side only; only result links are requested. |
| `FIRECRAWL_API_KEY` | empty | Firecrawl Search works **without** a key inside a daily allowance per server address; a free key (no payment method, 1,000 credits a month) replaces that allowance with the account’s quota. Set it when the keyless route is refused or used up on your host. |
| `BRAVE_API_KEY` | empty | Brave Search API. Still supported, but Brave now asks for a payment method even for its free credit, so it is not the recommended route. |
| `SEARXNG_URL` | empty | URL of *your own* SearXNG instance (JSON format enabled). May be a private address; it is exempt from the public-address rule for exactly that origin. |
| `MARGINALIA_API_KEY`, `STACKEXCHANGE_KEY` | empty | Personal keys for higher quotas (both work without a key at low volume). |
| `DISABLE_PROVIDERS` | empty | Comma-separated provider ids to switch off: `wikipedia, ddg_instant, searxng, tavily, brave, ddg_html, firecrawl, mwmbl, marginalia, wiby, stackexchange, mdn, arxiv, hackernews, feeds, gdelt`. |
| `EXTRA_FEEDS` | empty | Extra RSS/Atom URLs used for news questions. |
| `RATE_LIMIT_PER_MIN`, `RATE_LIMIT_BURST` | `20`, `8` | Per-client-address token bucket for `/api/ask` and `/api/preview`. |
| `MAX_CONCURRENT_ASKS` | `4` | Questions processed at once per process (others get 503 + Retry-After). |
| `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES` | `7000`, `1500000` | Per-page limits. |
| `CACHE_MAX_MB`, `CACHE_TTL_MIN` | `24`, `15` | Temporary page cache (RAM). `0` disables it. |
| `TRUST_PROXY` | `0` | `1` = take the client address from `X-Forwarded-For` (only behind your own reverse proxy). |
| `ALLOW_EMBED` | `0` | `1` = allow framing by other origins. |
| `IGNORE_ROBOTS` | `0` | Do not set. Present for testing against your own sites only. |
| `LOG_QUESTIONS`, `LOG_LEVEL` | `0`, — | Question text is not logged unless `LOG_QUESTIONS=1`; `LOG_LEVEL=silent` disables request logs. |
| `WIKIMEDIA_PER_MIN` | 9 / 150 | Client-side budget for Wikimedia APIs (without / with contact). |

See `.env.example`. Secrets are read from the environment only, are never written to logs, and are never sent to the browser (`/api/status` reports only whether a provider is configured).

## HTTP API

| Endpoint | Purpose |
|---|---|
| `POST /api/ask` `{question, context?, settings?{depth, providersOff[], feeds[]}, learned?, regenerate?}` | Streams newline-delimited JSON events: `stage` (start/done with real details), `search`, `fetch`, `note`, `answer` (the full result), `done`, or `error`. Closing the connection stops retrieval. |
| `POST /api/preview` `{url}` | Extracted text of a source page (same guarded fetch path; text blocks only). |
| `GET /api/status` | Version, provider availability, cache counters, Wikimedia budget. No secrets. |
| `GET /api/health` | Liveness. |

## Production deployment

### Any Linux host / VPS

```bash
INFINI_CONTACT="https://your-domain.example/about" PORT=8787 node --max-old-space-size=256 server/server.js
```
Put it behind a TLS reverse proxy (Caddy, nginx) and set `TRUST_PROXY=1`. Disable proxy buffering for `/api/ask` (the app sends `X-Accel-Buffering: no`). A systemd unit with `Restart=always`, `MemoryMax=400M`, `NoNewPrivileges=yes` and a dedicated user is sufficient. HTTPS is required for PWA installation.

### Container

```bash
docker build -t infini-ai . && docker run -p 8787:8787 -e INFINI_CONTACT=https://your-domain.example/about --read-only --cap-drop ALL --memory 400m infini-ai
```
The image is Node + this repository (no `npm install`). The process needs no writable disk.

### Vercel (serverless)

The repository is ready: `vercel.json` serves `public/` statically and rewrites `/api/*` to `api/index.js` (Node runtime, streaming, 60 s limit).
```bash
npx vercel            # preview
npx vercel --prod     # production; then set INFINI_CONTACT (and optional keys) in Project → Settings → Environment Variables
```
Serverless notes: rate limiting and the page cache are per warm instance (best effort); add platform-level rate limiting for a public deployment. Egress IPs are shared, which makes `INFINI_CONTACT` and/or a keyed search provider more important.

### Installing on Android

Open the HTTPS deployment in Chrome → menu → *Install app*. The app shell works offline; answering needs a connection.

## Operations notes

* **Capacity:** one question uses ~0.2–0.4 s of CPU and reads 0.5–4 MB; a 1-vCPU instance handles a few questions per second in bursts but is bounded by upstream rate limits long before CPU.
* **Upstream etiquette:** identify yourself (`INFINI_CONTACT`), keep the default budgets, keep robots.txt handling on. The DuckDuckGo HTML interface, Firecrawl’s keyless allowance and the public Marginalia key are best-effort; for dependable web search add a free Tavily key or run your own SearXNG.
* **Monitoring:** `/api/status` → `totals.insufficient / totals.asks` (share of unanswered questions) and cache hit counters; request logs are JSON lines.
* **Data protection:** the server stores nothing about users. Conversations, saved answers and statistics live in the user’s browser and are cleared from Settings.
* **Updating word lists and rules:** `engine/nlp/lexicon.js` (language), `engine/providers/feeds.js` (feed catalogue), `engine/evidence/evidence.js` (publisher classes), `engine/providers/wikidata.js` (relation lexicon), `engine/plan/plan.js` (routing vocabulary).
