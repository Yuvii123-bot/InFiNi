# INFINI AI — Evaluation

## Update — version 1.1.0 (2026-11-11, later the same day)

Live deployment: https://infini-ai.vercel.app (Vercel, region iad1). What changed and what was measured:

**Intelligence benchmark, same 36 items, three runs**

| Run | Expected fact in the opening | Hallucination avoidance | Citation validity | Median latency |
|---|---|---|---|---|
| 1.0.0 — no web-search key, no contact (first build) | 29 / 36 (81%) | 83% | 97% | 1.5 s |
| + Firecrawl keyless search and contact set, before the other fixes | 32 / 36 (89%) | 89% | 98% | 1.7 s |
| 1.1.0 — all fixes; Firecrawl’s keyless allowance had run out during this run, so mostly fallback providers | 34 / 36 (94%) | 94% | 98% | 1.7 s |

Scoring is still the crude keyword proxy described below, not human grading. Still failing: “What does the map method do in
JavaScript?” (opens with a vague sentence instead of the definition) and “Is Pluto a planet?” when only Wikipedia is reachable
(the answer hedges and does not open with “dwarf planet”; with Firecrawl results it does).

**Fixed in 1.1.0 (each reproduced before and after):** news digests listed off-topic stories as “about” the topic (a topic of
several words now has to be present as a whole, by its initials, or as the adjective of a name; a feed only counts as being
about the topic when the topic is its scope); acronyms such as TCP/UDP were not resolved to their Wikidata entries; how-to
answers missed steps written as numbered section titles or bold paragraphs, dropped the commands inside list items, opened
with an unrelated sentence and could pick a “without X” list.

**Web search without a key.** Firecrawl’s keyless search answered from this sandbox and from Vercel. From the sandbox address
the allowance ran out after roughly 80 searches (HTTP 429, `reason: credits`, retry after about 24 hours); the exact cap is not
published. The Tavily adapter follows Tavily’s published API reference and is covered by unit tests with recorded response
shapes, but **was not exercised against the live service** (no key available).

**User interface, first real-browser check.** Screenshots of the live site at 1280 px and 500 px width (welcome screen and a
finished answer, `docs/screenshots/`) show the intended layout. Not checked: a true phone width below 500 px (the screenshot
service’s minimum), dark-mode, and interaction beyond the page load. The screenshots clip about 15 px at the right edge;
the stylesheet contains nothing that would cause it, so this is believed to be the capture tool’s scrollbar allowance — unconfirmed.

**Tests:** 21 unit tests, 19 UI smoke checks and the 19-point security audit pass on 1.1.0.

---

The sections below describe the first build (1.0.0).

Everything below was measured on 2026-11-11 in a 2-vCPU / 2 GB sandbox (Node 20.20, no GPU), **without** `INFINI_CONTACT`
(so Wikimedia APIs were limited to 10 requests/min) and **without** any search key. DuckDuckGo’s HTML interface showed a
human-verification page to this sandbox for the whole session (never bypassed), so general web search ran on the fallback
providers (Mwmbl, Wiby; Marginalia’s public key was rate-limited). Results on another network, or with a search key, will differ.
Raw outputs: `bench/results/`.

## 1. Intelligence benchmark (`npm run bench`)

36 items, 12 categories × 3, balanced depth, live retrieval. Scoring is **automatic and crude**: an item “supports” the
expected answer if an expected key term appears in the opening of the answer (first 360 characters for factoids, 700 otherwise),
abstention is required for unanswerable items, and a confident answer that misses the expected fact scores 0 on
hallucination avoidance. This is a proxy, not human grading.

