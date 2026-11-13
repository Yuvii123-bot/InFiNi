# INFINI AI — Installation, configuration and deployment

## Requirements

Node.js ≥ 18.17 (developed and measured on 20.x). Nothing else: there are **no npm dependencies** and no build step.
The built-in brain's data files (`engine/brain/data/`, 4 MB) are prebuilt and part of the repository.
Outbound HTTPS must be allowed. No API key is required and no LLM key exists.
Memory: 115 to 150 MB resident for ordinary questions (about 50 MB before the first chat message). A research run needs more while it lasts: 280 to 410 MB were measured for the whole process during single runs (`bench/results/research.md`). Plan for about 300 MB per research run that may be in progress at the same time (`MAX_CONCURRENT_RESEARCH`, default 2), on top of the base.

## Run locally

```bash
git clone <your copy> infini-ai && cd infini-ai
node server/server.js                 # → http://localhost:8787
node cli.js "how are you"             # answered by the built-in brain
node cli.js "Why do stars shine?"     # answered from the web, with sources
node cli.js                           # interactive session with follow-ups (/new, /quit)
node cli.js --depth deep --json "Compare Python and Rust"
node cli.js "do deep research on solid-state batteries"       # a research run; the same as --depth research "solid-state batteries"
```

Depths: `auto` (default: a quick round, widened by itself when the first pages do not answer; a research run when the message asks for one), `fast` (about 3 pages), `balanced` (about 6), `deep` (up to 70 pages and 60 abstracts in up to 3 rounds, 45 s), `research` (up to `RESEARCH_MAX_PAGES` pages and 800 abstracts in up to 12 rounds, `RESEARCH_MAX_SECONDS`).

`npm start`, `npm run dev` (auto-restart), `npm test`, `npm run test:ui`, `npm run bench`, `npm run bench:research`, `npm run bench:resources`, `npm run audit:security` are defined in `package.json`.

