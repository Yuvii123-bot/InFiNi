# INFINI AI — Evaluation

## Update — version 3.0.0 (2026-11-12): deep search and research runs

Version 3.0.0 adds the loop described in `docs/ARCHITECTURE.md`, section 3a: searches in rounds, hundreds of pages and
abstracts read for one question, everything classified, a report as the answer. Full account: `docs/REPORT.md`.
All figures were measured on 12 November 2026 in the build sandbox (2 CPUs, 2 GB RAM, Node 20).

**Automated checks**

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 58 of 58: 25 engine tests, 20 brain tests, 13 tests for deep search and research runs |
| of which: a complete research run on a synthetic web of 40 sites and 60 papers, no network | rounds, counters, drafts, report sections, classification totals, “never more pages reported than requested”, links to private addresses never requested |
| of which: the limits | per process at once, per process per hour, per client per hour; the cost of a request by depth; research switched off |
| Interface smoke test, real client against a local server with live retrieval (`npm run test:ui`) | 49 of 49, including a deep search, a research run with live counters and drafts, the explorer, and stopping a run |
| Security audit (`npm run audit:security`) | 21 of 21 |
| Chromium at 390 and 1280 px, light and dark | no console errors; screenshots in `docs/screenshots/` |

**Research benchmark (`npm run bench:research`, live, with a free Tavily key as on the live site)**

<!-- research-table -->

Every figure is counted by the engine. “Pages read” are pages whose text was fetched and read. An abstract delivered by
an index is counted as an abstract. “Not readable” are pages that refused automated access, needed JavaScript, were
closed by robots.txt, no longer existed or were too slow; they are counted and skipped. “Documents kept” is what
remained after duplicates were merged and off-topic documents dropped. The exact figures of the run, the search
services that answered, the failure counts and the report sections are in `bench/results/research.md`.

Three things to know when reading the table:

1. **The budget of 1,500 pages was never reached.** Each research run ended because “new searches were no longer
   bringing new material”: the queue of relevant, readable leads was empty after 260 to 480 pages. More searches on a
   metered service (`RESEARCH_KEYED_SEARCHES`) bring more leads; the default spares the monthly quota of a free key.
2. **Roughly one page in three could not be read** (133 to 185 per research run). Nothing is done to get around a
   refusal.
3. **The numbers move from run to run and from day to day.** On the day of the measurement OpenAlex answered
   “anonymous search is paused” for part of the time and Europe PMC's search timed out repeatedly; Crossref carried the
   abstracts. Without any key, from the sandbox address, the same microplastics question read 170 to 290 pages and 370
   to 800 abstracts in 34 to 86 s in six live runs.

**What the reports are like** (read by hand; these are judgements, not measurements)

* The opening sentences and key points of the five runs answer the question asked. Example (microplastics): “In vitro
  experiments with human cells and in vivo data generated with mice showed that microplastics elicit adverse health
  effects mainly by causing inflammation, oxidative stress …, lipid metabolism disturbances, gut microbiota dysbiosis,
  and neurotoxicity.”
* Sub-topic sections are mostly sensible: *Reproductive effects · Oxidative stress · Inflammation · Metabolic effects ·
  Respiratory effects* (microplastics); *Benefits · Commuting · Job satisfaction · Isolation · Flexibility and autonomy ·
  Retention* (remote work); *Energy density · Challenges · Advantages · Thin-film solid-state batteries · Materials ·
  Uses* (solid-state batteries). A weak label still gets through now and then (“Pollution” for the health question in
  one run).
* The yes-or-no count for intermittent fasting read 51 yes, 3 no, 1 qualified of 55 independent sources. Reading the
  listed statements by hand, most are classed correctly; a sentence that only mentions the topic favourably can be
  counted as “yes” although it is not a finding.
* The why-question (Roman Empire) gets explanations attributed to named historians, and no sub-topic sections — the
  rules found none with enough independent support, and none is better than a forced one.
* “Figures the sources report” is the weakest section: the figures are real and cited, but which four are shown is not
  a judgement of importance.

