# INFINI AI — Architecture

INFINI AI has no language model. It has two parts (the brain since version 2.0.0; deep search and research runs, section 3a, since 3.0.0):

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
| 2–6 GB RAM devices, no GPU, slow networks | Server process ≈ 115–150 MB RSS for ordinary questions (≈ 50 MB before the brain is first used; a research run adds about 300 MB while it lasts), engine load < 0.1 s, first chat reply < 0.2 s, later chat replies ≈ 0.5 ms, zero runtime dependencies, client is 73 kB JS + 40 kB CSS unminified, no framework, no build step. The brain's data is 4 MB on disk (the whole deployment bundle is 1.35 MB compressed). |
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

### 3a. Deep search and research runs (3.0.0)

A quick answer reads about six pages. A deep search or a research run puts a loop behind the first round:

```
first round (as above) ─▶ first draft
        │
        ▼
   ┌─▶ EXPAND   one query on every service that still has budget, all at once: web search, Wikipedia titles, Crossref,
   │            OpenAlex, Europe PMC (medical topics), Hacker News (technical topics); reference lists of the Wikipedia
   │            articles on the topic; round 2 onwards: one query per sub-topic and per key term found so far
   │   READ     a pool of workers takes leads from one queue (the “frontier”), best first: pages are fetched and
   │            digested, abstracts become documents, open-access full texts are read through the Europe PMC API,
   │            links inside relevant pages become new leads (up to 3 steps from a search result)
   │   COMPARE  everything read so far is ranked again; the vocabulary of the best-matching sentences is worked out;
   │            sub-topics are derived from it; a draft answer is emitted
   └── until: page or time budget used · the leads that remain are no longer relevant · every relevant lead was read ·
              two rounds in a row added almost nothing · stopped by the user
        ▼
   classification of every document  ─▶  report (opening, key points, a section per sub-topic, figures, dated
                                          statements, what is still uncertain, where sources differ)
```

| Depth | When | Budget | Rounds |
|---|---|---|---|
| `auto` | default | the quick round; the loop in its smallest form (“widen”: 36 pages, 30 s) only when a part of the question got no direct evidence; a full research run when the message asks for one | 1–2 |
| `deep` | chosen, or “tell me everything about …”, “what does the research say about …”, “investigate …” | 70 pages, 60 abstracts, 45 s | up to 3 |
| `research` | chosen, or “do deep research on …”, “research …”, “detailed report on …”, “find everything you can about …”, “search the whole web for …” | 1,500 pages, 800 abstracts, 170 s, 40 pages at a time | up to 12 |

**How the loop decides, without a language model**

* *Which leads are worth reading* (`research/frontier.js`). Every result and every link is screened before it is fetched: its title, snippet, or — for a link — its link text and the sentence around it are compared with the question's terms and with the sub-topics found so far. Share and login links, tag and author listings and front pages are dropped. Each site has a page limit (12; 24 for a scholarly publisher) so that one site cannot fill the run. A lead whose site is busy or failing is passed over without holding up the others, and stays in the queue as “found but not read”.
* *Which words belong to the answers* (`research/salience.js`). When hundreds of documents have been read, the sentences that match the question best share a vocabulary the question did not contain: for “health effects of microplastics” it is inflammation, oxidative stress, endocrine and so on. Words that recur across independent sources there, and are neither everyday words (a frequency list of 31,000 words) nor generic research prose, are the key terms. For questions of the form “effects / causes / uses of X”, a word counts more when it stands where the answer stands (after “cause”, “include”, “lead to”) than when it stands beside the topic's name (“microplastic pollution”). Sentences that carry key terms are preferred to sentences that merely repeat the question (“more research on the health effects is needed”).
* *Which sub-topics there are* (`research/aspects.js`, `research/run.js`). Candidates are recurring two- and three-word phrases, recurring single key terms, headings that several independent sites share, and sections of a Wikipedia article devoted to the topic. Each must be supported by several independent sources; the standard parts of a paper (“Materials and methods”, “Statistical analysis”, “Outcomes”), questions, the people or creatures a study is about (“employees”, “patients”, “organisms”) and words built on the question's own are excluded. A phrase never runs across a comma or a bracket (in “flexibility, autonomy and retention” the first two words are neighbours in a list, not a name). Two labels for one thing are merged: one describing word with two general nouns (“Immune function”, “Immune system”), or two forms of one word (“Inflammation”, “Inflammatory responses”). A sub-topic becomes a search in the next round, a class in the classification, and — when at least two sources have statements on it — a section of the report.
* *What is not a statement about the world* (`rank/rank.js`). Sentences about how a paper was written (“this review aims to …”, “we searched PubMed …”, “articles … were included”), calls for more research, openings (“… has attracted growing attention”), page titles and references to other parts of a text (“as mentioned above”) are recognised by pattern and kept out of the opening, the key points and the sections. So are the aim of a study wherever it stands in the sentence (“…, we sought to understand how …”), a text describing itself (“… are the main topic of this review”), a protocol's title, and what an authority may do (“If the FDA determines that …, it can take regulatory action”). Statements that something is *not yet known* get a section of their own.
* *Whether a statement is about what was asked* (`rank/rank.js`). Two rules were added after reading real reports. For a question of the form “the impact of X on Y”, a statement must name Y (or a listed synonym): a sentence on the impact of remote work on well-being does not answer a question about productivity. And when a sentence opens with a concession (“Although the adverse effects of X are well documented, the legal system does not address X”), what was asked must stand in the clause that makes the statement, not in the concession; a clause that goes on with “they”, “these” or “it” is left alone.
* *When to stop* (`research/run.js`). A run goes on while new searches still bring pages worth reading. Two rounds in a row that add fewer than 3 % new pages end it; so do the budgets. The reason is part of the result.