## Configuration (environment variables — all optional)

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Listen address. |
| `INFINI_CONTACT` | empty | A URL or e-mail of the operator. It is sent **only to Wikimedia hosts** (in the User-Agent, as their API policy asks); every other site gets a generic User-Agent. **Set this in production**: Wikimedia APIs allow identified clients 200 requests/min; without it the limit is 10/min and the engine budgets itself to 9/min (answers degrade to page fetches and other sources when the budget is used up). |
| `INFINI_USER_AGENT` | derived | Full User-Agent override. |
| `INFINI_CREATOR` | `an independent developer` | Who built this deployment. The built-in brain uses it when asked “who made you” (at most 60 characters; letters, digits, spaces and `. , ' & -`). |
| `TAVILY_API_KEY` | empty | Tavily Search (free key, no payment method, about 1,000 searches a month). Server-side only; only result links are requested. |
| `FIRECRAWL_API_KEY` | empty | Firecrawl Search works **without** a key inside a daily allowance per server address; a free key (no payment method, 1,000 credits a month) replaces that allowance with the account’s quota. Set it when the keyless route is refused or used up on your host. |
| `BRAVE_API_KEY` | empty | Brave Search API. Still supported, but Brave now asks for a payment method even for its free credit, so it is not the recommended route. |
| `SEARXNG_URL` | empty | URL of *your own* SearXNG instance (JSON format enabled). May be a private address; it is exempt from the public-address rule for exactly that origin. |
| `MARGINALIA_API_KEY`, `STACKEXCHANGE_KEY` | empty | Personal keys for higher quotas (both work without a key at low volume). |
| `OPENALEX_API_KEY` | empty | Free key from openalex.org (no payment method). Without it OpenAlex answers only on a small daily allowance and pauses anonymous search under load; Crossref and Europe PMC need no key and keep delivering abstracts. |
| `DISABLE_PROVIDERS` | empty | Comma-separated provider ids to switch off: `wikipedia, ddg_instant, searxng, tavily, brave, ddg_html, firecrawl, mwmbl, marginalia, wiby, stackexchange, mdn, arxiv, openalex, crossref, europepmc, hackernews, feeds, gdelt`. |
| `RESEARCH_MODE` | `1` | `0` switches research runs off; such requests are then answered at depth `deep`. |
| `RESEARCH_MAX_PAGES`, `RESEARCH_MAX_SECONDS` | `1500`, `170` | Budget of one research run (50–5,000 pages; 30–270 s). A run ends earlier when new searches stop bringing new material. On serverless hosts the seconds must stay well below the function limit, because the first round and the writing of the report come on top. |
| `CRAWL_CONCURRENCY` | `40` | Pages fetched at the same time during a research run (4–96). One site is never asked for more than two at a time. |
| `RESEARCH_KEYED_SEARCHES` | `5` | Searches one research run may make on a metered service (Tavily, Brave) after its first round. More searches bring more leads and use a monthly quota faster: with the default, a research run uses 6 to 7 Tavily searches in all. |
| `MAX_CONCURRENT_RESEARCH` | `2` | Research runs in progress at once per process. A further request is answered at depth `deep`, with a note saying why. |
| `RESEARCH_PER_HOUR` | `12` | Research runs one process starts per hour. |
| `RESEARCH_PER_CLIENT_PER_HOUR` | `6` | Research runs one client address may start per hour. |
| `CROSSREF_GAP_MS` | `380` | Least time between the starts of two requests to Crossref, whose public pool allows three requests per second. `0` switches the spacing off (not advised: a refusal pauses the service for 20 s). |
| `EXTRA_FEEDS` | empty | Extra RSS/Atom URLs used for news questions. |
| `RATE_LIMIT_PER_MIN`, `RATE_LIMIT_BURST` | `20`, `8` | Per-client-address token bucket for `/api/ask` and `/api/preview`. A request at depth `deep` counts twice, one at depth `research` four times. |
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
| `POST /api/ask` `{question, context?, settings?{depth, route?, providersOff[], feeds[]}, learned?, regenerate?, tz?}` | Streams newline-delimited JSON events: `stage` (start/done with real details; `round` during a long run), `search`, `fetch`, `note`, `answer` (the full result), `done`, or `error`. A deep or research run adds `research` (`start` with its budget, `done`), `progress` (about every 0.7 s: `round, read, relevant, failed, abstracts, screened, waiting, searches, bytes, elapsedMs, subtopics, latest`) and `draft` (`round`, and `result`: a complete interim answer with `draft: true`). The final result then also carries `depth {asked, used, limited?}`, `run` (rounds, pages, abstracts, sites, results screened, seconds, why it ended, the searches made, the sub-topics) and `classification` (totals, facets with counts, publication years, up to 400 documents with their classes, leads that were not read). Closing the connection stops retrieval. `tz` is the device's IANA time zone (for “what time is it”). `settings.route: "web"` skips the built-in brain and searches for the text exactly as typed. `context` carries the conversation memory, including the brain's (`context.brain`); send back the `context` of the previous answer. A reply from the brain has `kind: "brain"`, an `origin`, `suggestions`, and no sources. |
| `POST /api/preview` `{url}` | Extracted text of a source page (same guarded fetch path; text blocks only). |
| `GET /api/status` | Version, provider availability, cache counters, Wikimedia budget, the size of the brain's data (`brain`) and how many messages it answered (`totals.brain`), the depths, and `research` (enabled, limits, runs in progress, runs started in the last hour). No secrets. |
| `GET /api/health` | Liveness. |

## Production deployment

### Any Linux host / VPS

```bash
INFINI_CONTACT="https://your-domain.example/about" PORT=8787 node --max-old-space-size=768 server/server.js
```
Put it behind a TLS reverse proxy (Caddy, nginx) and set `TRUST_PROXY=1`. Disable proxy buffering for `/api/ask` (the app sends `X-Accel-Buffering: no`) and allow responses that last three to four minutes (nginx: `proxy_read_timeout 300s`). A systemd unit with `Restart=always`, `MemoryMax=1G`, `NoNewPrivileges=yes` and a dedicated user is sufficient. On a host with less than 1 GB of memory set `MAX_CONCURRENT_RESEARCH=1`, or `RESEARCH_MODE=0` and `MemoryMax=400M` as before. HTTPS is required for PWA installation.

