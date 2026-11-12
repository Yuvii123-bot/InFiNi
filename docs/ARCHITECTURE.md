# INFINI AI — Architecture

INFINI AI has no language model. Since version 2.0.0 it has two parts:

* a **built-in brain** (`engine/brain/`) for conversation, memory within a chat, everyday common sense and a few exact
  skills. It is rules and prepared data. Full description: [`BRAIN.md`](BRAIN.md);
* an *internet-native* **web pipeline** (the rest of `engine/`) for knowledge: every answer is assembled, at question time,
  from sentences found in sources retrieved at question time.

Every message goes to the brain first; it replies itself or passes the message on to the web pipeline (section 3).
The only world knowledge stored in the app is the brain's common-sense file about everyday things (a penguin is a bird
and cannot fly). It holds nothing about people, places, events or anything recent; all of that is retrieved.

## 1. Constraints that drove the design

| Constraint | Consequence |
|---|---|
| No pretrained LLM anywhere (hosted or local) | Understanding, ranking and synthesis are explicit rules and statistics. Web answers are extractive: a sentence is shown only if it was found in a retrieved source, or it is a template filled with a structured fact that carries its own citation, or it is fixed connective text. Conversation replies are sentences written in advance, chosen by matching the message against stored phrasings; nothing is generated. |
| 2–6 GB RAM devices, no GPU, slow networks | Server process ≈ 115 MB RSS with the brain's data loaded (≈ 50 MB before it is first used), engine load < 0.1 s, first chat reply < 0.2 s, later chat replies ≈ 0.5 ms, zero runtime dependencies, client is 53 kB JS + 32 kB CSS unminified, no framework, no build step. The brain's data is 4 MB on disk (1.3 MB compressed in the deployment bundle). |
| Must be deployable immediately | `node server/server.js` runs it. Same code runs as a serverless function (`api/index.js`) and in a container. |
| Retrieved pages are untrusted | One guarded HTTP client; extraction produces plain text blocks; the browser inserts text with `textContent` only; there is no code path that follows instructions found in pages. |
| Free/open sources by default | Keyless providers with automatic failover; keyed providers are optional and server-side. |

## 2. Technology evaluation

| Option | Assessment | Decision |
|---|---|---|
| **Node.js (plain ES modules)** | Present on every deployment target considered; streams, DNS, TLS and zlib in the standard library; cold start 48 ms and 50 MB RSS measured; the same modules run unchanged in a browser for the pure parts (`util/`, `nlp/`, `rank/`, `evidence/`, `synth/`, `math/`, `extract/`). | **Chosen** for engine and server. |
| TypeScript | Adds a compile step and a dev dependency for type safety only. | Not used; JSDoc comments instead. Can be adopted later without changing the runtime. |
| Python | Good NLP libraries, but those are mostly statistical/neural models or large data files (hundreds of MB); a second runtime would be needed next to the web client. | Rejected. |
| Rust / WASM | Best raw speed and memory, and WASM would allow the engine in the browser. Measured cost today is network-bound (page fetches are 70–95 % of latency; parsing a 585 kB page takes 62 ms in JS), so the gain would be small now. | Deferred. The pure modules have no Node imports, so they are the natural unit to port; the native-Android path (below) is where this pays off. |
| SQLite | Durable server-side store. The server deliberately keeps **no** user data, only a 15-minute in-memory page cache, so there is nothing to persist. | Not used. Appropriate if multi-device sync is added. |
| IndexedDB | Asynchronous, large-quota, structured storage in every browser and in Android WebView. | **Chosen** for conversations and the saved-knowledge cache (with an in-memory fallback). `localStorage` holds only settings and small statistics. |
| Headless browser for JS-rendered pages | 300+ MB, not available on low-end targets. | Not a dependency. JS-only pages are detected and reported as unreadable; embedded JSON state, JSON-LD and `<noscript>` content are used when present. |

## 3. The two parts and the pipeline

```
            ┌─▶ reply from the brain (conversation · memory · common sense · skill · safety)
message ─▶ Brain
 brain/     └─▶ question for the web (as typed, reworded, or with its spelling repaired)
                 │
                 ▼
            Understanding ─▶ Planning ─▶ Searching ─▶ Reading ─▶ Comparing ─▶ Constructing ─▶ cited answer
             nlp/analyze     plan/plan    providers/*   net/http     rank/rank     synth/synth
                                                         extract/*    evidence/*
```

