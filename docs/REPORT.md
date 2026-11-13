# INFINI AI — full report (3.1.0, then 3.0.0)

Live site: **https://infini-ai.vercel.app** · version 3.1.0 released 13 November 2026 (UTC) · Vercel deployment `dpl_AJhPhsonyuckhrVrUXibZza751ji`

## Version 3.1.0 — LangSearch, the OpenAlex key, and who built it

**What was asked.** Three short messages: a LangSearch key (“use and integrate this as well if needed”), an OpenAlex
key, and “Nepal369 built infini ai”.

**What was done.**

1. **LangSearch is integrated, and it was needed.** It is now the first web-search service the engine asks. A research
   run asks it up to 12 times (50 links each). One key at a time, on one question: without LangSearch a run read 231
   pages; with it, 895.
2. **The OpenAlex key is in use.** Without a key OpenAlex refused most searches; with it every benchmark run took in
   800 abstracts, which is the limit set for one run (before: 520 to 705).
3. **Asked who made it, INFINI AI answers “Nepal369 built me.”** (checked on the live site).
4. **The reports were tightened.** Runs of a thousand pages showed faults that runs of three hundred had hidden; each
   one found has a rule and a test now (list below).

**Measured** (13 November 2026, build sandbox, released code, the three keys of the live site; `docs/EVALUATION.md`
has the tables, `bench/results/` the raw results):

| Per research run | 3.0.0 | 3.1.0 |
|---|---|---|
| Pages read | 293 to 499 | 880 to 1,500 |
| Abstracts | 520 to 705 | 800 |
| Documents kept | 906 to 1,005 | 1,653 to 2,245 |
| Sites | 102 to 125 | 312 to 522 |
| Time | 45 to 55 s | 70 to 91 s |
| Peak memory | 351 to 388 MB | 598 to 616 MB |

One of the three runs reached the budget of 1,500 pages; the other two ended earlier because new searches stopped
bringing new material. Ordinary questions: 36 of 36 on the web benchmark, median 2.2 s. Tests: 68 of 68; interface check 49 of 49;
security audit 21 of 21.

**On the live site after release:** a research run on the microplastics question took 86 s and read 1,096 pages and
800 abstracts from 393 sites (12,291 results screened, 1,874 documents kept, 368 pages not readable, 47 sources
cited, first draft after 9.6 s, eight drafts). The run before it, on the same question, read 1,016 pages in 92 s. In
version 3.0.0 the same question read 316 pages. “Who made you?” is answered “Nepal369 built me.” in 0.4 s; the
*Pride and Prejudice* question gives Jane Austen, 16 December 1775; the Elm Street question gives “I could not verify
this”.

**Why LangSearch stands before Tavily.** With either one first, all 36 benchmark questions pass. Of the pages LangSearch
pointed to, 94% could be read (Tavily: 81%). Its allowance renews every day; Tavily's renews once a month, and roughly
three quarters of this month's 1,000 Tavily searches are used by my estimate (Tavily's dashboard has the exact figure),
nearly all of them by this project's own benchmarks. Tavily is
still asked when LangSearch rests, and five times in every research run.

**Faults found and fixed in this round**

* A sentence copied from site to site counted as agreement: it made Walter Scott the author of *Pride and Prejudice*.
  Copies now count as one witness, and a name that stands only beside a quotation about the subject (the reader of the
  novel) or only inside one is not a candidate.
* A church's telephone number was offered for “the owner of the blue house on Elm Street”. A described subject must
  now be matched as a whole; the answer is “I could not verify this”.
* A quotation contained HTML tags (an abstract deposited with escaped markup).
* The same sentence appeared in three sections of one report, because three sites carried it.
* Section titles such as “Remote Employees Are Working Less”, “Better Work-Life Balance”, “Employee Productivity”,
  “Remote Autonomy”; “Uses” beside “Applications”.
* Key points that said one thing four times in other words.
* “I looked at various sources …”, “… is considered.”, “Boost productivity with … that help you …” as statements.

**Limits, plainly**

* 1,500 pages is still a ceiling. Two of three benchmark runs ended at 880 and 984.
* More than a quarter of the pages found cannot be read (340 to 441 per run). Nothing is done to get around a refusal.
* A run now takes 70 to 90 seconds and about 600 MB of memory; before, 45 to 55 seconds and under 400 MB.
* The LangSearch allowance is counted in tokens of returned text and its size is shown only in the LangSearch
  dashboard. One research run used 31,566 and 36,198 tokens on the live site, an ordinary question about 600. No limit
  was hit in a day of benchmarks (roughly half a million tokens by my estimate); when it is hit, the engine rests LangSearch until 00:00 UTC and
  asks Tavily and the keyless services instead. `/api/status` shows the tokens used by the running process.
