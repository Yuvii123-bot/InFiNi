# INFINI AI

**Live:** https://infini-ai.vercel.app — a question can be linked directly, e.g. `https://infini-ai.vercel.app/?q=Why+do+stars+shine%3F`

**A chatbot with no language model: its own small brain for conversation, the live web for knowledge.**

INFINI AI has two parts, and neither is a large language model. None is hosted, downloaded or called; there is no LLM API key.

* **The built-in brain** (new in 2.0.0) answers conversation: greetings, small talk, questions about itself, feelings, jokes, riddles and games. It remembers what you tell it during a chat, knows everyday common sense ("can a penguin fly"), tells the time and date, and understands casual typing, shorthand and typos. It is rules and data: 49,511 stored phrasings, 898 prepared replies, 220,406 common-sense relations.
* **The web pipeline** answers everything that needs knowledge. For every such question it:
  1. **Understands** it with rule-based language analysis (question type, topic, follow-up references);
  2. **Plans** sub-searches;
  3. **Searches** Wikipedia, Wikidata, open web indexes, publisher news feeds and specialist sources — live, with failover;
  4. **Reads** the pages with its own HTML parser, stripping navigation, ads and hidden text;
  5. **Compares** passages across sources (agreement, copies, contradictions, dates);
  6. **Constructs** the answer from sentences it actually found, each with a citation, and scores its confidence.

Every message goes to the brain first. It replies itself, or hands the message to the web pipeline (with certain typos repaired on the way).
The brain never invents a fact, and when the sources do not support an answer the web pipeline says: *“I could not verify this from the sources I found.”*

```
node server/server.js        →  http://localhost:8787   (chat UI, installable PWA)
node cli.js "how are you"
node cli.js "Who invented the telephone?"
```

No install step: zero npm dependencies, Node ≥ 18.17. The brain's data files are prebuilt and included.

## What you get

