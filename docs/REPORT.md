# INFINI AI 2.0.0 — full report

Live site: **https://infini-ai.vercel.app** · released 12 November 2026 · Vercel deployment `dpl_BLF21bHZvmPoU812QT8EpsJuQ6BZ`

The brief for this round was to give INFINI AI its own brain, so that it can hold a conversation instead of sending
"how are you" to a search engine, and still contain no language model. This report covers what was built, how, what
works (with the evidence), why it is built this way, and what does not work.

## 1. In short

* **INFINI AI can now talk.** Greetings, small talk, questions about itself, feelings, jokes, riddles and small games are
  answered at once by a built-in brain, without a web search.
* **It remembers the conversation.** Tell it your name, where you live or what you like, and it uses that later in the
  same chat. This memory stays on your device.
* **It has everyday common sense and a few exact skills**: "can a penguin fly", the time and date in your time zone,
  sums, dice, coins.
* **It understands casual typing and typos.** "heyyy hw r u" is read as "hey how are you". A misspelled question such
  as "what si a quantum conputer" is now searched as "what is a quantum computer".
* **It is honest about what it is.** The brain is rules and prepared data. It is not a language model, it is not
  conscious, and it has no feelings; it says so when asked. It never invents a fact: anything that needs knowledge still
  goes to the live web and comes back with sources.
* **Web answers are unchanged and were measured again**: 36 of 36 on the benchmark.
* Tests on the released code: 45 of 45 unit tests, 33 of 33 interface checks, 20 of 20 security checks.
* **One thing I still need from you:** the name to give when someone asks "who made you" (see section 7).

## 2. What INFINI AI is now

Two parts, neither of which is a language model:

| Part | Answers | How |
|---|---|---|
| The built-in brain (`engine/brain/`) | Conversation, questions about itself, what you told it, everyday common sense, clock and calendar, small sums, jokes and games | Matches your message against 49,511 stored phrasings and picks one of 898 replies written in advance, fills in what it remembers, or runs an exact function. 220,406 stored common-sense relations. |
| The web pipeline (the rest of `engine/`) | Everything that needs knowledge | As before: understands the question, searches, reads the pages, compares them, and builds an answer from sentences it found, each with its source. |

Every message goes to the brain first. It either replies itself or hands the message to the web pipeline.

| What you type | What happens |
|---|---|
| "hi", "how are you", "tell me a joke" | The brain replies in well under a second, with suggestion chips. |
| "my name is Yuv" … "what is my name?" | The brain stores it and recalls it ("Your name is Yuv"). |
| "can a penguin fly" | "No. A penguin can't fly. It can swim, dive and walk, though." Labelled as built-in common sense, with a button to check it on the web. |
| "who invented the telephone" | Goes to the web pipeline; a cited answer comes back. |
| "thanks! who invented the telephone?" | "You're welcome!" followed by the cited answer. |
| "are you sure?" after a web answer | "Fairly sure. That answer scored high confidence (76%) and rests on 4 sources …" with the real figures. |
| "write an essay on global warming" | "I can't write an essay for you. I have no language model …" and an offer to gather cited key points instead. |
| "set an alarm for 6 am" | "That one's outside my reach: I can't control your phone, apps or anything in the real world", and an offer to find instructions. |
| "what si a quantum conputer" | Shown as "Understood as: What is a quantum computer?" with a "Search as typed" link, then answered. |

The detailed description is in [`BRAIN.md`](BRAIN.md).

## 3. What was built in this round, and how

### 3.1 The brain's logic

A message passes through these steps, and the first one that produces a result wins:

1. **Normalise** the text: lower case, contractions, chat shorthand, stretched letters ("heyyyy"), emoji.
2. **Safety**: crisis wording gets a supportive reply and a helpline search for the user's country; clearly harmful
   and sexual requests are declined.
3. **Pending question**: if the brain asked something last turn ("How are you?"), the message is tried as the answer.
4. **Exact phrase**: the message is one of the stored phrasings.
5. **Feelings**: "i am / i feel …" with a feeling word.
6. **Slot rules**: 246 patterns with a variable part ("my name is {x}", "time in {x}"), each with a handler that may decline.
7. **Common sense**: a question about an everyday thing the fact base knows.
8. **Triage**: everything else is sorted into "send to the web", "I can't do that", "I don't know that about myself"
   or, for a short first-person statement only, a small-talk remark.

Triage is deliberately conservative, because the worst failure for this design is a chat layer that talks over a
question it should have looked up.

### 3.2 The data