* The report still quotes and sorts; it does not write. Key points on a narrow question resemble one another because
  the sources do. Some section titles are still taken as found (“Fall of rome”, “Reducing commuting”).
* The one-key-at-a-time figures are single runs on one question.

**What I need from you**

1. **Replace the three keys** (LangSearch, OpenAlex, Tavily). They were pasted into this chat, so treat them as
   exposed. Create new ones in each dashboard and put them in Vercel → Project → Settings → Environment Variables
   (`LANGSEARCH_API_KEY`, `OPENALEX_API_KEY`, `TAVILY_API_KEY`), then redeploy.
2. Look at the LangSearch dashboard once after a few research runs, to see how much of the daily allowance one run
   really takes.
3. Still open from before: connect a Git repository to the Vercel project, and send me research runs that go wrong.

---

# INFINI AI 3.0.0 — full report

Released 13 November 2026 (UTC) as Vercel deployment `dpl_FaAckreJCcrZr5skDsNgXaNsvedZ`, since replaced by 3.1.0.

The brief for this round was a search that goes much wider and deeper — up to about 1,500 pages for one question —
with everything it finds classified and the answer written as a report, still without a language model and with only
real, counted numbers. This report covers what was built, how, what works (with the evidence), why it is built this
way, and what does not work. The report for the previous release (the built-in brain) is `docs/REPORT-2.0.0.md`.

## 1. In short

* **INFINI AI can now research a topic.** Write "do deep research on the health effects of microplastics", or set
  **Depth** to *Research*. It searches many services at once, reads the pages, compares them, finds the sub-topics the
  sources share, and searches again for those, round after round.
* **Measured, not promised.** In the benchmark on the released code one research run read **293 to 499 web pages** and
  took in **520 to 705 abstracts of scientific papers**: about 900 to 1,000 documents from more than 100 sites, out of
  5,100 to 6,800 search results screened, in 45 to 55 seconds. On the live site the first run after release read 316
  pages and 800 abstracts in 48 seconds.
* **The budget of 1,500 pages was not reached in any run.** A run ends when new searches stop bringing new material,
  and it says so. About one page in three cannot be read at all. Section 6 explains both.
* **Everything found is classified** by fixed rules: kind of source, kind of document, study design, year, reliability
  tier, sub-topic, how much of it was read. The app shows the counts and lets you filter all documents.
* **The answer is a report**: an opening, key points, a section for each sub-topic, figures, dated statements, what
  the sources say is still uncertain. Every statement is a sentence from a source, with its citation. On a yes-or-no
  question it counts how the independent sources lean.
* **You see it work.** Live counters, the sites just read, and a first draft after a few seconds that is rebuilt after
  each round. Stopping keeps the draft.
* **A middle setting, *Deep*,** reads up to 70 pages and 60 abstracts in about 15 to 50 seconds.
* **Ordinary questions are as before**: 36 of 36 on the benchmark, median 2.4 seconds. Chat still comes from the
  built-in brain.
* **It is still not a language model.** The report quotes and sorts. It does not reason about what it read, and it
  cannot tell a strong study from a weak one beyond the kind of source and the study design.
* Tests on the released code: 62 of 62 unit tests, 49 of 49 interface checks, 21 of 21 security checks.
* **Things I still need from you** are in section 7.

## 2. What was asked, and what was delivered

| Asked | Delivered | Honest difference |
|---|---|---|
| A much wider and deeper search, up to about 1,500 pages per question | A loop of search, read, compare and search again, with a budget of 1,500 pages and 170 seconds | Real runs read 290 to 500 pages plus 500 to 800 abstracts. The budget is a ceiling that the supply of readable, relevant pages does not fill. |
| Classify everything found | Ten fixed classes per document, counts per class, a filterable list of up to 400 documents | The classes come from addresses, index data and wording. They describe kinds of sources, not the worth of a page. |
| Report-style answers | Opening, key points, sub-topic sections, figures, dated statements, open questions, a count for yes-or-no questions | Built from the sources' own sentences by rule. A weak sentence or a weak section title still gets through now and then. |
| No language model | None | |
| Only real numbers | Every figure shown is counted by the engine: pages read, pages that could not be read, abstracts, sites, results screened, seconds | An abstract is counted as an abstract, never as a page. |

