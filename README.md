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
* Answer quality is bounded by what it can retrieve. Without a configured search key, general web search relies on best-effort public interfaces (DuckDuckGo’s HTML page, Mwmbl, Marginalia, Wiby) plus Wikipedia/Wikidata and specialist APIs. For dependable web coverage set `BRAVE_API_KEY` or `SEARXNG_URL`.
* Its rules misread some questions and its ranking sometimes picks a poor passage; the benchmark in `docs/EVALUATION.md` reports measured failures, not just successes.
* “Learning” means only: which sources worked, vocabulary that co-occurred with your topics, and answers you chose to save — stored in your browser and clearable. It does not train or improve autonomously.

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