**Scholarly sources** (`providers/scholar.js`). One request to Crossref, OpenAlex or Europe PMC returns up to 100 works with abstracts, so a run can take in hundreds of studies in a few requests. One work found through several indexes is one document (matched by DOI). A document built from an abstract is marked “abstract or summary only” and never counted as a page read; when Europe PMC can deliver the open-access full text, the article is read and replaces its abstract. These are free services whose answer times vary widely (Crossref answered in 0.3 s and in 11 s on the same day), so in a long run their searches run beside the reading and may take up to 16 s (12 s in a deep search); answers that arrive late join the queue. Crossref states a limit of three requests per second: the HTTP client starts requests to it at least 380 ms apart (`CROSSREF_GAP_MS`), and a refusal pauses it for 20 seconds, not for minutes.

**Classification** (`classify/classify.js`). Every document is sorted on fixed axes from its address, its type as the index reports it, and its wording: kind of source (scholarly journal, preprint server, news organisation, encyclopedia, government, company …), kind of document (research article, review, meta-analysis, news report, explainer, FAQ …), study design (meta-analysis, systematic review, randomised trial, observational study, case report, laboratory or animal study …), age, reliability tier (a rating of the kind of source, not of the page), how much was read, country of the site (from country-code addresses only), sub-topic, relevance, and — on yes-or-no questions — which way its most direct sentence leans. The result carries the counts per class, a histogram of publication years, and up to 400 documents with their classes.

**The report** (`synth/report.js`, `synth/synth.js`). Built from the sources' sentences only. After a loop the composer cites up to nine independent sources per statement (three shown, the rest on request), gives each source one statement in a list, and adds sections by rule: one per sub-topic; *Figures the sources report* (a figure repeated by a large share of the sources, such as “smaller than 5 mm”, is taken for part of the definition and left out); *Dated statements, in order*; *What the sources say is still uncertain*; *Where the sources differ*. On a yes-or-no question each independent source gets one vote, read from its most direct sentence (negation in the main clause → no; “limited evidence”, “disputed” → qualified), and the answer states the count.

**Limits that protect the host and the sources.** At most `MAX_CONCURRENT_RESEARCH` runs at once and `RESEARCH_PER_HOUR` per hour per process, `RESEARCH_PER_CLIENT_PER_HOUR` per client address; a request beyond a limit is answered at depth `deep` and says so. Per site: two requests at a time, robots.txt and its Crawl-delay honoured, pages that refuse automated reading skipped and counted. Per API: request budgets below what each service publishes. A search endpoint that times out does not block other endpoints of the same host (separate circuit breakers). The request budgets are per minute and per process: two long runs started within the same minute on one process share them, and the second then finds less.

