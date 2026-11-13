# The built-in brain (introduced in 2.0.0; figures as of 3.0.0)

INFINI AI now has two parts:

* the **brain** (`engine/brain/`) answers conversation, remembers what the user says, knows everyday
  common sense and has a few exact skills;
* the **web pipeline** (the rest of `engine/`) answers everything that needs knowledge, with citations.

Every message goes to the brain first. It either replies itself or passes the message on, sometimes
reworded, to the web pipeline.

## What it is, and what it is not

The brain is **rules and data**. There is no language model and no neural network inside the brain itself.
Since version 4.0.0 the app also has Infinity LLM, a small neural language model of its own
([`INFINITY-LLM.md`](INFINITY-LLM.md)). When that model is loaded it writes the wording of conversational replies,
and the brain still decides what kind of message it is, keeps the memory, answers common sense, exact skills, safety
messages and every question about the assistant itself, supplies the reply whenever the model's own reply fails its checks, and is the standard those checks compare the model's reply with.
Replies about itself come in two sets, marked `[llm]` and `[!llm]` in `tools/brain/intents/`, so that what it says is
true in both situations. Every reply is one of three things:

1. a sentence written in advance (902 of them), chosen to fit the situation;
2. such a sentence with remembered or computed values filled in ("Nice to meet you, Yuv!");
3. the output of an exact function (the clock, a sum, a dice roll, a common-sense lookup).

So it cannot write essays, poems or code, translate, or reason about things nobody prepared it for. It
is not conscious and has no feelings, and it says so when asked. What it adds is that the app can now
hold an ordinary conversation, keep track of it and answer simple everyday questions instantly, instead
of sending "how are you" to a search engine.

## How a message is handled

Since 3.0.0 one thing happens before the brain sees a message: an instruction to research (“do deep research on …”,
“find everything you can about …”) is taken off (`engine/research/directive.js`), so that the brain and the question
analysis get the topic alone. A question *about* research (“can you do deep research?”, “how many pages can you read?”)
has no topic; the brain answers it itself from two prepared situations (`bot.research`, `bot.research_how`), with the
page budget of the deployment filled in.

`engine/brain/index.js`, in this order (the first step that produces a result wins):

| Step | What happens | Example |
|---|---|---|
| Normalise | lower-case, expand contractions and chat shorthand, fix typos against a 31,460-word vocabulary, read emoji | "heyyyy hw r u??" → "hey how are you" |
| Explicit search | "search the web: …" always goes to the web | |
| Safety | crisis wording, clearly harmful requests, sexual requests | "i want to die" → supportive reply and a helpline search for the user's country |
| Pending question | if the brain asked something last turn, try the message as the answer | "How are you?" → "not bad" |
| Exact phrase | the message is one of 52,938 stored phrasings | "who made you" |
| Feelings | "i am / i feel …" with a feeling word | "im so tired" |
| Slot rules | 247 patterns with a variable part, each with a handler that may decline | "my name is {x}", "time in {x}" |
| Common sense | the question is about an everyday thing the fact base knows | "can a penguin fly" |
| Social opening | "thanks! what is …" → answer the opening, continue with the rest | |
| Chain of small phrases | "ok cool thanks" → the phrase that matters most | |
| Close paraphrase | very similar to a stored phrasing (same pronouns and question words) | |
| Triage | decide between the web, "I can't do that", "I don't know that about myself" and a short remark | see below |
| Spelling repair | a message on its way to the web has its certain typos fixed | "what si a quantum conputer" → "what is a quantum computer" |

**Triage** is the last step and the one that decides how the app feels, so its rules are conservative:

* Questions, topics and requests for information go to the web.
* "You" is read as people in general unless the wording is clearly about the assistant
  ("how do you peel a mango" → web; "how do you work" → brain).
* Requests to act on the user's device or accounts get an honest refusal ("set an alarm",
  "delete my contacts").
* "near me", "in my area" and the weather use the remembered place; otherwise the brain asks, suggesting
  the city of the device's time zone.
* Only plain first-person statements get a small-talk remark ("i went to pokhara last week").
* Any reply the brain is unsure about carries a "Search the web: …" chip, and in the app every chat
  reply has a "Search the web instead" button.
* A game or a pending question waits for an answer, but a new question is never swallowed by it
  (during a riddle, "who invented the telephone" goes to the web).

## Spelling repair for web questions

The web pipeline matches words literally, so "what si a quantum conputer" used to find nothing useful
(it read "si" as Slovenia). `engine/brain/spell.js` now repairs a message before it is searched. The rule
is that a repair must never make a question worse, so it changes only what is almost certainly a slip:

