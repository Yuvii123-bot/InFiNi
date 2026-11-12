# INFINI AI 1.2.0 — full report

Live site: **https://infini-ai.vercel.app** · released 12 November 2026 · Vercel deployment `dpl_8p76xdR7TCdRrgfxGnyrNgmtGvmF`

This report covers what was built, how, what works (with the evidence), why it is built this way, and what does not work.

## 1. In short

* **Tavily is now the main web search.** Your key is stored as an encrypted setting on Vercel and is used for every web question on the live site. It never appears in the code, the repository or any response.
* **Answers are better.** On the 36-question benchmark the expected fact is in the opening of 36 of 36 answers (34 before this round). Seven kinds of wrong or weak answers found by live testing were fixed.
* **New: related questions** under each answer, built by rule from the pages that were read.
* **New logo**: a drawn infinity ribbon instead of the “∞” text character.
* **New interface**: fits a phone screen, real icons, redesigned composer, source cards and actions.
* Tests: 25 of 25 unit tests, 20 of 20 interface checks, 20 of 20 security checks.

## 2. What INFINI AI is and how an answer is made

INFINI AI answers questions from pages it retrieves at that moment. It contains no language model and calls none. Every sentence in an answer is either copied from a source page or is a fixed template filled with cited facts.

| Stage | What happens | Code |
|---|---|---|
| 1. Understanding | Rules classify the question (who, why, how-to, compare, yes/no, news, prediction …), find its subject and resolve follow-ups such as “he” or “that”. | `engine/nlp/` |
| 2. Planning | The question becomes a set of lookups for different sources. | `engine/plan/` |
| 3. Searching | Wikipedia, Wikidata, a web search chain, news feeds and specialist sources (MDN, Stack Exchange, arXiv, Hacker News) are queried in parallel. | `engine/providers/` |
| 4. Reading | Each page is fetched through a guarded HTTP client and reduced to headings, paragraphs, lists, tables and code. | `engine/net/`, `engine/extract/` |
| 5. Comparing | Passages and sentences are ranked; copies, agreement and contradictions between sources are detected. | `engine/rank/`, `engine/evidence/` |
| 6. Constructing | A composer for the question type assembles the answer from the best sentences, each with its citation, and computes a confidence level by fixed rules. | `engine/synth/` |

Around the engine: a small HTTP server (`server/`), a serverless entry for Vercel (`api/`), a command-line tool (`cli.js`) and the browser app (`public/`), which is an installable web app with chat history stored on the device. The whole project is plain Node.js with **zero npm dependencies** and no build step.

Version history:

| Version | Content | Benchmark (fact in the opening) |
|---|---|---|
| 1.0.0 | Engine, server, app, tests, first Vercel launch | 29 of 36 |
| 1.1.0 | Free web-search providers (Firecrawl keyless; Tavily adapter written but untested), 12 answer fixes | 34 of 36 |
| 1.2.0 | This round | 36 of 36 |

## 3. What was done in this round, and how

### 3.1 Tavily

* The key is a *sensitive* environment variable (`TAVILY_API_KEY`, production) on the Vercel project. It is read only by the server.
* Search order is now `SearXNG → Tavily → Brave → Firecrawl → DuckDuckGo → Mwmbl → Marginalia → Wiby`. The first provider that returns at least three results is used. SearXNG and Brave are not configured, so Tavily answers first.
* Tavily is asked for **links only** (`include_answer: false`). INFINI AI then fetches and reads every page itself, so the answer text never comes from Tavily.
* If the key is rejected, Tavily rests for 15 minutes; if the monthly allowance is used up, it rests for 6 hours. In both cases the next provider takes over and the research panel shows what happened.
* The security audit now sends a question with a deliberately rejected key and inspects the whole answer stream: an answer still arrives, and no key appears anywhere.

### 3.2 Answer quality

Each item was reproduced live, fixed, and checked again.