### Container

```bash
docker build -t infini-ai . && docker run -p 8787:8787 -e INFINI_CONTACT=https://your-domain.example/about --read-only --cap-drop ALL --memory 1g infini-ai
```
The image is Node + this repository (no `npm install`): `engine/` includes the brain's data. The process needs no writable disk.

### Vercel (serverless)

The repository is ready: `vercel.json` serves `public/` statically and rewrites `/api/*` to `api/index.js` (Node runtime, streaming, 300 s limit — the longest a Hobby project allows with Fluid compute, and enough for a research run of `RESEARCH_MAX_SECONDS=170` plus its first round and the report).
```bash
npx vercel            # preview
npx vercel --prod     # production; then set INFINI_CONTACT (and optional keys) in Project → Settings → Environment Variables
```
Serverless notes: rate limiting, the limits on research runs and the page cache are per warm instance (best effort); add platform-level rate limiting for a public deployment. A research run keeps one function invocation busy for one to three minutes, which counts against the platform's execution allowance. Egress IPs are shared, which makes `INFINI_CONTACT` and/or a keyed search provider more important.

#### Deploying without Git (how the live site https://infini-ai.vercel.app was published)

When only the Vercel API is available (inline text files, no Git, no CLI), the source bundle cannot be sent directly. The procedure used:

1. Project settings: framework preset `vite`, build command `node bootstrap.mjs`, install command `echo no-install-needed`, output directory `public`; environment variables `INFINI_CONTACT`, `TRUST_PROXY=1` (plus optional keys).
2. `tar czf bundle.tgz api server engine public scripts package.json` and note its SHA-256. With the brain's data the bundle is about 1.5 MB; the upload relay accepts 2 MB.
3. Deploy a temporary stage to production: a placeholder page plus a key-protected upload relay function; `PUT` the bundle to it. (Only production domains are public; preview URLs sit behind Vercel’s login.) The site shows the placeholder for about a minute.
4. Deploy the real stage: a single `bootstrap.mjs` that downloads the bundle, verifies the SHA-256, unpacks it and runs `scripts/vercel-build.mjs` (Build Output API v3: static files + one streaming function). The relay does not exist in this deployment; delete the temporary one.

Known limits: “Redeploy” in the Vercel dashboard re-runs `bootstrap.mjs`, which can no longer download the bundle, so it fails (the running site is unaffected). Environment-variable changes therefore need a new deployment made this way, or — recommended for the long term — a Git repository connected to the project, after which `vercel.json` and `api/` are used and none of this is needed. `scripts/vercel-build.mjs` can also place the bundle under `/source-bundle/<random>-<hash>.tgz` so that a redeploy could fetch it from the live site; this is **not yet deployed or tested** (`/_src/`, tried first, is reserved by Vercel).

### Web search providers that need no payment method

Order of the failover chain: `searxng → tavily → brave → firecrawl → ddg_html → mwmbl → marginalia → wiby`. The first provider that returns at least three results is used. A provider that answers with a human check rests 10 minutes, one that rate-limits rests for the time it asks (up to 6 hours), one that refuses the address or key rests 15 minutes, and Tavily rests 6 hours when its allowance is used up (HTTP 432/433); every attempt and skip is shown in the answer’s research details.

* **Firecrawl** — `POST https://api.firecrawl.dev/v2/search`. Keyless use is documented by Firecrawl and capped per network address per day (requests and credits); on shared hosting addresses the allowance may be consumed by others or refused. A free account key (`FIRECRAWL_API_KEY`) uses the account quota instead.
* **Tavily** — `POST https://api.tavily.com/search` with `include_answer: false`; needs a free key (`TAVILY_API_KEY`). In use on the live site since 1.2.0; a question at Balanced depth uses one or two searches, a deep search up to four, a research run six or seven (`RESEARCH_KEYED_SEARCHES`).
* **Marginalia** — free non-commercial key by e-mail to the project (results are licensed CC BY-NC-SA 4.0).
* **SearXNG** — your own instance (`SEARXNG_URL`); public instances block automated use.