| File | Content | Where it comes from |
|---|---|---|
| `dialogue.json` (1.0 MB) | 280 situations, 49,511 phrasings, 898 replies, jokes, riddles, stories | Every reply was written for this project. 29,151 phrasings were written for it too; 20,360 example phrasings come from two open datasets (Microsoft Personality Chat, CLINC150). |
| `commonsense.json` (2.8 MB) | 220,406 relations about everyday things | A hand-written core of 362 things with 4,437 facts, plus "is a kind of" links, synonyms and opposites from WordNet 3.1, and filtered statements from ConceptNet 5.7. |
| `vocab.txt`, `spell-guard.txt` | 31,460 known words; 4,294 real words the spelling repair must leave alone | A public word-frequency list and WordNet. |

How the common-sense data was kept trustworthy: the hand-written core always wins and is the only part answered
plainly; long-tail answers are hedged, labelled as not checked on the web, and offer a search; crowd statements are used
only with enough agreement, and crude or personal ones are dropped; anything safety-relevant ("can dogs eat chocolate")
goes to the web.

The licences are honoured: credits are in the app under About and in `engine/brain/data/NOTICE.md`, and the files
derived from share-alike sources are marked CC BY-SA 4.0.

### 3.3 Memory

The brain keeps a small record per conversation: name, age, place, likes, dislikes, short notes, what it asked last and
which replies it has already used. It travels with the conversation, is stored on your device, and a new chat starts
empty. The server stores nothing. Because it comes back from the browser, the server rebuilds it field by field on every
message and treats it as untrusted input.

### 3.4 What it says about itself

You asked for an assistant with its own brain. What I built is honest about being a program:

* Asked "are you conscious", it says it is not ("No, I'm not conscious …", or "Not in the way you are. I have no inner
  experience."). Asked about feelings, it says it has none.
* It does have a working description of itself: what it is, what it can and cannot do, how it works, whether its systems
  are healthy, and fixed principles it follows, such as never inventing a fact. It can talk about all of that.
* Asked whether it is ChatGPT or another model, it says no and explains how it differs.
* It does not claim abilities it lacks. Requests to write, translate, draw, or act on your phone get a plain refusal and
  an offer of what it can do instead.

### 3.5 Spelling repair

The web pipeline matches words literally, so a typo used to ruin a search ("si" was read as Slovenia). A message on its
way to the web now has its certain typos repaired. The rule is narrow on purpose, because a wrong "correction" is worse
than a typo: it changes shorthand and slips only at the start of a question, a listed set of about 190 common
misspellings, and longer non-words that are one swapped, missing or doubled letter away from exactly one common word.
Names, real words, short words and anything ambiguous are left as typed. The app always shows what was understood and
offers "Search as typed".

### 3.6 The app

* Chat replies show at once, with a small label saying where they came from (built-in memory, a built-in skill, built-in
  common sense) and suggestion chips for a natural next message.
* Every chat reply has **Search the web instead**; a repaired spelling has **Search as typed**.
* Typing dots while a reply is prepared; the composer hint and the About page now describe both parts, and About lists
  the data credits.
* The command-line tool (`node cli.js "how are you"`) uses the brain as well.
* Unchanged on purpose: no framework, no web fonts, no inline scripts or styles, the same strict content security policy.

Screenshots of this version are in `docs/screenshots/`.

### 3.7 Problems found by testing, and fixed

I typed more than 500 messages at the brain during development and ran 1,200 utterances from a public dataset through it.
The main defects found, all fixed and most now covered by a test:

* A catch-all "chatty" reply answered 194 of the 1,200 out-of-scope utterances. It was replaced by the explicit triage.
* "how do you peel a mango" was read as a question about the assistant.
* A question the brain had asked swallowed the next message: "thanks" was stored as a place, and during a riddle "who
  invented the telephone" was judged a wrong guess.
* "again" always produced a joke; "ram ram" (a greeting) became "ram" (a name); "tell me some fake news" was taken as
  an insult.
* A saved answer reused in another chat replaced that chat's memory.
* "what si a quantum conputer" returned "I could not verify this".
* The first key point of that answer was an editorial aside, "(Note: This article describes …".
* "are you open source" and "do I have to pay" were answered with the version number, and "do you have friends" with
  hobbies. Each now has its own answer. After the first release of this version I found one more on the live site: "do I
  have to pay" could be answered "Yes, I'm free to use". I fixed the wording and released again four minutes later.

### 3.8 Release

The project is still deployed without a Git repository, in two stages (a temporary deployment holds the source bundle,
the real one downloads it, checks its SHA-256 and builds). This was done twice in this round. The site showed a
placeholder for under a minute each time. The bundle grew from 238 kB to 1.35 MB because it now carries the brain's data.
Before each release the built function was run locally exactly as the platform calls it.

## 4. What is working, and how I know

**Automated checks on the released code**

| Check | Result |
|---|---|
| Unit tests (`npm test`): 25 for the engine, 20 for the brain | 45 of 45 |
| Interface smoke test, real client against a local server with live retrieval (`npm run test:ui`) | 33 of 33 |
| Security audit (`npm run audit:security`) | 20 of 20 |
| Real Chromium at 360, 390, 820 and 1280 px, light and dark | no horizontal overflow, no console errors |

**Does the brain keep to its job?**

| Check | Result |
|---|---|
| 1,200 out-of-scope utterances from a public dataset (knowledge questions and device commands) | 1,079 go to the web. Of the 121 the brain answers, 70 are honest "I can't do that on your device or accounts" refusals. |
| The web benchmark's 39 questions | 38 go to the web unchanged. "Is Pluto a planet?" is answered from the hand-written fact base. |
| Spelling repair on 23,700 utterances from the same dataset | 51 changed, each read by hand: 37 corrections, 14 shorthand expansions, none harmful. |

**Web benchmark, 36 live questions, Tavily enabled, one run**

| Version | Expected fact in the opening | Avoided unsupported answers | Valid citations | Median time |
|---|---|---|---|---|
| 1.2.0 | 36 (100%) | 100% | 98% | 1.4 s |
| 2.0.0 | 36 (100%) | 100% | 98% | 2.7 s |

The pipeline made the same searches as in 1.2.0, and the brain adds under a millisecond to a web question. The run was
slower across all items. The first 1.2.0 run of the day was also 2.7 s and immediate re-runs were 1.4 s, so I believe the
difference is the search service answering repeated queries faster, but I did not prove that. As before, read the 36 of
36 with care: the questions were written during this project and the engine was tuned on them.

**Speed and memory** (build sandbox, 2 CPUs)

| Measure | Result |
|---|---|
| First chat reply after a cold start | about 155 ms (the data is loaded on first use) |
| Later chat replies | about 0.4 ms on the server |
| On the live site, including the network | 110 to 330 ms per chat reply, measured from the sandbox |
| Server memory | 53 MB idle, about 120 MB once all brain data is loaded (1.x: about 50 MB idle, 109 MB after six questions) |

**Checks on the live site after release**

* `/api/health` reports 2.0.0; `/api/status` reports the brain's data (280 situations, 49,511 phrasings, 898 replies,
  220,406 facts) and Tavily as configured.
