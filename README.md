# INFINI AI

**Live:** https://infini-ai.vercel.app — a question can be linked directly, e.g. `https://infini-ai.vercel.app/?q=Why+do+stars+shine%3F`

**A chat assistant with its own small neural language model, trained from scratch, and the live web for knowledge.**

INFINI AI has three parts. No outside model is hosted, downloaded or called; there is no LLM API key.

* **Infinity LLM** (new in 4.0.0) is a decoder-only Transformer whose weights started as random numbers and were trained
  by this repository's own code (`llm/`, PyTorch). It writes conversational replies, token by token, inside the Node
  server (`engine/neural/`, plain JavaScript, no dependencies). Each reply it writes is compared with the rule-based
  reply to the same message and is shown only when the two say the same thing. **Measured on phrasings it had not
  seen, about one reply in five passes that check; the rule-based brain supplies the others.** The label under every
  reply says which of the two wrote it. For factual questions it chooses, among the sentences the
  web pipeline retrieved, the ones that answer the question; it cannot output a factual sentence that is not in a source.
  It keeps learning in controlled cycles (`learning/`): collect openly licensed text, filter and verify it, build a
  dataset version, continue training from the current model, evaluate the candidate on held-out data, and replace the
  current model **only if the candidate measures better**; otherwise the candidate is rejected and nothing changes.
  Every version is kept and can be rolled back to. `/learning.html` shows all of it from the training system's records.
  **It is small** (about 1.3 million parameters in the published version, roughly a hundred thousand times smaller than
  commercial assistants): it holds a short conversation in the style it was trained on, and that is all it does.
  Design, limits and measured results: [`docs/INFINITY-LLM.md`](docs/INFINITY-LLM.md).
* **The built-in brain** (rules and data, no neural network) classifies every message, keeps the memory of the chat, and answers common sense, exact skills, safety messages and questions about the assistant itself; it also supplies the reply whenever the model is unsure or absent. On its own it answers conversation: greetings, small talk, questions about itself, feelings, jokes, riddles and games. It remembers what you tell it during a chat, knows everyday common sense ("can a penguin fly"), tells the time and date, and understands casual typing, shorthand and typos. It is rules and data: 52,938 stored phrasings, 902 prepared replies, 220,406 common-sense relations.
* **The web pipeline** answers everything that needs knowledge. For every such question it:
  1. **Understands** it with rule-based language analysis (question type, topic, follow-up references);
  2. **Plans** sub-searches;
  3. **Searches** Wikipedia, Wikidata, open web indexes, publisher news feeds and specialist sources — live, with failover;
  4. **Reads** the pages with its own HTML parser, stripping navigation, ads and hidden text;
  5. **Compares** passages across sources (agreement, copies, contradictions, dates);
  6. **Constructs** the answer from sentences it actually found, each with a citation, and scores its confidence.

* **Deep search and research runs** (new in 3.0.0) repeat those steps in rounds. Write *“do deep research on the health effects of microplastics”*, or set **Depth** to *Research*, and it searches many services at once, reads the pages, compares everything, finds the sub-topics the sources share, and searches again for those. It follows links and reference lists, and takes in abstracts of scientific papers from open indexes (OpenAlex, Crossref, Europe PMC). Everything found is **classified** by fixed rules (kind of source, kind of document, study design, year, reliability tier, sub-topic, how much was read) and the answer is a **report**: opening, key points, a section per sub-topic, figures, dated statements, what is still uncertain — every statement cited. On a yes-or-no question it counts how the independent sources lean.

  Measured on 13 November 2026 with three free keys — LangSearch, Tavily, OpenAlex — as on the live site (`bench/results/research.md`): one research run read **880 to 1,500 pages** and took in **800 abstracts** — **1,653 to 2,245 documents from 312 to 522 sites, out of 9,690 to 16,170 results screened** — in **70 to 91 seconds**. With the Tavily key alone (version 3.0.0) the same runs read 293 to 499 pages and 520 to 705 abstracts in 45 to 55 seconds. The budget is up to 1,500 pages and 170 seconds: one of the three benchmark runs reached the page budget, the others ended earlier because new searches stopped bringing new material — a run says why it ended. More than a quarter of the pages found cannot be read (refusals, JavaScript, robots.txt) and are counted as such. An abstract is counted as an abstract, never as a page.

Every message goes to the brain first. It replies itself (with Infinity LLM writing the wording of conversational replies when a model is loaded), or hands the message to the web pipeline (with certain typos repaired on the way).
The brain never invents a fact; the model is not used as a source of facts, and when the sources do not support an answer the web pipeline says: *“I could not verify this from the sources I found.”*