| What went wrong | Cause | Fix |
|---|---|---|
| “What does the map method do in JavaScript?” opened with a detail about chaining | Any sentence with an action verb scored the same; MDN’s defining paragraph was not extracted at all | “What does X do” is now its own question form. The sentence that defines X near the top of X’s own page is preferred. The extractor keeps opening paragraphs that sit in a page header beside the body. |
| “What does the liver do?” opened with “The liver is also …” | Continuation sentences were allowed as openings | Sentences that lean on earlier text (“… is also …”, “If that …”) cannot open an answer. |
| “How do I build an AI agent?” gave steps for making a phone call | The step list came from a page about agents but under an unrelated heading | The list’s own heading must match the action asked. Steps written as separate paragraphs (“1. …”, “2. …”) or as one list per item are joined back into one list. |
| “Is Pluto a planet?” did not lead with “dwarf planet” | Bullets were in ranking order | The defining sentence of the subject’s own page comes first. |
| “Who will win the 2040 World Cup?” was answered with an unrelated sentence once search results got richer | Future-tense “who” questions were treated as ordinary facts | Every future-tense question goes through the prediction rules. If a future year is named, the quoted sentence must mention it; otherwise the answer is “I could not verify this”. |
| “When will the next solar eclipse happen?” quoted “April 8, 2024” | Old forecasts were not recognised | A forecast that names only past years is dropped. |
| Key points contained tag lines, product pitches and half sentences | No filter for them | Keyword runs, sentences ending in a colon, headline fragments and sentences about a different product are no longer used. |

### 3.3 Related questions

Under an answer the app now offers up to three follow-ups. They are fixed question templates (“How does … work?”, “What types of … are there?”). A template is offered only when a page **about the subject** that was just read has a top-level section on that aspect, or when the answer named a person or place. Hovering shows which section the suggestion came from. Nothing is generated.

### 3.4 Logo

* The old logo was the text character “∞” on a purple square, so it depended on each device’s font.
* The new mark is a drawn infinity ribbon in which one strand passes over the other. It is two SVG strokes with a masked gap at the crossing.
* Colours: cyan `#27C3F0` → indigo `#4458F5` → violet `#7C4DFF`.
* Files in `public/icons/`: `icon.svg` (white mark on the gradient tile), `mark.svg` (gradient mark alone, used beside each answer), PNG icons at 192 and 512 px, a maskable 512 px icon with a safe margin for Android, and a 180 px Apple touch icon. The PNGs were rendered from the SVG with Chromium and compressed (4–39 kB).

### 3.5 Interface

* **Welcome screen** fits a 390 × 844 phone without scrolling (before, the logo and headline were cut off). Suggestions are two columns on phones and three on desktop.
* **Icons** are inline SVG drawn by the app (23 icons). Before, they were Unicode symbols and emoji; the copy symbol showed as an empty box.
* **Composer** is a two-row card with a search-depth chip (tap to switch Fast, Balanced, Deep) and a clear focus ring. A “new chat” button was added to the phone top bar.
* **Answers**: the assistant’s name and mark sit above the text instead of beside it, which gives the text about 42 px more width on a phone. After an answer arrives the view shows the question and the start of the answer (before, it jumped to the end).
* **Sources** have a count header and coloured initials; actions have icons (labels are hidden on narrow phones but kept for screen readers).
* **Colours and type** were rebuilt on a small set of tokens with one accent colour; the dark theme was re-tuned.
* Unchanged on purpose: no framework, no web fonts, no inline scripts or styles, same strict content security policy.

Checked in Chromium at 360, 390, 820 and 1280 px: no horizontal overflow. Screenshots are in `docs/screenshots/`.

**Correction:** in the last report I said screenshots were clipped by about 15 px at the right edge and that the cause was unconfirmed. It was the screenshot service. Real Chromium shows no overflow, in the old version either.

### 3.6 Release

The project is deployed without a Git repository, in two stages: a temporary deployment holds the source bundle in memory, then the real deployment downloads it, verifies its SHA-256 and builds. The temporary deployment is deleted afterwards. This was done twice in this round (the second time for the keyword-line fix). The steps are in `docs/OPERATIONS.md`.

## 4. What is working, and how I know

**Automated checks on the released code**

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 25 of 25 |
| Interface smoke test against live retrieval (`npm run test:ui`) | 20 of 20 |
| Security audit (`npm run audit:security`): SSRF, limits, injected page text, secrets, input validation, headers, rate limit | 20 of 20 |

**Benchmark, 36 live questions**

| Run | Expected fact in the opening | Avoided unsupported answers | Valid citations | Median time |
|---|---|---|---|---|
| 1.1.0, no Tavily | 34 (94%) | 94% | 98% | 1.7 s |
| 1.2.0 with Tavily, first run | 35 (97%) | 97% | 98% | 2.7 s |
| 1.2.0 with Tavily, after the prediction fix | 36 (100%) | 100% | 98% | 1.4 s |
| 1.2.0 as released (re-run on the final code) | 36 (100%) | 100% | 98% | 1.4 s |