**Faults found by running it, and fixed before release** (each was seen in a real run)

| Fault | Cause | Fix |
|---|---|---|
| Drafts never appeared | helper functions were declared after the code that built the draft; the error was swallowed | declarations moved; draft errors are now recorded |
| “Solid-state batteries” got “I could not verify this” at every depth (also in 2.0.0) | a hyphenated word was kept as one search term that no text could match | hyphenated and dotted words are matched as their parts |
| “How long do batteries last?” was read as a question about “long” (also in 2.0.0) | the degree word after “how” was taken for the topic | degree words and relation nouns (“impact of …”, “relationship between …”) are no longer the topic |
| A research run read 57 pages instead of 220 | high-ranking leads of one slow site blocked the queue | busy sites are passed over; their leads wait |
| All full-text reads failed after a few search timeouts | one circuit breaker per host | separate breakers per endpoint; any answer resets the count |
| A hostile `depth` value (`__proto__`) switched the rate limiter off for that client | the cost of a request was looked up on a plain object | a `Map`, a guard on the cost, and a check in the security audit |
| Sub-topics such as “Materials”, “Statistical analysis”, “Workers”, “Reduced”, “Exposure” | headings of every paper; participants; verb forms; words that describe the topic | excluded by rule (see architecture) |
| Key points about method (“we searched PubMed”, “articles … were included”, “this review aims to”) | abstracts are full of such sentences | recognised by pattern and kept out |
| “Leans no” for “weight loss occurs if intake is not sufficient to compensate” | a negation inside a condition | conditions and relative clauses are set aside before the reading |
| “1300 — … 1300 mA h cm⁻³ …” in the dated statements | a quantity taken for a year | a number counts as a year only in a date-like context |
| A mouse study as the first statement on a question about people | no notion of who a health question is about | findings in animals rank below statements about people, unless the question asks about animals |

**Web benchmark on 3.0.0 (same 36 items, depth Auto, Tavily enabled, one run)**

| Run | Expected fact in the opening | Hallucination avoidance | Citation validity | Median latency | Answered by the brain |
|---|---|---|---|---|---|
| 2.0.0 as released (depth Balanced) | 36 / 36 (100%) | 100% | 98% | 2.7 s | 1 of 36 |
| 3.0.0 (depth Auto, the new default) | 36 / 36 (100%) | 100% | 98% | 2.7 s | 1 of 36 |

Ordinary questions behave as before. The average rose from 2.8 s to 3.1 s because the three unanswerable items now
widen the search before giving up (the invented-name item took 11 s and still, correctly, ended with “I could not verify
this”). As before, this benchmark is a regression set, not an accuracy estimate. It was run before the last rule changes
of the release, which concern long runs; the unit, interface and security tests were run again on the final code.

**Resources (`npm run bench:resources` and `bench:research`)**

| Measure | 2.0.0 | 3.0.0 |
|---|---|---|
| Engine cold start | 52 ms | 85 ms |
| Server memory idle | 53 MB | 54 MB |
| Server memory after 6 ordinary web questions | 134 MB | 150 MB |
| Process memory during a research run (peak, whole process) | not applicable | 283 to 392 MB over three runs in one process |
| Time of a research run | not applicable | 47 to 66 s (budget 170 s) |
| Time to the first draft of a long run | not applicable | 1.5 to 7.7 s |
| Data read in a research run | not applicable | 52 to 115 MB |
| Size of a research result as sent to the browser | not applicable | 370 to 400 kB (drafts: about 25 kB, then about 95 kB each) |
| Code and data | engine 660 kB in 35 files, plus 4,037 kB of brain data | engine 885 kB in 44 files, plus 4,045 kB of brain data |
| Client | 52 kB JS + 31 kB CSS | 73 kB JS + 40 kB CSS |

**Limits that are known and stated in the app**

* The loop finds what search services, Wikipedia's reference lists, links between pages and three scholarly indexes
  lead to. It has no index of its own. A topic with few readable pages gives a short run.