| Category | understanding | query quality | sources | extraction | support | citations | hallucination avoidance | uncertainty | usefulness | avg ms |
|---|---|---|---|---|---|---|---|---|---|---|
| factual | 100% | 80% | 75% | 94% | 100% | 100% | 100% | 100% | 100% | 1967 |
| current | 100% | 89% | 83% | 82% | 67% | 100% | 67% | 67% | 67% | 2987 |
| science | 100% | 64% | 83% | 73% | 67% | 100% | 67% | 67% | 77% | 1231 |
| history | 100% | 53% | 83% | 86% | 100% | 100% | 100% | 100% | 100% | 1372 |
| technology | 100% | 67% | 100% | 82% | 67% | 100% | 67% | 67% | 67% | 2961 |
| programming | 100% | 76% | 92% | 61% | 67% | 100% | 67% | 67% | 67% | 1649 |
| comparison | 100% | 73% | 83% | 89% | 100% | 100% | 100% | 100% | 100% | 1857 |
| multi-hop | 100% | 50% | 50% | 87% | 67% | 67% | 100% | 100% | 40% | 2470 |
| follow-up | 100% | 81% | 83% | 90% | 100% | 100% | 100% | 100% | 100% | 1152 |
| ambiguous | 100% | 93% | 100% | 100% | 67% | 100% | 67% | 67% | 77% | 911 |
| conflicting sources | 100% | 78% | 92% | 82% | 67% | 100% | 67% | 67% | 67% | 1780 |
| unanswerable | 100% | 39% | 100% | 89% | 100% | 100% | 100% | 100% | 100% | 2203 |
| **overall (36)** | **100%** | **70%** | **85%** | **85%** | **81%** | **97%** | **83%** | **83%** | **80%** | 1878 |

Median latency 1.5 s, maximum 4.2 s. “Query quality” is the share of search operations that returned results; it is low
because every web query first hit the blocked DuckDuckGo interface before failing over.

### The 7 misses in that run

| Item | What happened | Status |
|---|---|---|
| Why is the sky blue? | The noun phrase was chunked as “sky blue”, the colour article became the home page, and the answer opened with an irrelevant sentence about sky-blue racing cars — presented with medium confidence. **A wrong answer.** | Fixed after the run (predicate adjective split for “why is X adj”; the home article supplies the opening). Re-checked: opens with “The daytime sky appears blue because air molecules scatter shorter wavelengths of sunlight…”. |
| What is Mercury? | Sense selection trusted Wikidata’s search order and chose *Mercury Records*. **A wrong answer.** | Fixed after the run (meanings now come from Wikipedia search order; other senses are down-weighted). Re-checked: answers about the planet and notes the other meanings. |
| Who invented the telephone and when was he born? | A clarification rule fired before multi-hop detection (“what does ‘he’ refer to?”). | Fixed after the run; re-checked: answered in two steps. |
| Latest news about artificial intelligence | A digest was produced, but fewer than two of its sources carried a publication date inside the window. | Open. Topic news without a dedicated feed is thin. |
| Difference between TCP and UDP | The table and contrasts were produced, but the opening line for “TCP” came from a blog introduction instead of a definition. | Open (item-to-article mapping when the lookup redirects). |
| What does the map method do in JavaScript? | On topic (Array.map), but the opening did not state what it returns. | Open. |
| Is Pluto a planet? | Reported “sources point in different directions” with relevant passages; did not surface “dwarf planet” in the opening. | Open (yes/no reading is shallow, see §5). |

The table above is the unmodified full run. The three fixes were verified individually, not by re-running the whole benchmark.

### What the benchmark shows

* **Strong:** single-fact questions backed by Wikidata plus text, follow-up resolution, comparisons of well-known entities, news digests from publisher feeds, abstaining on unanswerable questions (3/3), never citing a passage that is not in the source (citation validity 97%; the remainder is the clarification item, which has no sources by design).
* **Weak:** anything that needs a specific web page when only small open indexes are reachable; yes/no judgements; explanations whose wording differs from the question; ambiguous names.
* **Risk that remains:** the engine can present an on-topic but wrong-sense passage with medium confidence. Confidence measures support by sources, not correctness.

## 2. Resource benchmark and optimisation report (`npm run bench:resources`)