| Module | Role |
|---|---|
| `engine/brain/normalize.js`, `lexicon.js` | Turns casual typing into plain tokens: contractions, chat shorthand, stretched letters, emoji, vocatives and fillers. Word lists for feelings, crisis wording, rudeness. |
| `engine/brain/pattern.js`, `store.js` | The phrasing-template language (`(a|b)`, `[optional]`, `{slot}`) and the loaded data: exact-phrase table, slot rules, typo correction against the stored phrasings, close-paraphrase match, the common-sense store. Data is loaded on first use. |
| `engine/brain/index.js` | The conversation logic: safety first, pending questions, exact phrases, feelings, slot rules with handlers, common sense, social openings, triage between the web, an honest refusal and a remark. Keeps and sanitises the per-conversation state (name, likes, facts, what was asked last). |
| `engine/brain/sense.js`, `skills.js` | Everyday common-sense questions answered from the fact base (hand-written core first, hedged long tail); exact skills: clock and calendar in the device's time zone, numbers, colours, shapes, words, dice and coins. |
| `engine/brain/spell.js` | Careful spelling repair of a message on its way to the web (see `BRAIN.md`). |
| `engine/nlp/lexicon.js`, `analyze.js` | Closed-class word lists, ~500 verb lemmas, irregular morphology, synonym groups (language knowledge, ≈9 kB — no world facts). Normalisation, meta/calculation detection, multi-part splitting, tagging and noun-phrase chunking, question classification (what/why/how/when/where/who/which/whether, comparison, explanation, prediction, recommendation, calculation, multi-part), temporal cues, weighted query terms, and reference resolution (pronouns, “do it”, “what about X?”, bare “why?”). |
| `engine/plan/plan.js` | Turns the analysis into budgeted tasks for the first round: batched title lookup, Wikipedia search, web search chain, vertical sources chosen from the vocabulary of the question, structured-fact requests, news feeds. Three first-round budgets (fast / balanced / deep). |
| `engine/research/run.js` | The loop of section 3a: budgets per depth, searches on every service, harvesting of reference lists, the crawl with its per-site limits, derivation of sub-topics, the next round's queries, the stop rules. |
| `engine/research/frontier.js`, `digest.js` | The queue of leads (screening, scoring, per-site limits, duplicates) and the digest of a page that was read (relevance to the question and to the sub-topics, outline, statistics; only the passages that matter are kept). |
| `engine/research/salience.js`, `aspects.js`, `directive.js` | The vocabulary of the answers; sub-topics from phrases, headings and article sections; recognition of research requests in a message (“do deep research on …”). |
| `engine/classify/classify.js` | Classification of every document and the counted facets (section 3a). |
| `engine/providers/scholar.js` | Crossref, OpenAlex and Europe PMC: search, look-up by DOI, abstracts, open-access full text (JATS XML → text blocks). |
| `engine/providers/*` | Interchangeable adapters: Wikipedia (Action API + plain-page fallback), Wikidata (facts, comparison tables, word-sense choice), DuckDuckGo Instant Answers, DuckDuckGo HTML, Firecrawl Search (keyless or free key), Mwmbl, Marginalia, Wiby, Stack Exchange, MDN, arXiv, Hacker News, GDELT, publisher RSS/Atom feeds; optional Tavily (free key), SearXNG (self-hosted) and Brave. Hosted search APIs contribute links only — never generated text. Web providers form a failover chain; a provider that rate-limits or shows a human check is left alone for a cooling period (challenges are never bypassed). |
| `engine/net/guard.js`, `http.js` | The only way out to the network. URL validation, private/reserved address blocking (IPv4/IPv6, encoded forms), DNS resolution once with the socket pinned to the validated address, per-hop redirect validation, GET only, size cap, timeouts, per-host and global concurrency, robots.txt, per-API politeness budgets, `Retry-After` handling, circuit breaker, LRU cache with TTL. |
| `engine/extract/html.js`, `readable.js`, `feed.js` | A forgiving HTML/XML tokenizer and tree builder (not regex scraping); boilerplate, navigation, hidden-element and link-farm removal; headings, paragraphs, lists, tables, code; title/author/dates from JSON-LD, meta tags, `<time>` and URL; JS-shell detection; RSS/Atom parsing. |
| `engine/rank/rank.js` | BM25-style statistics computed from the pages retrieved for *this* question, weighted query terms, term proximity, implicit-subject credit from headings and titles, predicate coverage, required aspects/ordinals, answer-type cue patterns, a rule that discounts common words appearing only inside capitalised names, topical prior per document, pseudo-relevance feedback, MMR selection, corroboration search. |
| `engine/evidence/evidence.js` | Source classification (primary / secondary / reference / community), independence of origins (publisher family or near-duplicate text counts once), conflict detection (negation, dates, figures), fact/opinion/hedged and current/historical labels, the evidence graph, and the confidence score with explicit factors and caps. |
| `engine/synth/report.js` | The report after a deep or research run: sub-topic sections, figures, dated statements, open questions, differences between sources. |
| `engine/synth/synth.js` | Answer construction per answer type: definitions and explanations, reasons, mechanisms, steps, lists, factoids (structured fact + text vote), yes/no with a rule-derived reading, comparisons (Wikidata table + direct contrasts), news digests, predictions and recommendations as attributed views. Falls back to “I could not verify this from the sources I found.” |
| `engine/math/calc.js` | Recursive-descent calculator: arithmetic, percentages, unit conversion, linear and quadratic equations, with working shown. No `eval`. |
| `engine/index.js` | Orchestrator: asks the brain first, then runs the pipeline; multi-hop execution, conversation context, source list, research log. After a web answer it tells the brain the confidence and topic, so that "are you sure?" is answered with the real figures. |
| `server/app.js` | Framework-free HTTP layer: NDJSON streaming, rate limiting (a deeper search costs more), the per-client limit on research runs, validation, security headers, static files. |
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