* PDF files are not read. Many open-access papers are therefore present as abstracts only.
* The classification reads addresses, index metadata and wording. A blog on a `.org` address is an “organisation”;
  a study design is only found when the index or the title names it.
* Reliability tiers rate kinds of sources, not pages.
* Everything is in English.

## Update — version 2.0.0 (2026-11-12): the built-in brain

Version 2.0.0 adds a rule-based brain in front of the web pipeline (conversation, memory within a chat, everyday common
sense, small skills, spelling repair). Description: `docs/BRAIN.md`. Full account of the release: `docs/REPORT-2.0.0.md`.
All figures below were measured on 12 November 2026 on the final code, in the build sandbox (2 CPUs, 2 GB RAM, Node 20).

**Automated checks**

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 45 of 45: 25 engine tests, 20 brain tests |
| Interface smoke test, real client against a local server with live retrieval (`npm run test:ui`) | 33 of 33 |
| Security audit (`npm run audit:security`) | 20 of 20 |
| Chromium at 360, 390, 820 and 1280 px, light and dark | no horizontal overflow, no console errors |

**Does the brain keep to its job?** The risk of putting a chat layer in front of a search engine is that it starts
answering things it should look up. Three checks:

| Check | Result |
|---|---|
| 1,200 out-of-scope utterances from CLINC150 (knowledge questions, device commands; not written by this project) | 1,079 go to the web. 121 are answered by the brain: 70 honest refusals ("I can't do that on your device or accounts"), 16 "near me" questions that ask for or use the user's place, 10 "I'm not sure I can do that", and 25 others (offers to search for advice, common-sense answers, "I can't write that", one small-talk remark). |
| The web benchmark's 39 questions | 38 go to the web unchanged. "Is Pluto a planet?" is answered from the hand-written fact base ("No. Pluto is not a planet; it is a dwarf planet."), labelled as not checked on the web. |
| Spelling repair on all 23,700 CLINC150 utterances | 51 changed, all read by hand: 37 corrections, 14 shorthand expansions, none harmful. A first, looser rule changed 139 and damaged names ("venmo" → "venom", "sportage" → "shortage"); it was narrowed and those cases became tests. |

**Web benchmark on 2.0.0 (same 36 items, Tavily enabled, one run)**

| Run | Expected fact in the opening | Hallucination avoidance | Citation validity | Median latency | Answered by the brain |
|---|---|---|---|---|---|
| 1.2.0 as released | 36 / 36 (100%) | 100% | 98% | 1.4 s | not applicable |
| 2.0.0 as released | 36 / 36 (100%) | 100% | 98% | 2.7 s | 1 of 36 |

The number of search operations per item is the same as in 1.2.0 (154 in total against 158; the difference is the Pluto
item), so the pipeline does the same work. Every item took longer in this run. The same happened in 1.2.0: its first run
of the day also had a 2.7 s median and immediate re-runs had 1.4 s, which points to the search service answering repeated
queries faster rather than to the code. The brain adds under a millisecond to a web question. The keyless resource
benchmark below, run minutes earlier on the same code, shows no slowdown either. The brain-answered item has no searches
or citations by design, so it is left out of the retrieval columns and reported separately (`bench/intelligence.js`).

As before, this benchmark is a regression set, not an accuracy estimate.