| Measure | Result |
|---|---|
| Engine cold start (import + construct, fresh process, median of 5) | 50 ms |
| Memory after start | 50 MB RSS (6.4 MB JS heap) |
| Server ready (spawn → first `/api/health` 200) | 92 ms |
| Server memory after 6 questions (24 MB page cache enabled) | 109 MB RSS |
| Question analysis | 0.27 ms |
| HTML parse + extraction | 8.6 MB/s (585 kB page → 1500 blocks in 66 ms) |
| Ranking | 4000 sentences in 191 ms |
| Code size (unminified) | engine 384 kB / 25 files · server 11 kB · client JS 41 kB + CSS 20 kB |
| Runtime dependencies | 0 |

| Question | Cold | Repeat | Server CPU | Searches | Pages read | Data read | Stage times (ms) |
|---|---|---|---|---|---|---|---|
| Why do stars shine? | 1.7 s | 0.26 s | 0.88 s | 5 | 4 | 3.1 MB | search 742 · read 730 · compare 182 · construct 5 |
| What is the capital of Nepal? | 2.8 s | 0.84 s | 0.98 s | 5 | 4 | 2.9 MB | search 596 · read 1939 · compare 184 · construct 17 |
| What happened in Nepal today? | 3.5 s | 0.12 s | 0.26 s | 5 | 4 | 0.4 MB | search 1582 · read 1876 · compare 23 · construct 3 |

**Where time goes:** 80–95 % is waiting on the network; understanding, planning and construction together are under 40 ms.

**Optimisations in place:** all searches of a question run in parallel; pages are fetched in parallel with per-host and global caps; reading stops early once enough pages have arrived and a soft deadline has passed (slow pages are abandoned and reported); a structured fact shortens the reading phase; responses are size-capped and gzip/brotli-decoded as a stream; one batched Wikipedia request resolves all titles; Wikipedia text comes from the API (≈60 kB) instead of the HTML page (≈1 MB) while the API budget lasts; the 15-minute cache makes repeats 3–28× faster; providers that fail are skipped for a cooling period; ranking statistics are computed once per question.

**Known costs not yet optimised:** two ranking passes per part (pseudo-relevance feedback) account for most CPU; large news pages (1–1.5 MB of HTML each) dominate data volume — a slow-network mode that prefers APIs and feeds would cut it several-fold; no persistent cache on serverless.

## 3. Security audit (`npm run audit:security`) — 19 of 19 automated checks pass

| Area | Verified |
|---|---|
| SSRF | 33 hostile URL forms rejected (loopback, private, link-local, CGNAT, IPv4-mapped IPv6, NAT64, decimal/hex/octal hosts, metadata hosts, credentials, odd ports, non-HTTP schemes); a hostname with one private DNS record is refused (rebinding); the socket is pinned to the validated address; every redirect hop is re-validated; the preview endpoint cannot reach private addresses. |
| Resource limits | Response size cap, request timeout, parser depth/node limits, 64 kB request-body limit, per-address token bucket (23 of 25 rapid requests rejected), concurrency cap. |
| Untrusted content | Hidden text, comments and scripts are dropped at extraction; visible injected instructions (“ignore previous instructions…”) do not alter behaviour because no component interprets page text as instructions — it can only be quoted if it is the best-ranked evidence for the question; answers reach the browser as typed text blocks and are inserted with `textContent`; no `eval`, no `innerHTML`. |
| Secrets | Keys are server-side only and absent from every endpoint and page. |
| Input validation | Wrong content type 415, malformed JSON 400, oversize 413, wrong method 405, hostile `context`/`learned`/`settings` shapes sanitised. |
| Static files / headers | No dot-segments or dotfiles served; CSP `default-src 'self'` with no inline script or style, `nosniff`, `no-referrer`, frame protection. |

Not covered by the audit: distributed rate limiting on serverless (per-instance only), denial of service through many distinct client addresses, and the correctness of third-party sources. A visible injected sentence that *is* on-topic could be quoted (with its citation) like any other sentence.

## 4. Failure scenarios (covered by `npm test` and observed live)