The brain is skipped for empty input, messages containing a URL, sums, and follow-ups about the previous web answer
("show your sources", "explain that more simply"), which the pipeline handles itself. A brain reply is returned as
`kind: "brain"` with an `origin` (conversation, memory, skill, commonsense, safety) and suggestion chips; it has no
sources and no confidence score, and the interface labels it as such. The user can always override the routing: every
brain reply has "Search the web instead", and a repaired spelling has "Search as typed".

Each stage emits events over the response stream as it happens; the interface shows exactly those events.
If the first round finds no direct evidence, the engine reformulates the query once and repeats Searching → Reading → Comparing.
Two-step questions (“When was the author of *X* born?”) run the whole pipeline twice: the answer entity of step 1 is substituted into step 2.

| Module | Role |
|---|---|
| `engine/brain/normalize.js`, `lexicon.js` | Turns casual typing into plain tokens: contractions, chat shorthand, stretched letters, emoji, vocatives and fillers. Word lists for feelings, crisis wording, rudeness. |
| `engine/brain/pattern.js`, `store.js` | The phrasing-template language (`(a|b)`, `[optional]`, `{slot}`) and the loaded data: exact-phrase table, slot rules, typo correction against the stored phrasings, close-paraphrase match, the common-sense store. Data is loaded on first use. |
| `engine/brain/index.js` | The conversation logic: safety first, pending questions, exact phrases, feelings, slot rules with handlers, common sense, social openings, triage between the web, an honest refusal and a remark. Keeps and sanitises the per-conversation state (name, likes, facts, what was asked last). |
| `engine/brain/sense.js`, `skills.js` | Everyday common-sense questions answered from the fact base (hand-written core first, hedged long tail); exact skills: clock and calendar in the device's time zone, numbers, colours, shapes, words, dice and coins. |
| `engine/brain/spell.js` | Careful spelling repair of a message on its way to the web (see `BRAIN.md`). |
| `engine/nlp/lexicon.js`, `analyze.js` | Closed-class word lists, ~500 verb lemmas, irregular morphology, synonym groups (language knowledge, ≈9 kB — no world facts). Normalisation, meta/calculation detection, multi-part splitting, tagging and noun-phrase chunking, question classification (what/why/how/when/where/who/which/whether, comparison, explanation, prediction, recommendation, calculation, multi-part), temporal cues, weighted query terms, and reference resolution (pronouns, “do it”, “what about X?”, bare “why?”). |
| `engine/plan/plan.js` | Turns the analysis into budgeted tasks: batched title lookup, Wikipedia search, web search chain, vertical sources chosen from the vocabulary of the question, structured-fact requests, news feeds. Three depths (fast / balanced / deep). |
| `engine/providers/*` | Interchangeable adapters: Wikipedia (Action API + plain-page fallback), Wikidata (facts, comparison tables, word-sense choice), DuckDuckGo Instant Answers, DuckDuckGo HTML, Firecrawl Search (keyless or free key), Mwmbl, Marginalia, Wiby, Stack Exchange, MDN, arXiv, Hacker News, GDELT, publisher RSS/Atom feeds; optional Tavily (free key), SearXNG (self-hosted) and Brave. Hosted search APIs contribute links only — never generated text. Web providers form a failover chain; a provider that rate-limits or shows a human check is left alone for a cooling period (challenges are never bypassed). |
| `engine/net/guard.js`, `http.js` | The only way out to the network. URL validation, private/reserved address blocking (IPv4/IPv6, encoded forms), DNS resolution once with the socket pinned to the validated address, per-hop redirect validation, GET only, size cap, timeouts, per-host and global concurrency, robots.txt, per-API politeness budgets, `Retry-After` handling, circuit breaker, LRU cache with TTL. |
| `engine/extract/html.js`, `readable.js`, `feed.js` | A forgiving HTML/XML tokenizer and tree builder (not regex scraping); boilerplate, navigation, hidden-element and link-farm removal; headings, paragraphs, lists, tables, code; title/author/dates from JSON-LD, meta tags, `<time>` and URL; JS-shell detection; RSS/Atom parsing. |
| `engine/rank/rank.js` | BM25-style statistics computed from the pages retrieved for *this* question, weighted query terms, term proximity, implicit-subject credit from headings and titles, predicate coverage, required aspects/ordinals, answer-type cue patterns, a rule that discounts common words appearing only inside capitalised names, topical prior per document, pseudo-relevance feedback, MMR selection, corroboration search. |
| `engine/evidence/evidence.js` | Source classification (primary / secondary / reference / community), independence of origins (publisher family or near-duplicate text counts once), conflict detection (negation, dates, figures), fact/opinion/hedged and current/historical labels, the evidence graph, and the confidence score with explicit factors and caps. |
| `engine/synth/synth.js` | Answer construction per answer type: definitions and explanations, reasons, mechanisms, steps, lists, factoids (structured fact + text vote), yes/no with a rule-derived reading, comparisons (Wikidata table + direct contrasts), news digests, predictions and recommendations as attributed views. Falls back to “I could not verify this from the sources I found.” |
| `engine/math/calc.js` | Recursive-descent calculator: arithmetic, percentages, unit conversion, linear and quadratic equations, with working shown. No `eval`. |
| `engine/index.js` | Orchestrator: asks the brain first, then runs the pipeline; multi-hop execution, conversation context, source list, research log. After a web answer it tells the brain the confidence and topic, so that "are you sure?" is answered with the real figures. |
| `server/app.js` | Framework-free HTTP layer: NDJSON streaming, rate limiting, validation, security headers, static files. |
| `public/*` | The chat application (PWA). |