Looked at and deliberately not used: Google’s Custom Search JSON API (closed to new customers, discontinued on 1 January 2027); Bing’s and Google News’ RSS output (terms limit them to personal feed-reader use); services that resell scraped Google result pages (this project only uses access the search engine itself offers); search products that return generated answers.

### Installing on Android

Open the HTTPS deployment in Chrome → menu → *Install app*. The app shell works offline; answering needs a connection.

## Operations notes

* **Capacity:** one ordinary question uses ~0.2–0.4 s of CPU and reads 0.5–4 MB; a 1-vCPU instance handles a few questions per second in bursts but is bounded by upstream rate limits long before CPU. A research run is a different load: 45 to 70 s, 60 to 130 MB read, 100 or so searches, several hundred page requests spread over a hundred or more sites, and roughly 300 MB of memory. The three limits (`MAX_CONCURRENT_RESEARCH`, `RESEARCH_PER_HOUR`, `RESEARCH_PER_CLIENT_PER_HOUR`) exist for that reason.
* **Scholarly indexes:** Crossref asks for at most 3 requests a second from one address in its “polite” pool (the engine stays below 100 a minute and sends `INFINI_CONTACT` as the contact address, as Crossref asks). Europe PMC's search answers slowly at times; a slow answer is not waited for (the round goes on after 3.5 s and late results join it), and its failures do not block the reading of full texts from the same host. OpenAlex without a key may answer “anonymous search is paused”; the run then goes on with Crossref.
* **Upstream etiquette:** identify yourself (`INFINI_CONTACT`), keep the default budgets, keep robots.txt handling on. The DuckDuckGo HTML interface, Firecrawl’s keyless allowance and the public Marginalia key are best-effort; for dependable web search add a free Tavily key or run your own SearXNG.
* **Monitoring:** `/api/status` → `totals.insufficient / totals.asks` (share of unanswered questions), `totals.brain` (messages answered without a search), `research.running` and `research.startedLastHour`, and cache hit counters; request logs are JSON lines with `kind` (`brain`, `retrieval`, …), the depth used and, for long runs, the pages read.
* **Data protection:** the server stores nothing about users. Conversations, saved answers and statistics live in the user’s browser and are cleared from Settings.
* **Updating word lists and rules:** `engine/nlp/lexicon.js` (language), `engine/providers/feeds.js` (feed catalogue), `engine/evidence/evidence.js` (publisher classes), `engine/providers/wikidata.js` (relation lexicon), `engine/plan/plan.js` (routing vocabulary).
* **Changing what the brain says or understands:** edit the text files in `tools/brain/` (situations and replies in `intents/`, jokes and riddles in `fun.txt`, everyday facts in `commonsense/`, names the spelling repair must keep in `spell-names.txt`), then run `node tools/brain/build.mjs dialogue`, read `engine/brain/data/build-report.txt`, run `npm test` and deploy. `tools/` is not part of the deployment bundle; the built files in `engine/brain/data/` are. Guide: `docs/BRAIN.md`.
* **Rebuilding the brain's common-sense file from the original datasets** is only needed to change how they are filtered: `BRAIN_RAW=/some/dir node tools/brain/fetch-raw.mjs` downloads WordNet 3.1 and ConceptNet 5.7 (about 520 MB), then `BRAIN_RAW=/some/dir node tools/brain/build.mjs commonsense`. Without the downloads the build keeps the existing long tail.
* **Licences inside the brain's data:** `engine/brain/data/NOTICE.md` must stay with the data files, and the credits in the app's About dialog must stay visible. `commonsense.json`, `vocab.txt` and `spell-guard.txt` are under CC BY-SA 4.0 (share-alike).