## 3. What was built, and how

### 3.1 The loop (`engine/research/run.js`)

One round is: search → screen the leads → read → compare → find sub-topics → decide the next searches.

* **Searching.** Each query goes to every search service that still has allowance, at the same time: Tavily (if a key
  is set), Mwmbl, Wikipedia's title search, and the scholarly indexes Crossref, OpenAlex and Europe PMC. A slow service
  does not hold up the round: reading starts after 3.5 seconds with the leads in hand, and late answers join the queue.
* **Screening** (`research/frontier.js`). Every result and every link is checked before it is fetched, against the
  question's words and the sub-topics found so far. Login and share links, tag pages and front pages are dropped. One
  site may supply at most 12 pages (24 for a scholarly publisher).
* **Reading.** Up to 40 pages at a time, at most two per site, with robots.txt and crawl delays respected. Good pages
  contribute their own links, up to three steps away from a search result. Wikipedia articles on the topic contribute
  their reference lists: cited pages become leads, cited papers become abstracts.
* **Comparing.** After each round all sentences are ranked again against the question.
* **Sub-topics** (`research/aspects.js`, `research/salience.js`). The sentences that answer best share words the
  question did not contain: for microplastics and health these are inflammation, oxidative stress, endocrine and so on.
  Words and phrases that recur across independent sources become sub-topics. Each becomes a search in the next round
  and, if at least two sources have statements on it, a section of the report.
* **Stopping.** The run ends when two rounds in a row add almost nothing, when every relevant lead has been read, or
  when a budget is used. The reason is part of the answer.

Three depths use this loop. *Auto* widens the search only when the first round finds too little. *Deep* runs three
rounds within 45 seconds. *Research* runs up to twelve rounds within 170 seconds.

### 3.2 Scholarly sources (`engine/providers/scholar.js`)

One request to an open index returns up to 100 papers with their abstracts. This is how a run takes in hundreds of
studies in a minute. A paper found through several indexes is one document. When Europe PMC can deliver the full text
of an open-access article, the article is read and replaces its abstract.

### 3.3 Classification (`engine/classify/classify.js`)

Each document is sorted on ten axes: kind of source, kind of document, study design, which way it leans (yes-or-no
questions), sub-topic, age, reliability tier, how much was read, country of the site, relevance. The result carries
the counts and a list of up to 400 documents with their classes.

### 3.4 The report (`engine/synth/report.js`, `engine/synth/synth.js`)

After a loop the composer may cite up to nine independent sources for one statement (three shown, the rest on
request) and adds sections by rule. On a yes-or-no question each independent source has one vote, read from its most
direct sentence, and the answer states the count before the statements.

### 3.5 The app, the server and the command line

* A **Depth** menu in the message box (Auto, Fast, Balanced, Deep, Research).
* A progress panel with live counts, a notice above each draft, the count bar for yes-or-no questions, an overview
  of the classes, and an explorer for all documents with filters.
* The server streams `progress` and `draft` events. On Vercel a request may now run for 300 seconds.
* The brain answers "can you do deep research?" and "how many pages can you read?" itself.

### 3.6 Limits that protect the host and the sources

At most 2 research runs at once and 12 per hour per server process, 6 per hour per client address. A request over a
limit is answered at depth *Deep* and says why. A research run costs four times the rate-limit allowance of an
ordinary question. `RESEARCH_MODE=0` switches research runs off.

### 3.7 Problems found by running it, and fixed

The full table is in `docs/EVALUATION.md`. The ones that mattered most:

| Problem | Fix |
|---|---|
| Drafts never appeared, and the error was hidden | Order of declarations; draft errors are now recorded |
| A research run read 57 pages instead of 220 because one slow site blocked the queue | Busy sites are passed over |
| A hostile depth value switched the rate limiter off for that client | Fixed, with a new check in the security audit |
| "Solid-state batteries" could not be answered at any depth (also in 2.0.0) | Hyphenated words are matched as their parts |
| On a slow day a whole run got no abstracts | The indexes' searches run beside the reading and may take 16 seconds |
| After a burst of searches Crossref refused requests, and for two minutes runs got no abstracts | Requests to it are spaced 380 ms apart; a refusal pauses it for 20 seconds |
| A question about productivity opened with a sentence about well-being | For "the impact of X on Y" a statement must name Y |
| Sentences in which a paper describes itself appeared as key points | Recognised by pattern and kept out |
| Two section titles for one thing; a verb as a section title | Merged or excluded by rule |