* chat shorthand and mistyped little words **in the opening of a question** ("wat r", "hw to", "how do u",
  "waht is", "what si a"). The same letters later in the question are left alone: "what is r programming",
  "the si unit of force", "vitamin b", "teh tarik";
* a listed misspelling of a longer word ("goverment", "enviroment", "recieve": about 190 entries in
  `lexicon.js`);
* a word of seven letters or more that is not a word, where exactly one of the 12,000 most frequent
  English words differs from it by two swapped letters, one missing letter or one doubled letter
  ("presidnet", "populaton", "untill").

It never touches a real word, a capitalised word or acronym after the first word, anything with a digit, a
short word in the topic, or a word on the guard list. A wrong letter is not repaired by rule at all,
because one letter is also all that separates many names and real words from a common word ("sportage" →
"shortage", "venmo" → "venom", "cation" → "caution").

The **guard list** (`data/spell-guard.txt`, 4,294 words) is built, not hand-kept: every word form in
WordNet, every rarer word of the frequency list, their regular inflections and a hand-written list of
names (`tools/brain/spell-names.txt`: products, companies, foods, places in Nepal) are run through the
repair rule, and each one that would be changed goes on the list.

The app shows what was understood ("Understood as: What is a quantum computer?") with a **Search as
typed** link, which sends the original text to the web untouched. "Search the web: …" is literal too.

Measured on the 23,700 utterances of CLINC150 (not written by this project): 51 were changed, and I read
every change. 37 are spelling corrections ("tommorow", "recieve", "definiton", "eli mannign", "can u")
and 14 are expansions of shorthand such as "im" and "hows" (one of them, "hows are ya", stays
ungrammatical). None made a question worse. An earlier, looser version of the rule changed 139, including
"venmo" → "venom", "sportage" → "shortage" and "collies" → "collins"; those cases are why the rule is as
narrow as described above, and they are now in the unit tests.

## Memory