## 4. The kinds of memory (kept strictly apart)

| Kind | Where | Lifetime | Can it change an answer? |
|---|---|---|---|
| Temporary retrieved information | Server RAM (LRU, 24 MB, 15 min TTL) | Minutes; bypassed by “Regenerate” | Only by serving the same page bytes again. |
| Persistent knowledge cache | Browser IndexedDB, only answers the user explicitly saves | Until cleared in Settings | Reused only for the identical, non-time-sensitive question, and labelled “From your saved knowledge”. |
| Conversation memory | Browser IndexedDB (entities, topic, last predicate, last sources per chat) | Until the chat is deleted | Used only to resolve follow-ups. |
| What the user told the brain | Inside the same per-chat context: name, age, place, likes, dislikes, short notes, what the brain asked last, which replies it already used (under 8 kB) | Until the chat is deleted; a new chat starts empty | Used by the brain's replies ("what is my name", "near me"). Sent with each message and rebuilt field by field on the server, because it is untrusted input. Never stored on the server. |
| Learned statistics | Browser `localStorage`: provider success counts, per-domain fetch/citation/feedback counts, co-occurring vocabulary | Until cleared in Settings | Provider order, a bounded source-quality adjustment (−0.12…+0.08), low-weight query expansion terms. |
| Core engine | Code | — | Contains rules and language word lists only; no world knowledge. |
| The brain's data | Files shipped with the code (`engine/brain/data/`) | Fixed at build time | Phrasings, prepared replies, jokes, and common-sense facts about everyday things. The same for every user; it does not change at run time. |

“Learning” here means exactly these statistics, caches and what the user said in the current chat. Neither part trains, generalises or acquires skills; the brain improves only when someone edits its sources in `tools/brain/` and rebuilds.

## 5. Evidence graph

Nodes: question, subquestion, entity, claim, passage, source, date, relation, answer component.
Edges: *relevant to*, *refers to*, *derived from*, *published by*, *published/updated at*, *supports*, *contradicts*.
The graph for each answer is returned in `research.graph` and summarised in the research panel.

## 6. Confidence

`score = 0.26·source quality + 0.20·independent origins + 0.16·agreement + 0.20·directness + 0.08·completeness + 0.05·extraction + 0.05·recency − contradictions`

Caps: one independent origin ≤ 0.70; time-sensitive without a recently dated source ≤ 0.50; only summaries/abstracts ≤ 0.62; no direct passage ≤ 0.45.
Wikipedia, Wikidata and DuckDuckGo’s Wikipedia-derived abstracts count as **one** origin. Levels: high ≥ 0.74, medium ≥ 0.54, low ≥ 0.34, otherwise “not verified”.
The score measures how well the retrieved sources support the answer — not whether the sources are right.

## 7. Platform targets

* **Web / Android browser / PWA** — implemented (`manifest.webmanifest`, service worker caching the shell only; answers are never cached by the worker).
* **Local execution** — `node cli.js` (interactive, keeps follow-up context) or the server on localhost.
* **Path to native Android** — (1) wrap the PWA as a Trusted Web Activity pointing at a deployed server (no code change); (2) fully on-device: the pure modules run in a WebView as-is, and the network layer (`net/`, provider adapters) needs a native bridge because browser `fetch` cannot read cross-origin pages; that bridge must re-implement the guard (public addresses only, size caps, robots). A Rust/WASM port of `extract/` and `rank/` would then reduce CPU and battery cost.