### 3.8 Release

Version 3.0.0, commit `202a33e`. Published with the two-stage procedure in `docs/OPERATIONS.md`; the temporary stage
was deleted. The site showed a placeholder page for about a minute.

## 4. What is working, and how I know

**Automated checks on the released code**

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 62 of 62: 26 engine, 20 brain, 16 for deep search and research runs |
| Interface checks against a local server with live retrieval | 49 of 49 |
| Security audit | 21 of 21 |
| Web benchmark, 36 ordinary questions, with Tavily | 36 of 36 with the expected fact in the opening; hallucination avoidance 100%; citations 98%; median 2.4 s |

**Research benchmark** (live, with a free Tavily key, five runs one after another; `bench/results/research.md`)

| Question | Depth | Time | First draft | Pages read | Not readable | Abstracts | Documents kept | Sites | Results screened | Sources cited | Confidence | Peak memory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Health effects of microplastics | research | 45.3 s | 7.7 s | 293 | 166 | 705 | 994 | 102 | 5,850 | 24 | High confidence 80% | 351 MB |
| Impact of remote work on productivity | research | 54.7 s | 5.7 s | 499 | 199 | 520 | 1,005 | 125 | 6,821 | 37 | High confidence 80% | 369 MB |
| Solid-state batteries | research | 48.8 s | 1.6 s | 315 | 133 | 591 | 906 | 113 | 5,127 | 51 | High confidence 86% | 388 MB |
| Is intermittent fasting good for weight loss? | deep | 22.3 s | 6.8 s | 70 | 41 | 48 | 119 | 35 | 757 | 13 | High confidence 90% | 387 MB |
| Why did the Roman Empire fall? | deep | 15.6 s | 1 s | 70 | 44 | 39 | 113 | 29 | 1,229 | 12 | Medium confidence 74% | 309 MB |

Every research run ended because "new searches were no longer bringing new material". The two deep searches ended
at their page budget of 70.

**On the live site, after release**

| Check | Result |
|---|---|
| `/api/status` | version 3.0.0, research enabled, limits as configured |
| "hi, how are you?" | answered by the brain in 0.4 s |
| "can you do deep research?" | answered by the brain, with the page budget of the deployment |
| "Who discovered penicillin and when?" | 3.5 s, 4 sources, high confidence |
| Deep search: "Is intermittent fasting good for weight loss?" | 48.5 s, 69 pages and 60 abstracts from 45 sites, 904 results screened, 16 sources cited, first draft after 8 s |
| Research run: "Do deep research on the health effects of microplastics" | 47.5 s, 316 pages and 800 abstracts from 128 sites, 6,863 results screened, 1,104 documents kept, 167 pages could not be read, 32 sources cited, 6 drafts, first draft after 8.8 s |

The deep search took longer on the live site than in the sandbox (48 s against 22 s) and ended at its time budget.

**Read by hand** (judgements, not measurements). The openings and key points of the runs above answer the question
asked. Most section titles are sensible (Oxidative stress, Reproductive effects, Endocrine disruption, Job
satisfaction, Thin-film solid-state batteries). Examples of what still goes wrong are in section 6.

Screenshots of this version are in `docs/screenshots/` (`research-*.png`, `mobile-deep-*.png`).

## 5. Why it is built this way

* **Rounds instead of one big search.** What to search for next can only be known after reading. The sub-topics come
  from the material, so nothing has to be invented.
* **Abstracts from open indexes.** No amount of crawling reaches 500 studies in a minute; three free indexes do, and
  they say what kind of study each one is.
* **Counting abstracts apart.** An abstract is a summary written by the authors. Calling it a page read would
  inflate the number that matters most.
* **Sentences from sources only.** Without a language model there is nothing that could write a correct new sentence.
  Quoting keeps every statement checkable.
* **A ceiling, not a target.** Reading pages that do not bear on the question to reach a number would make the answer
  worse and load other people's servers for nothing.
* **Limits per client and per process.** A research run costs a hundred times the requests of an ordinary question.
* **Polite to free services.** Request budgets below what each service publishes, spacing where a service states a
  per-second limit, and no way around a refusal.