The benchmark and the resource figures were measured on the code just before the last wording fix of the release (two
reply texts and one added situation in the brain's data). The unit, interface and security tests were run again on the
final code.

**Resources (`npm run bench:resources`, keyless providers)**

| Measure | 1.x | 2.0.0 |
|---|---|---|
| Engine cold start | 50 ms | 52 ms |
| Server memory idle | 50 MB | 53 MB (the brain's data is loaded on first use) |
| First chat reply in a fresh process | not applicable | 155 ms (loads the conversation data); first common-sense reply 74 ms (loads the fact base) |
| Later chat replies | not applicable | 0.4 ms each on average (520 replies) |
| Memory with all brain data loaded | not applicable | 120 MB RSS, of which 31 MB JavaScript heap |
| Server memory after 6 web questions | 109 MB | 134 MB |
| Code and data | engine 384 kB in 25 files | engine 660 kB in 35 files, plus 4,037 kB of brain data in 8 files |
| Deployment bundle (gzip) | 238 kB | 1.35 MB |
| Client | 41 kB JS + 20 kB CSS | 52 kB JS + 31 kB CSS |

**Problems found by testing in this round, and fixed.** Each was reproduced first.

* A catch-all "chatty" reply for anything unmatched answered 194 of the 1,200 out-of-scope utterances. Replaced by an
  explicit triage; remarks are now given only to short first-person statements.
* A general "you" was read as the assistant ("how do you peel a mango"). Now "you" means people in general unless the
  wording is clearly about the assistant.
* A question the brain had asked swallowed the next message even when it had its own meaning ("thanks" stored as a place,
  "my name is yuv" taken as small talk; during a riddle, "who invented the telephone" was judged as a wrong guess).
* "again" and "another" always produced a joke; "ram ram" (a greeting) was collapsed to "ram" (a name); a rude word
  inside a question ("tell me some fake news") was taken as an insult.
* The colour-mixing and spelling skills fired on unrelated sentences.
* A saved answer reused in another chat replaced that chat's memory, and redoing an older reply rewound it.
* "what si a quantum conputer" was searched literally, with "si" read as Slovenia: "I could not verify this". Now it is
  understood as "What is a quantum computer?" and answered with high confidence.
* "(Note: This article describes …" appeared as the first key point of that answer. Editorial asides about a page are no
  longer quoted as statements about the subject.
* Questions about the assistant answered a neighbouring question: "are you open source", "do I have to pay" and "is this
  free" gave the version number; "do you have friends" gave hobbies; "who is your best friend" gave "no boss". Each now
  has its own answer.

**What these checks do not show.** The brain's tests were written by the author of the code on phrasings the author
chose, plus one public dataset used for the opposite case. Nobody outside the project has used the brain yet, so there
is no measure of how often a real user's chat message is misunderstood, or of how natural the replies feel. Not checked:
a physical phone, Safari on iOS, Android install of this version, screen readers, and any language other than English.

---

## Update — version 1.2.0 (2026-11-12)

Tavily is now the first web-search provider on the live site. (The report written for that release was replaced by later ones; it is in the repository history.)

| Run (same 36 items) | Expected fact in the opening | Hallucination avoidance | Citation validity | Median latency |
|---|---|---|---|---|
| 1.1.0, no Tavily | 34 / 36 (94%) | 94% | 98% | 1.7 s |
| 1.2.0 with Tavily, first run | 35 / 36 (97%) | 97% | 98% | 2.7 s |
| 1.2.0 with Tavily, after the prediction fix | 36 / 36 (100%) | 100% | 98% | 1.4 s |
| 1.2.0 as released (re-run on the final code) | 36 / 36 (100%) | 100% | 98% | 1.4 s |

The benchmark is a regression set, not an accuracy estimate: the items were written during development, scoring is by keyword
match, and the engine was tuned on the items that failed. Accuracy on unseen questions is lower.

**Fixed in 1.2.0 (each reproduced before and after):** “what does X do” questions opened with a detail instead of the definition;
page-header opening paragraphs (MDN layout) were lost in extraction; how-to answers took a step list from an unrelated section;
steps written as numbered paragraphs were not recognised as a list; yes/no answers did not lead with the subject’s defining
sentence; future-tense “who/when” questions were answered as plain facts; out-of-date forecasts were quoted; keyword tag lines,
headline fragments and product pitches appeared as key points.

**Interface.** Checked with Chromium (Playwright) at 360, 390, 820 and 1280 px, light and dark: no horizontal overflow; the
welcome screen fits 390 × 844 without scrolling. The 15 px right-edge clipping reported for 1.1.0 was an artifact of the
screenshot service. Not checked: a physical phone, Safari on iOS, Android install of this version, screen readers.

**Tests:** 25 unit tests, 20 UI smoke checks and the 20-point security audit pass on 1.2.0.

---

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