Read this figure with care. The 36 questions were written during this project, they are scored by keyword match, and the engine was tuned on the ones that failed. The result shows that these 36 cases pass; accuracy on new questions is lower.

**Checks on the live site after release**

* `/api/health` reports 1.2.0; `/api/status` lists Tavily as configured.
* “What does the map method do in JavaScript?” → MDN’s definition, high confidence, Tavily used (8 results), under 1 second.
* “How do I build an AI agent?” → six steps from Coursera, Tavily used twice.
* “Who will win the 2040 World Cup?” → “I could not verify this”.
* “Who invented the telephone?” → answer from Wikidata and Wikipedia with related questions.
* The key was searched for in every response body and public file: not present.
* Security headers are unchanged; all icons and the manifest load.

## 5. Why it is built this way

* **Extractive answers, no language model.** This was the brief. It means an answer cannot contain a claim that no source made, and every sentence can be traced.
* **Search services supply links only.** If the provider wrote the answer, INFINI AI would be a wrapper around someone else’s model and could not cite sentences.
* **A chain of interchangeable providers.** Free services rate-limit and change terms. With a chain, losing one costs quality, not availability.
* **Zero dependencies and no build step.** It starts in about 50 ms, runs on a small serverless function, and has nothing to keep updated.
* **Rules that say “I could not verify this”.** A system without a model cannot judge plausibility, so it must refuse when the retrieved text does not address the question.
* **Icons and logo as SVG.** Symbols from fonts differ between devices and can be missing; drawings do not.
* **Key on the server only.** A key in browser code can be read by anyone who opens the page.

## 6. What does not work, or is limited

* **It is not a chatbot with reasoning.** It cannot write essays or code, give opinions, or combine facts beyond a few fixed patterns.
* **Key points can still be loosely related.** Example seen live: an analogy sentence (“If you have ever climbed a mountain …”) as the first key point for the map question.
* **Related questions are templates.** Some read stiffly (“What is the history of the AI agent?”), and none appear when the subject’s own page was not read.
* **Many sites refuse automated reading** (for example openai.com, britannica.com, hopkinsmedicine.org). They are listed as unavailable in the research panel.
* **Tavily’s free allowance is about 1,000 searches a month.** A question at Balanced depth uses one or two. When it runs out, answers fall back to Wikipedia and the keyless providers, roughly the 1.1.0 level. Testing in this round used an estimated 200 searches; Tavily’s own counter showed 21 when last checked and appears to lag.
* **The “Redeploy” button on Vercel fails**, because the project has no Git repository. Changing a setting such as the key needs a new deployment by the two-stage procedure, or a connected repository.
* **During a deployment** the site shows a placeholder for about a minute, and one request in that window returned a 404.
* **Not tested:** a physical phone (only Chromium’s phone emulation), Safari on iPhone, installing as an app on Android in this version, and screen readers.
* The stylesheet uses recent CSS (`color-mix`, `dvh`). Browsers older than about 2023 show a plainer page.

## 7. Suggested next steps

1. **Replace the Tavily key.** It was pasted into a chat, so treat it as exposed: create a new key in the Tavily dashboard and send it, or set it in Vercel yourself. A new deployment is needed for it to take effect.
2. **Connect a Git repository to the Vercel project.** After that, every push deploys by itself and “Redeploy” works.
3. Try it on your phone and tell me what looks wrong; that is the one check I could not do.

## 8. Where things are

| Path | Content |
|---|---|
| `engine/` | The answer engine (see section 2). New in this round: `engine/synth/related.js`. |
| `public/` | The app: `index.html`, `app.css`, `app.js`, `sw.js`, `icons/`. |
| `server/`, `api/`, `scripts/` | HTTP server, Vercel entry, build script. |
| `test/`, `bench/` | Unit tests, interface smoke test, benchmark, security audit; results in `bench/results/`. |
| `docs/` | This report, `ARCHITECTURE.md`, `OPERATIONS.md`, `EVALUATION.md`, `screenshots/`. |

Older deployments still on Vercel: `dpl_4Ubr4ZQ7sq7ZhSsq8m4ZWpkFHkJe` (first 1.2.0 build, replaced minutes later), `dpl_HeD2x6rQupfMajUoyLCZKNG47BbD` (1.1.0), `dpl_74nxdP6QiSzZT3TPqeXfjKk1NkMs` (1.0.0).