## 6. What does not work, or is limited

1. **A run reads hundreds of pages, not 1,500.** In every run so far the queue of relevant, readable leads was empty
   after 290 to 580 pages. More searches on a paid or metered service would bring more leads
   (`RESEARCH_KEYED_SEARCHES`); the default spares the monthly quota of a free key.
2. **About a third of the pages cannot be read**: they refuse automated access, need JavaScript, are closed by
   robots.txt, or no longer exist. They are counted and skipped. PDF files are not read at all.
3. **Most scholarly material is abstracts.** In the microplastics benchmark run 705 of 994 documents were abstracts.
   When every key statement rests on abstracts, confidence is capped at 62 % and the app says why.
4. **The report quotes and sorts; it does not think.** It cannot weigh one study against another, notice that two
   sentences say the same thing in different words, or draw a conclusion nobody wrote down.
5. **Weak sentences and titles still get through.** Seen in the last runs: "Plastic particles" and "Employee
   productivity" as section titles (the question again, not a part of it); "Fall of Rome" and "Roman emperor" as
   sections of the Roman Empire answer; a key point that only calls for better waste management. Each run is a little
   different, and each one I read showed one or two of these.
6. **The yes-or-no count is read by rule.** A sentence that only mentions the topic favourably can be counted as
   "yes". It is a count of statements, not a judgement of who is right; the app says this under the count.
7. **"Figures the sources report" is the weakest section.** The figures are real and cited. Which four are shown is
   not a judgement of importance.
8. **Results change from run to run and from day to day.** The free indexes answered in 0.3 seconds at one hour and
   in 11 seconds at another. OpenAlex refused anonymous searches for most of the two days of testing.
9. **Runs close together share allowances.** Two research runs started within the same minute on one server process
   share the per-minute budgets of the free services, and the second finds less (127 pages against 214 in one check).
10. **On Vercel the limits are per warm instance**, so they are best effort. A research run keeps one function busy
    for about a minute and used 350 to 390 MB of memory in the sandbox.
11. **The interface test was loosened once.** One check asked for at least 200 documents in a live research run; it
    now asks for 120, because on a day when the indexes are slow a healthy run can stay below 200.
12. **Three small rules were added after the benchmarks ran** (see `docs/EVALUATION.md`). They do not change the
    counts. The unit, interface and security tests were run after them.
13. Everything is in English. "Redeploy" in the Vercel dashboard still fails, as described in `docs/OPERATIONS.md`.

## 7. What I need from you, and suggested next steps

* **A free OpenAlex key.** It would end the refusals in point 8 and add a second large source of abstracts. It needs
  your e-mail address and one click on a link they send; I cannot do that for you.
* **Replace the Tavily key.** The current one was pasted into this conversation. By my count the testing of this
  release and the earlier ones used roughly 560 to 650 of its 1,000 monthly searches; the Tavily dashboard has the
  exact figure. A research run uses 6 or 7 searches, a deep search 4.
* **The name to give when someone asks "who made you"** (`INFINI_CREATOR`), still open from 2.0.0.
* **A Git repository connected to the Vercel project**, so that updates no longer need the two-stage procedure.
* **Research runs that went wrong.** Send me the question and what was wrong with the report; rules are improved by
  examples.
* Next steps I would take: read PDF files; make a run wait for an allowance instead of ending early (point 9); a
  better choice of figures.

## 8. Where things are

| Path | What it is |
|---|---|
| `engine/research/` | The loop (`run.js`), the lead queue (`frontier.js`), sub-topics (`aspects.js`, `salience.js`), research requests (`directive.js`) |
| `engine/classify/classify.js` | Classes, the yes-or-no reading, the counts |
| `engine/providers/scholar.js` | Crossref, OpenAlex, Europe PMC |
| `engine/synth/report.js`, `synth.js` | The report |
| `server/app.js` | Limits and the cost of a request by depth |
| `public/` | The app: depth menu, progress, drafts, overview, explorer |
| `test/research.test.js` | 16 offline tests, including a whole research run on a synthetic web |
| `bench/research.js`, `bench/results/research.md` | The research benchmark and its last result |
| `tools/dev/` | `run.mjs` asks the engine directly and can record and replay the web; `phrasings.mjs` shows how a message is understood |
| `docs/` | This report, `EVALUATION.md`, `ARCHITECTURE.md` (section 3a), `OPERATIONS.md`, `BRAIN.md`, `screenshots/` |