The brain's state for a conversation is a small object (`name, age, place, role, likes, dislikes, notes,
facts`, plus what it asked last, what it said last, and which replies and jokes were already used). It
is returned to the browser with every reply and sent back with the next message, inside the existing
conversation context. Consequences:

* it lives **on the user's device**, with the conversation; a new chat starts empty;
* the server stores nothing about users;
* it is untrusted input, so `sanitizeState` rebuilds it field by field on every request (types, lengths,
  allowed characters, no prototype keys). Tests feed it hostile values.

After a web answer the engine records its confidence, number of sources and topic in the state
(`noteWeb`), so "are you sure?" is answered with the real figures and an offer to double-check.

## Data

Built files in `engine/brain/data/` (generated; do not edit by hand):

| File | Size | Content |
|---|---|---|
| `dialogue.json` | 1.0 MB | 282 situations, 52,938 phrasings (32,578 written for this project, 20,360 imported), 247 slot rules, 902 replies, jokes, riddles, facts, stories |
| `commonsense.json` | 2.8 MB | 220,406 stored relations: 362 hand-written things with 4,437 facts; from WordNet 3.1, 178,259 "is a kind of" links, 23,630 synonyms and 2,452 opposites; and about 11,600 statements about abilities, properties, parts, uses and places from ConceptNet 5.7 and WordNet |
| `vocab.txt` | 0.25 MB | 31,460 known words for the typo corrector, most frequent first |
| `spell-guard.txt` | 0.04 MB | 4,294 real but uncommon words and names that the spelling repair must leave alone |
| `NOTICE.md`, `LICENSE-WordNet.txt` | | attributions and licences |

Sources you edit, in `tools/brain/`:

* `intents/*.txt` — the situations. Format:

  ```
  ## bot.name g=self            situation id, group, optional h=handler
  > (what is|whats) your name   phrasing template: (a|b) alternatives, [optional], {slot}
  ! ms 12 -/regex/              import phrasings from the Microsoft dataset (scenario numbers), with filters
  ! clinc tell_joke             import phrasings from CLINC150 intents
  <[first] Hello! I'm INFINI AI.   reply, with optional conditions in brackets
  < I'm {name}.{?name}             {variables}; {?x} = the brain now expects an answer of kind x
  * What can you do? | Tell me a joke      suggestion chips
  ```

* `fun.txt` — jokes, riddles, fun facts (each with a query to check it on the web), stories, poems.
* `commonsense/core.txt`, `commonsense/words.txt` — the hand-written fact base, opposites, magnitudes.
* `spell-names.txt` — names the spelling repair must not change (add a name here if it is ever "corrected").
* `sources/` — the open datasets used for phrasings and word frequencies.

Rebuild and check:

```
node tools/brain/build.mjs dialogue          # after editing intents, fun.txt or spell-names.txt (6 seconds)
cat engine/brain/data/build-report.txt       # collisions: the same phrasing claimed by two situations
node tools/brain/dev/chat.mjs "hi" "how are you" --- "tell me a joke" "more"     # replay a conversation
node tools/brain/dev/oos.mjs                 # how many out-of-scope utterances the brain answers itself
npm test
```

The long tail of the common-sense file comes from two large downloads that are not kept in the
repository. `node tools/brain/fetch-raw.mjs` fetches and filters them (about 520 MB of download), then
`node tools/brain/build.mjs commonsense` rebuilds the file. Without them the build keeps the long tail
(and the WordNet part of the spelling guard) that is already there. This was checked on 12 November 2026: a fresh download and rebuild produced a
byte-identical `commonsense.json`.

### How the common-sense data was made trustworthy

* The hand-written core always wins. Its answers are given plainly ("No. A penguin can't fly.").
* Category chains come from the WordNet database, followed per word sense. ConceptNet's own category
  links were rejected because following them mixes senses ("a spider is a frying pan").
* From ConceptNet only crowd-sourced Open Mind Common Sense statements are used, and only those with
  weight ≥ 2 or confirmed by a second wording; crude, personal and identity-related statements are
  dropped.
* Long-tail answers are hedged, carry a note that they were not checked on the web, and offer a search.
  Long-tail "where is it found" answers read badly and are not used at all.
* Anything safety-relevant ("can dogs eat chocolate") is sent to the web, never answered from memory.

## What was measured (12 November 2026, in the build sandbox)

The figures in this section are those of the 2.0.0 release, when the brain was built. With 3.0.0 the test counts are
58 unit tests and 49 interface checks (`docs/EVALUATION.md`); the brain's own 20 tests are unchanged and pass.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 45 of 45 pass: 25 engine tests, 20 brain tests |
| Browser client driven against a local server (`node test/ui-smoke.mjs`) | 33 of 33 checks pass, including the web pipeline and the spelling repair |
| Real Chromium at 360, 390, 820 and 1280 px, light and dark | no horizontal overflow, no console errors; "Search as typed" works |
| 1,200 CLINC150 out-of-scope utterances (knowledge questions and device commands) | 1,079 go to the web; 121 are answered by the brain, of which 70 are honest "I can't do that on your device/accounts" refusals and 1 is a small-talk remark |
| Spelling repair on 23,700 CLINC150 utterances | 51 changed: 37 corrections, 14 shorthand expansions, none harmful |
| The web benchmark's 39 questions, routed through the brain | 38 go to the web unchanged; 1 ("Is Pluto a planet?") is answered from the hand-written fact base |
| Cold start | 60 to 75 ms to load the engine, 150 to 180 ms for the first chat reply (loads the data), 65 to 75 ms for the first common-sense reply |
| Later replies | about 0.5 ms on average on the server; a spelling check takes about 0.02 ms |
| Memory | 115 to 120 MB resident with all data loaded (about 50 MB before the brain); 24 MB of that is JavaScript heap |

These are routing and behaviour checks written by the author of the code, on phrasings the author chose
plus one public dataset. They show the brain does what it was built to do; they are not an independent
measure of how natural it feels to real users.

## Known limits

* It answers only what was prepared. An unusual phrasing of a chat message falls through to triage,
  which may send it to the web or give a generic remark.
* English only. A few romanised Nepali and Hindi greetings are recognised; real conversation in those
  languages is not.
* Memory covers simple statements ("my name is", "i like", "my X is Y"). It does not understand stories,
  corrections like "no, I meant my brother", or anything said indirectly.
* Spelling repair is deliberately narrow. A slip in a short word ("ocen"), a slip that produces another
  real word ("minster" for "minister") and a misspelled name ("eifel tower") are not repaired, and the web
  search then sees the typo. A name that is missing from the guard list and looks like a slip of a common
  word could still be changed; the "Search as typed" link is the way out, and `spell-names.txt` the fix.
* Common sense covers common nouns. It has no knowledge of people, places, events or anything recent:
  that is the web pipeline's job.
* It does not learn from conversations. Improving it means editing the files in `tools/brain/` and
  rebuilding.