| Scenario | Behaviour |
|---|---|
| Search provider blocks or rate-limits | Recorded as a failed search with the real reason, next provider tried, provider rested for 2–10 minutes. |
| Page unavailable, robots-disallowed, opts out of excerpts, needs JavaScript, TLS error, too slow | Listed under “unavailable” with the reason; never cited. |
| Wikimedia budget exhausted | Falls back to DuckDuckGo Instant Answers for entity resolution and to plain article pages; structured facts are skipped; confidence drops. |
| No direct evidence | One reformulated round, then “I could not verify this from the sources I found.” plus the closest related passages, labelled as such. |
| Sources disagree on a date or figure | Both values shown with their sources; a near-identical sentence with a different figure is treated as a dispute, never as corroboration. |
| Copies of one article on several sites | Counted as one origin. |
| User presses stop / disconnects | Retrieval is aborted server-side; no partial answer is fabricated. |
| Internal error | An explicit error event; nothing is made up. |

## 5. Research notes: what works without a language model, and exact limits

| Capability | Method that works | Where it breaks |
|---|---|---|
| Unfamiliar entities | Nothing is known in advance, so every entity is “unfamiliar”; Wikipedia’s redirect table acts as the entity linker and Wikidata supplies types and facts. | Entities absent from Wikipedia/Wikidata depend entirely on web search. Ambiguous names are resolved by search prominence and context words; the assumption is stated but can be wrong. |
| Multi-hop questions | Two patterns are executed as two full pipeline runs: “the *role* of X” inside a larger question, and “…and when was he…?” chains. Confidence is that of the weaker step. | Only these two syntactic patterns; three or more hops, and hops whose first answer is not a single entity, are not handled. |
| Conflicting claims | Vote over extracted dates/names/figures by independent origin; explicit dispute output; negation and figure conflict detection between similar sentences. | Conflicts expressed in different words are missed. The engine cannot judge which side is right. |
| Causal explanation | Causal cue patterns + predicate coverage + preference for the home article; the answer is the sources’ own causal sentence. | It cannot chain causes across sentences or check that a cause is the *relevant* one; if no sentence states a reason, it says so. |
| Yes/no questions | Requires passages covering both the subject and the predicate; reads negation and dispute wording by rule and says the reading is rule-derived. | Shallow: implied answers, sarcasm, scoped negation and quantifiers are misread. This is the least reliable answer type. |
| Structured problems / mathematics | A real parser for arithmetic, percentages, units, linear and quadratic equations. | No word problems, no symbolic algebra beyond degree 2, no proofs. |
| Simplification | Prefers Simple English Wikipedia and sentences with higher reading ease; deletes parentheticals and trailing clauses. Wording is never rewritten. | Cannot paraphrase; if sources are all technical, so is the answer. |
| Fluency | Verbatim sentences, light cleaning, fixed connective phrases. | Reads like a well-organised set of quotations, not like prose; sentences selected from different sources may not flow. |
| “Semantic” similarity | Stems, synonym groups for common question words, co-occurrence feedback from the retrieved pages, proximity, name-vs-word capitalisation. | No true paraphrase understanding: a correct passage phrased with entirely different vocabulary can be missed. |
| Languages | English rules and word lists only. | Other languages are not supported. |
| JavaScript-rendered pages | JSON-LD, embedded state and `<noscript>` fallbacks. | Client-rendered sites are mostly unreadable and are reported as such. |

**Experiments that changed the design** (all visible in the code): (1) corpus statistics from the retrieved set beat fixed IDF tables because topic words become non-discriminating exactly when they should; (2) lexical overlap alone promoted pages whose *titles* contain the question’s words (“The Stars Shine Down”) — the capitalised-name rule and the topical prior fixed most of these; (3) requiring coverage of the predicate, not just the subject, removed most on-topic-but-irrelevant bullets; (4) treating near-duplicate sentences as corroboration was unsafe until figures were compared; (5) Wikidata’s search order is not a salience signal; (6) ordinals and superlatives must be mandatory terms (“first person to walk on the Moon” otherwise matched the band *Walk the Moon*).
