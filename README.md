# INFINI AI

**An AI that does not know the world until it searches the world.**

INFINI AI is a complete chatbot whose answers come from live internet retrieval and its own rule-based processing.
There is **no large language model** in it — none hosted, none downloaded, no hidden fallback, no LLM API key.

For every question it:

1. **Understands** it with rule-based language analysis (question type, topic, follow-up references);
2. **Plans** sub-searches;
3. **Searches** Wikipedia, Wikidata, open web indexes, publisher news feeds and specialist sources — live, with failover;
4. **Reads** the pages with its own HTML parser, stripping navigation, ads and hidden text;
5. **Compares** passages across sources (agreement, copies, contradictions, dates);
6. **Constructs** the answer from sentences it actually found, each with a citation, and scores its confidence.

When the sources do not support an answer it says: *“I could not verify this from the sources I found.”*

```
node server/server.js        →  http://localhost:8787   (chat UI, installable PWA)
node cli.js "Who invented the telephone?"
```

No install step: zero npm dependencies, Node ≥ 18.17.

## What you get

* **Chat application** — light theme, mobile-first, welcome screen with suggestions, sidebar history (search, rename, delete), streaming activity that shows the real stages and every real search/fetch (including failures), stop, retry, regenerate (bypasses caches), copy answer, copy source link, source cards, per-statement citation chips, source drawer with the supporting passages and a page-text preview, confidence indicator with its factors, optional research panel (plan, queries, pages, statements, evidence graph, timings), settings, about page.
* **Follow-ups** — “Who invented the telephone?” → “When was he born?” → “Was he the first person to do it?” → “Explain the answer more simply.”
* **Question types** — what / why / how / when / where / who / which / whether, comparisons (with a Wikidata table), explanations, steps, lists, news digests, predictions and recommendations (as attributed views, never as the app’s own opinion), calculations (local, with working), multi-part and two-step (multi-hop) questions, direct URLs (“summarize https://…”).
* **Engine as a module and CLI** — `import { createEngine } from './engine/index.js'`.

## Honest scope

* It **repeats and organises what sources say**. It cannot reason beyond them, write essays or original code, or hold opinions.
* Answer quality is bounded by what it can retrieve. With no key at all, general web search uses Firecrawl’s keyless search (a small daily allowance per server address), then best-effort public interfaces (DuckDuckGo’s HTML page, Mwmbl, Marginalia, Wiby), next to Wikipedia/Wikidata, publisher feeds and specialist APIs. For dependable web coverage add a **free key that needs no payment method** — see “Web search without paying” below.
* Its rules misread some questions and its ranking sometimes picks a poor passage; the benchmark in `docs/EVALUATION.md` reports measured failures, not just successes.
* “Learning” means only: which sources worked, vocabulary that co-occurred with your topics, and answers you chose to save — stored in your browser and clearable. It does not train or improve autonomously.

## Web search without paying

No search key is required and none needs a credit card. Providers are tried in this order; the first one that returns results wins, and one that refuses or rate-limits is rested automatically.

| Provider | What you need | Free allowance (as published by the provider, November 2026) |
|---|---|---|
| Your own SearXNG | `SEARXNG_URL` (self-hosted) | unlimited |
| Tavily | `TAVILY_API_KEY` — free account, no card | about 1,000 searches a month |
| Firecrawl | nothing (keyless), or `FIRECRAWL_API_KEY` — free account, no card | keyless: a daily allowance per server address (in our test about 80 searches, then a 24-hour wait); key: 1,000 credits a month ≈ 500 searches |
| DuckDuckGo HTML, Mwmbl, Wiby | nothing | best effort (DuckDuckGo often asks automated clients for a human check, which is never bypassed) |
| Marginalia | `MARGINALIA_API_KEY` — free non-commercial key on request by e-mail | independent small-web index |
| Brave | `BRAVE_API_KEY` | still supported, but Brave now requires a payment method |

Only links are taken from these services. INFINI AI fetches and reads every page itself and never asks a provider for a generated answer. Details and the options that were rejected: `docs/OPERATIONS.md`.

## Documentation

| File | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design constraints, technology evaluation (Node, TypeScript, Python, Rust/WASM, SQLite, IndexedDB), pipeline, modules, the four memory tiers, evidence graph, confidence formula, platform targets. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Installation, environment variables, HTTP API, production deployment (VPS, container, Vercel), Android install. |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Intelligence benchmark, resource benchmark and optimisation report, security audit, failure scenarios, research experiments and exact limitations. |

## Repository layout

```
engine/   nlp/ plan/ providers/ net/ extract/ rank/ evidence/ synth/ math/ util/  index.js config.js
server/   app.js (HTTP layer)  server.js (standalone)
api/      index.js (serverless entry)        vercel.json   Dockerfile   .env.example
public/   index.html app.css app.js sw.js manifest.webmanifest icons/
test/     unit.test.js (offline)  ui-smoke.mjs (drives the real client against the real server)
bench/    intelligence.js  resources.js  security.js  results/
cli.js
```

## Commands

```bash
npm start                 # server
npm test                  # 17 offline unit tests
npm run test:ui           # 19 end-to-end checks of the browser client (needs network)
npm run bench             # intelligence benchmark (live; slow without INFINI_CONTACT)
npm run bench:resources   # startup, memory, CPU, throughput, latency, cache
npm run audit:security    # 19 automated security checks
```

## Sources and terms

Providers are used through documented public APIs where they exist (MediaWiki, Wikidata, Stack Exchange, arXiv, HN Search, MDN, Mwmbl, Marginalia, Wiby, DuckDuckGo Instant Answers, publisher RSS/Atom feeds). The DuckDuckGo HTML interface is a public no-JavaScript page rather than an API; it is queried once per search, its robots rules are respected, and a human-verification page is treated as a failure and never bypassed. robots.txt is honoured for every page fetch; pages that opt out of excerpts are not quoted; paywalls, logins and CAPTCHAs are never circumvented. Wikipedia text is CC BY-SA, Wikidata is CC0, Stack Exchange content is CC BY-SA — every quotation links to its source.