* **Conversation** — “hi”, “how are you”, “my name is Yuv” … “what is my name?”, “tell me a joke” → “another”, “are you conscious?”, “what can you do?”, “i feel sad”. Replies carry suggestion chips. Memory lives on your device, for the current chat.
* **Honest refusals** — it cannot write essays or code, translate, set alarms or read your files, and it says so and offers what it can do instead (usually a web search on the topic).
* **Chat application** — light and dark theme, mobile-first, welcome screen with suggestions, sidebar history (search, rename, delete), streaming activity that shows the real stages and every real search/fetch (including failures), stop, retry, regenerate (bypasses caches), copy answer, copy source link, source cards, per-statement citation chips, source drawer with the supporting passages and a page-text preview, confidence indicator with its factors, optional research panel (plan, queries, pages, statements, evidence graph, timings), settings, about page.
* **Follow-ups** — “Who invented the telephone?” → “When was he born?” → “Was he the first person to do it?” → “Explain the answer more simply.” → “are you sure?”
* **Question types** — what / why / how / when / where / who / which / whether, comparisons (with a Wikidata table), explanations, steps, lists, news digests, predictions and recommendations (as attributed views, never as the app’s own opinion), calculations (local, with working), multi-part and two-step (multi-hop) questions, direct URLs (“summarize https://…”).
* **Engine as a module and CLI** — `import { createEngine } from './engine/index.js'`.

## Honest scope

* The brain is **not intelligent in the way a language model is, and it is not conscious**. Every reply is a sentence prepared in advance, a filled-in template or the result of an exact function. It answers what it was prepared for; anything else goes to the web or gets an honest “I can't do that”. It works in English.
* The web pipeline **repeats and organises what sources say**. It cannot reason beyond them, write essays or original code, or hold opinions.
* Answer quality is bounded by what it can retrieve. With no key at all, general web search uses Firecrawl’s keyless search (a small daily allowance per server address), then best-effort public interfaces (DuckDuckGo’s HTML page, Mwmbl, Marginalia, Wiby), next to Wikipedia/Wikidata, publisher feeds and specialist APIs. For dependable web coverage add a **free key that needs no payment method** — see “Web search without paying” below.
* Its rules misread some questions and its ranking sometimes picks a poor passage; `docs/EVALUATION.md` reports measured failures, not just successes.
* “Learning” means only: which sources worked, vocabulary that co-occurred with your topics, answers you chose to save, and what you told it in the current chat — stored in your browser and clearable. It does not train or improve by itself.

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
| [`docs/REPORT.md`](docs/REPORT.md) | Full report for version 2.0.0: what was built, how, what works (with the evidence), why, and the limits. |
| [`docs/BRAIN.md`](docs/BRAIN.md) | The built-in brain: what it is and is not, how a message is handled, memory, spelling repair, data files, how to edit and rebuild it, measurements, limits. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design constraints, technology evaluation, the two parts and the pipeline, modules, the kinds of memory, evidence graph, confidence formula, platform targets. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Installation, environment variables, HTTP API, production deployment (VPS, container, Vercel), Android install. |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Brain checks, web benchmark, resource benchmark, security audit, failure scenarios, research notes and exact limitations. |
| [`engine/brain/data/NOTICE.md`](engine/brain/data/NOTICE.md) | Credits and licences of the open datasets inside the brain's data. |

## Repository layout

```
engine/   brain/ (the built-in brain: index.js normalize.js pattern.js store.js sense.js skills.js spell.js lexicon.js data/)
          nlp/ plan/ providers/ net/ extract/ rank/ evidence/ synth/ math/ util/  index.js config.js
server/   app.js (HTTP layer)  server.js (standalone)
api/      index.js (serverless entry)        vercel.json   Dockerfile   .env.example
public/   index.html app.css app.js sw.js manifest.webmanifest icons/
tools/    brain/ (editable sources of the brain's data: intents/ fun.txt commonsense/ spell-names.txt sources/; build.mjs fetch-raw.mjs dev/)
test/     unit.test.js brain.test.js (offline)  ui-smoke.mjs (drives the real client against the real server)
bench/    intelligence.js  resources.js  security.js  results/
cli.js
```

## Commands

```bash
npm start                 # server
npm test                  # 45 offline tests: 25 for the engine, 20 for the brain
npm run test:ui           # 33 end-to-end checks of the browser client (needs network)
npm run bench             # web benchmark (live; slow without INFINI_CONTACT)
npm run bench:resources   # startup, memory, CPU, throughput, latency, cache
npm run audit:security    # 20 automated security checks
node tools/brain/build.mjs dialogue    # rebuild the brain's conversation data after editing tools/brain/
node tools/brain/dev/chat.mjs "hi" "how are you" --- "tell me a joke"    # replay a conversation in the terminal
```

## Sources and terms

Providers are used through documented public APIs where they exist (MediaWiki, Wikidata, Stack Exchange, arXiv, HN Search, MDN, Mwmbl, Marginalia, Wiby, DuckDuckGo Instant Answers, publisher RSS/Atom feeds). The DuckDuckGo HTML interface is a public no-JavaScript page rather than an API; it is queried once per search, its robots rules are respected, and a human-verification page is treated as a failure and never bypassed. robots.txt is honoured for every page fetch; pages that opt out of excerpts are not quoted; paywalls, logins and CAPTCHAs are never circumvented. Wikipedia text is CC BY-SA, Wikidata is CC0, Stack Exchange content is CC BY-SA — every quotation links to its source.

The brain's data builds on open datasets: ConceptNet 5.7 and the FrequencyWords list (CC BY-SA 4.0), WordNet 3.1 (WordNet licence), example phrasings from Microsoft's Personality Chat (MIT) and CLINC150 (CC BY 3.0). The files derived from share-alike sources (`commonsense.json`, `vocab.txt`, `spell-guard.txt`) are themselves under CC BY-SA 4.0. Full credits: `engine/brain/data/NOTICE.md`, also shown in the app under About.