* In real Chromium against the live site, phone size: "hi", "how are you", "my name is Yuv", "what is my name?" →
  "Your name is Yuv …". No console errors, no overflow.
* "what si a quantum conputer" → "Understood as: What is a quantum computer?", high confidence (76%), 4 sources.
* "thanks! who invented the telephone?" → "You're welcome!" and the cited answer; "when was he born" → 3 March 1847.
* "are you sure?" → the real confidence and source count of the previous answer.
* "are you conscious" → "No, I'm not conscious …". "write an essay on global warming" → an honest refusal.
* The time is given in the device's time zone ("Kathmandu time").
* The rate limit works (the ninth message in two seconds was refused with "try again in 2 s").
* The temporary upload address is gone; the Tavily key appears in no response or public file; security headers are
  unchanged.

The benchmark and the resource figures were measured on the code just before the last wording fix (two reply texts
and one added situation). The unit, interface and security tests were run again on the final code.

## 5. Why it is built this way

* **Rules and data, not a model.** That was the brief, and it has a real benefit: the brain cannot produce a sentence
  nobody wrote, so it cannot make things up, and every reply can be traced to a line in a text file.
* **Brain first, web for knowledge.** A fixed set of prepared replies can be made good for conversation. It cannot be
  made good for knowledge, so the brain is not allowed to try.
* **Conservative routing.** When in doubt the message goes to the web, and the user can override the choice in one tap
  in either direction.
* **Memory on the device.** The server keeps nothing about anyone, which keeps the privacy promise of earlier versions.
* **Data built ahead of time and loaded on first use.** Start-up stays fast and chat replies take under a millisecond.
* **Open datasets, filtered hard.** Writing 49,000 phrasings and 220,000 facts by hand was not possible; using open data
  blindly gave absurd answers ("a spider is a frying pan"). So the hand-written part always wins and the rest is filtered
  and hedged.