```
node server/server.js        →  http://localhost:8787   (chat UI, installable PWA)
node cli.js "how are you"
node cli.js "Who invented the telephone?"
node cli.js "do deep research on solid-state batteries"      # or: node cli.js --depth research "solid-state batteries"
```

No install step: zero npm dependencies, Node ≥ 18.17. The brain's data files and the trained model (`model/`, about 3 MB) are included.
Training a new model version additionally needs Python with PyTorch (`docs/OPERATIONS.md`, "Infinity LLM"); answering does not.

## What you get

* **Conversation** — “hi”, “how are you”, “my name is Yuv” … “what is my name?”, “tell me a joke” → “another”, “are you conscious?”, “what can you do?”, “i feel sad”. Replies carry suggestion chips. Memory lives on your device, for the current chat.
* **Honest refusals** — it cannot write essays or code, translate, set alarms or read your files, and it says so and offers what it can do instead (usually a web search on the topic).
* **Chat application** — light and dark theme, mobile-first, welcome screen with suggestions, sidebar history (search, rename, delete), streaming activity that shows the real stages and every real search/fetch (including failures), stop, retry, regenerate (bypasses caches), copy answer, copy source link, source cards, per-statement citation chips, source drawer with the supporting passages and a page-text preview, confidence indicator with its factors, optional research panel (plan, queries, pages, statements, evidence graph, timings), settings, about page.
* **Depth** — a menu beside the message box: *Auto* (decides by itself; widens the search when the first pages do not answer), *Fast*, *Balanced*, *Deep* (up to 70 pages and 60 abstracts, about 20 seconds), *Research* (up to 1,500 pages, one to three minutes).
* **During a long run** — live counters (pages read, abstracts, results screened, pages that could not be read), the sub-topics found so far, and a draft answer after every round. Stop keeps the latest draft, marked as unfinished.
* **After a long run** — the report; a line stating what the run did and why it ended; *Everything that was found*: counts, bars per class and year, and a side panel where every document can be filtered by class and opened.
* **Follow-ups** — “Who invented the telephone?” → “When was he born?” → “Was he the first person to do it?” → “Explain the answer more simply.” → “are you sure?”
* **Question types** — what / why / how / when / where / who / which / whether, comparisons (with a Wikidata table), explanations, steps, lists, news digests, predictions and recommendations (as attributed views, never as the app’s own opinion), calculations (local, with working), multi-part and two-step (multi-hop) questions, direct URLs (“summarize https://…”).
* **Engine as a module and CLI** — `import { createEngine } from './engine/index.js'`.

## Honest scope

* **Infinity LLM is a very small language model.** It was trained on a few million tokens on a CPU. It can reply to everyday conversation; it does not reason, it cannot write essays or code, it knows no facts by itself, and it can produce a wrong or odd reply. When its own confidence in a reply is low, the rule-based reply is shown instead, and the interface always says which of the two you are reading. It is not conscious, and "learning" means the training cycles described above, nothing more.
* **Continuous learning needs a machine that can train.** On a serverless host such as Vercel the app serves the published model and shows the published learning records; it does not train there.
* The brain is **not intelligent in the way a language model is, and it is not conscious**. Every reply is a sentence prepared in advance, a filled-in template or the result of an exact function. It answers what it was prepared for; anything else goes to the web or gets an honest “I can't do that”. It works in English.
* The web pipeline **repeats and organises what sources say**. It cannot reason beyond them, write essays or original code, or hold opinions.
* Answer quality is bounded by what it can retrieve. With no key at all, general web search uses Firecrawl’s keyless search (a small daily allowance per server address), then best-effort public interfaces (DuckDuckGo’s HTML page, Mwmbl, Marginalia, Wiby), next to Wikipedia/Wikidata, publisher feeds and specialist APIs. For dependable web coverage add a **free key that needs no payment method** — see “Web search without paying” below.
* A research run **collects, sorts and quotes; it does not think**. The report is made of the sources' own sentences, picked and grouped by rule. It can quote a weak sentence, group one under the wrong heading, or miss the best source. Which way a source “leans” is read from its wording, not judged.
* **How many pages a run reads depends on the topic and on the day.** About a third of all pages refuse automated reading, need JavaScript, or are closed by robots.txt; they are skipped and counted, never bypassed. An abstract is counted as an abstract, never as a page read. The 1,500-page budget is a ceiling: in our measurements a run found 260 to 480 readable, relevant pages before new searches stopped bringing more.
* Its rules misread some questions and its ranking sometimes picks a poor passage; `docs/EVALUATION.md` reports measured failures, not just successes.
* In the browser, “learning” means only: which sources worked, vocabulary that co-occurred with your topics, answers you chose to save, and what you told it in the current chat — stored in your browser and clearable. None of your messages are used to train the model: its training text is openly licensed documents and the project's own example conversations.

## Web search without paying

No search key is required and none needs a credit card. Providers are tried in this order; the first one that returns results wins, and one that refuses or rate-limits is rested automatically.

| Provider | What you need | Free allowance (as published by the provider, November 2026) |
|---|---|---|
| Your own SearXNG | `SEARXNG_URL` (self-hosted) | unlimited |
| LangSearch | `LANGSEARCH_API_KEY` — free account, no card | a daily allowance counted in tokens of returned text, renewed at 00:00 UTC (the figure is shown in its dashboard) |
| Tavily | `TAVILY_API_KEY` — free account, no card | about 1,000 searches a month |
| Firecrawl | nothing (keyless), or `FIRECRAWL_API_KEY` — free account, no card | keyless: a daily allowance per server address (in our test about 80 searches, then a 24-hour wait); key: 1,000 credits a month ≈ 500 searches |
| DuckDuckGo HTML, Mwmbl, Wiby | nothing | best effort (DuckDuckGo often asks automated clients for a human check, which is never bypassed) |
| Marginalia | `MARGINALIA_API_KEY` — free non-commercial key on request by e-mail | independent small-web index |
| Brave | `BRAVE_API_KEY` | still supported, but Brave now requires a payment method |

Only links are taken from these services (from LangSearch also 320 characters of text per result, used to judge whether a link is worth reading). INFINI AI fetches and reads every page itself and never asks a provider for a generated answer. In a deep search or research run all configured services are asked, not only the first. Details and the options that were rejected: `docs/OPERATIONS.md`.

Scholarly abstracts for deep and research runs come from three open indexes. Two need no key; OpenAlex needs a free one to be dependable:

| Index | What you need | Notes |
|---|---|---|
| Crossref | nothing | The DOI registry; delivers the abstract where the publisher deposited one. |
| Europe PMC | nothing | Life sciences and medicine; also delivers the full text of open-access articles. |
| OpenAlex | nothing, or `OPENALEX_API_KEY` — free account, no card | Since February 2026 OpenAlex answers without a key only on a small daily allowance and pauses anonymous search under load. With a free key it is dependable; without one, Crossref carries the load. |

A research run makes at most `RESEARCH_KEYED_SEARCHES` (default 5) further searches on a service metered by the month, such as Tavily, so that one run does not eat a monthly quota, and at most `RESEARCH_LANGSEARCH_SEARCHES` (default 12) on LangSearch, whose allowance renews daily (30,000 to 36,000 tokens per run, measured on the live site).

## Documentation

| File | Contents |
|---|---|
| [`docs/INFINITY-LLM.md`](docs/INFINITY-LLM.md) | Infinity LLM: what existed before, what changed, the model, the tokenizer, training, the learning cycle, licence and quality filters, verification, evaluation, the promotion gate, versions and rollback, serving, limits, and the measured results of the published model. |
| [`docs/REPORT.md`](docs/REPORT.md) | Full report: version 3.1.0 first (LangSearch, the OpenAlex key, what they changed), then 3.0.0 (deep search and research runs): what was built, how, what works (with the evidence), why, and the limits. |
| [`docs/REPORT-2.0.0.md`](docs/REPORT-2.0.0.md) | The report for version 2.0.0 (the built-in brain). |
| [`docs/BRAIN.md`](docs/BRAIN.md) | The built-in brain: what it is and is not, how a message is handled, memory, spelling repair, data files, how to edit and rebuild it, measurements, limits. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design constraints, technology evaluation, the two parts and the pipeline, the research loop, classification, the report composer, modules, the kinds of memory, evidence graph, confidence formula, platform targets. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Installation, environment variables (including the limits on research runs), HTTP API and its events, production deployment (VPS, container, Vercel), Android install. |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Research benchmark, brain checks, web benchmark, resource benchmark, security audit, failure scenarios, research notes and exact limitations. |
| [`engine/brain/data/NOTICE.md`](engine/brain/data/NOTICE.md) | Credits and licences of the open datasets inside the brain's data. |

## Repository layout

```
llm/      model.py (the Transformer)  train.py  evaluate.py  export.py  hw.py  tests/   (Python + PyTorch; training only)
learning/ sources.mjs licence.mjs process.mjs verify.mjs corpus.mjs dataset.mjs (data) · cycle.mjs evalsuite.mjs registry.mjs manager.mjs cli.mjs (training cycle, gate, versions)
model/    current/ (the published model: weights.bin model.json tokenizer.json)  snapshot.json (the published learning records)
engine/   neural/ (tokenizer.js model.js generate.js service.js: Infinity LLM inference in plain JavaScript)
          brain/ (the built-in brain: index.js normalize.js pattern.js store.js sense.js skills.js spell.js lexicon.js data/)
          research/ (run.js: the search–read–compare loop · frontier.js: the queue of leads · aspects.js salience.js: sub-topics · digest.js directive.js)
          classify/ (classify.js: sorting of everything found)   synth/ (synth.js · report.js: the report)   providers/ (… scholar.js: OpenAlex, Crossref, Europe PMC)
          nlp/ plan/ net/ extract/ rank/ evidence/ math/ util/  index.js config.js
server/   app.js (HTTP layer)  server.js (standalone)
api/      index.js (serverless entry)        vercel.json   Dockerfile   .env.example
public/   index.html app.css app.js learning.html learning.css learning.js sw.js manifest.webmanifest icons/
tools/    brain/ (editable sources of the brain's data: intents/ fun.txt commonsense/ spell-names.txt sources/; build.mjs fetch-raw.mjs dev/)
          dev/ (run.mjs: ask the engine directly, with recording and replay of its HTTP traffic · phrasings.mjs: how messages are understood)
test/     unit.test.js brain.test.js research.test.js (offline; research runs are tested on a synthetic web)  ui-smoke.mjs (drives the real client against the real server)
bench/    intelligence.js  research.js  resources.js  security.js  results/
cli.js
```

## Commands

```bash
npm start                 # server
npm test                  # 84 offline tests: engine, brain, research runs, and 16 for Infinity LLM (tokenizer, inference parity with PyTorch, licence and quality filters, verification, reply check, gate, registry, rollback, API, interface)
npm run test:llm          # 9 tests of the neural network and its training in PyTorch (needs Python with torch)
node learning/cli.mjs cycle      # one learning cycle; also: status · hw --bench · chat "hello" · rollback · publish
npm run test:ui           # 49 end-to-end checks of the browser client, including a research run (needs network; about 90 s)
npm run bench             # web benchmark (live; slow without INFINI_CONTACT)
npm run bench:research    # three research runs and two deep searches, with everything they read counted (live; about 3 minutes)
npm run bench:resources   # startup, memory, CPU, throughput, latency, cache
npm run audit:security    # 21 automated security checks
node tools/dev/run.mjs research "the health effects of microplastics" --full    # one question straight to the engine (REPLAY=name records and replays the traffic)
node tools/brain/build.mjs dialogue    # rebuild the brain's conversation data after editing tools/brain/
node tools/brain/dev/chat.mjs "hi" "how are you" --- "tell me a joke"    # replay a conversation in the terminal
```

## Sources and terms

Providers are used through documented public APIs where they exist (MediaWiki, Wikidata, Crossref, OpenAlex, Europe PMC, Stack Exchange, arXiv, HN Search, MDN, Mwmbl, Marginalia, Wiby, DuckDuckGo Instant Answers, publisher RSS/Atom feeds). During a research run a site is asked for at most two pages at a time (one, with the pause it asks for, when its robots.txt sets a Crawl-delay) and for at most 12 pages in all (24 for the site of a scholarly publisher); Wikipedia and Europe PMC are read through their APIs, within the request budgets those services publish. The DuckDuckGo HTML interface is a public no-JavaScript page rather than an API; it is queried once per search, its robots rules are respected, and a human-verification page is treated as a failure and never bypassed. robots.txt is honoured for every page fetch; pages that opt out of excerpts are not quoted; paywalls, logins and CAPTCHAs are never circumvented. Wikipedia text is CC BY-SA, Wikidata is CC0, Stack Exchange content is CC BY-SA — every quotation links to its source.

The brain's data builds on open datasets: ConceptNet 5.7 and the FrequencyWords list (CC BY-SA 4.0), WordNet 3.1 (WordNet licence), example phrasings from Microsoft's Personality Chat (MIT) and CLINC150 (CC BY 3.0). The files derived from share-alike sources (`commonsense.json`, `vocab.txt`, `spell-guard.txt`) are themselves under CC BY-SA 4.0. Full credits: `engine/brain/data/NOTICE.md`, also shown in the app under About.