* **Narrow spelling repair.** A first, looser version changed "venmo" to "venom". A repair that damages names is worse
  than no repair.

## 6. What does not work, or is limited

* **It is not conscious and not intelligent the way a language model is.** It answers what was prepared. An unusual
  phrasing of a chat message can fall through to the web or get a generic remark. It cannot write essays, poems or code,
  translate, or reason about new situations.
* **English only.** A few romanised Nepali and Hindi greetings are recognised ("namaste", "k cha"); real conversation
  in those languages is not.
* **Memory is simple.** It understands plain statements ("my name is", "i like", "i live in"). It does not follow
  stories or corrections like "no, I meant my brother". It lasts for one chat and does not carry over to the next.
* **It does not learn from conversations.** Improving it means editing the text files in `tools/brain/` and rebuilding.
* **Common sense covers common things only**, and long-tail answers can be odd. They are labelled and can be checked on
  the web.
* **Spelling repair misses a lot on purpose**: slips in short words ("ocen"), slips that produce another real word, and
  misspelled names ("eifel tower"). A name missing from its guard list could still be changed; "Search as typed" is the
  way out.
* **Nobody outside this project has tested the brain.** All its tests were written by me, on phrasings I chose, plus one
  public dataset. I cannot say how natural it feels to real users, or how often it misunderstands them.
* **The server needs more memory** than before (about 120 MB instead of 50 MB), and the deployment bundle is 1.35 MB.
* Limits from earlier versions still apply: key points can be loosely related; many sites refuse automated reading;
  Tavily's free allowance is about 1,000 searches a month (this round used one benchmark run and six live
  questions, an estimated 50 to 80 searches); the "Redeploy" button on Vercel fails because there is no Git repository.
* **Not tested:** a physical phone (only Chromium's phone emulation), Safari on iPhone, installing as an app on Android in
  this version, and screen readers.

## 7. Suggested next steps

1. **Tell me the creator name.** When asked "who made you", it currently says "an independent developer". Give me the
   name to use (up to 60 characters) and I will set it and release again.
2. **Replace the Tavily key.** It was pasted into a chat earlier, so treat it as exposed. This is still open from the
   last report.
3. **Use it, and send me the conversations that go wrong.** That is the fastest way to improve the brain: each
   misunderstanding becomes a new phrasing or reply in a text file.
4. **Connect a Git repository to the Vercel project**, after which every push deploys by itself.

## 8. Where things are

| Path | Content |
|---|---|
| `engine/brain/` | The brain: `index.js` (conversation logic), `normalize.js`, `pattern.js`, `store.js`, `sense.js` (common sense), `skills.js`, `spell.js`, `lexicon.js`, and `data/` (built files and licence notices). |
| `tools/brain/` | What you edit to change the brain: `intents/*.txt` (situations and replies), `fun.txt`, `commonsense/`, `spell-names.txt`; `build.mjs` rebuilds the data; `dev/chat.mjs` replays a conversation in the terminal. |
| `engine/` (the rest) | The web answer engine, unchanged in structure. |
| `public/`, `server/`, `api/`, `scripts/`, `cli.js` | The app, the HTTP server, the Vercel entry, the build script, the command-line tool. |
| `test/`, `bench/` | `unit.test.js`, `brain.test.js`, `ui-smoke.mjs`; benchmark, resource and security scripts, with results in `bench/results/`. |
| `docs/` | This report, `BRAIN.md`, `ARCHITECTURE.md`, `OPERATIONS.md`, `EVALUATION.md`, `screenshots/`. |

Version history:

| Version | Content | Benchmark (fact in the opening) |
|---|---|---|
| 1.0.0 | Engine, server, app, tests, first Vercel launch | 29 of 36 |
| 1.1.0 | Free web-search providers, 12 answer fixes | 34 of 36 |
| 1.2.0 | Tavily as the main web search, answer fixes, related questions, new logo and interface | 36 of 36 |
| 2.0.0 | The built-in brain: conversation, memory, common sense, skills, spelling repair | 36 of 36 |

Older deployments still on Vercel: `dpl_2M7BNZvZYcZkEAmv3XnTSvzsggpT` (first 2.0.0 build, replaced four minutes later),
`dpl_8p76xdR7TCdRrgfxGnyrNgmtGvmF` (1.2.0), `dpl_4Ubr4ZQ7sq7ZhSsq8m4ZWpkFHkJe` (first 1.2.0 build),
`dpl_HeD2x6rQupfMajUoyLCZKNG47BbD` (1.1.0), `dpl_74nxdP6QiSzZT3TPqeXfjKk1NkMs` (1.0.0).
