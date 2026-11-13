# Infinity LLM chat: the pure neural mode

INFINI AI now has two separate chats.

| | **Internet AI** (`/`) | **Infinity LLM** (`/llm.html`) |
|---|---|---|
| Who writes the reply | The rule-based brain, the web pipeline, and Infinity LLM where its reply passes a check | Infinity LLM only |
| Web search and page reading | Yes, with citations | None |
| Prepared replies and rules | Yes | None |
| Reply check, fallback | Yes | None: the reply is shown as generated |
| Endpoint | `POST /api/ask` | `POST /api/llm/chat` |
| Client | `public/index.html`, `app.js` | `public/llm.html`, `llm.js`, `llm.css` |

The Internet mode was not changed by this work, apart from the switch and the sidebar link that lead to the new mode.
No training code was touched and no training was run: the mode serves the published model `m0002` in `model/current`.

## 1. Using it

* On the main chat, the switch **Internet AI | Infinity LLM** in the top bar opens the new mode. The sidebar has a
  second link, "Infinity LLM chat". On the new page the same switch leads back.
* The page has its own colour (violet), a "Neural only" banner with the model version and size, and a line under every
  reply: tokens generated, speed, how many earlier turns the model was given, and the variety setting.
* **Variety** is the sampling temperature, 0 to 1.2. At 0 the model always takes its most likely next token, so the
  same conversation gives the same reply. Higher values make it draw from more of its distribution.
* **Generate again** asks the model again for the last message. **Stop** ends generation; what was generated so far
  stays, marked as stopped. **New chat** clears the conversation and so the context.
* The conversation is kept in the browser tab (`sessionStorage`) until the tab is closed or New chat is pressed.
  Nothing is stored on the server.
* Phone layout: one column, the switch always visible, 16 px input (no zoom on focus), 40 px send button, safe-area
  padding for the notch and the home bar, height tied to the visible viewport. Checked in headless Chromium at
  320, 360 and 390 px wide, light and dark: no horizontal overflow and no script errors.

## 2. How a reply is produced

1. The page sends `{message, history, temperature}` to `POST /api/llm/chat`. `history` is the earlier turns of this
   chat as `[user, reply]` pairs, each reply exactly as the model generated it. Turns that failed or were stopped
   before any text are not sent.
2. `llmChat` in `server/app.js` checks the request and calls `neural.chat`. It calls nothing else.
3. `chat()` in `engine/neural/generate.js` encodes the conversation with the project's tokenizer as
   `<|user|> … <|assistant|> … <|end|>` per earlier turn, then `<|user|> message <|assistant|>`. It takes as many of
   the latest turns as fit the context window and drops the rest, oldest first.
4. The Transformer (`engine/neural/model.js`) runs on those tokens and returns a score for every token in the
   vocabulary. One token is drawn from the 40 most likely (nucleus 0.92, repetition penalty 1.08), appended, and the
   network runs again. This repeats until the network emits `<|end|>` or the length limit is reached.
5. Each token is streamed to the page as it is drawn. The text is not edited, checked, completed or replaced.

There is no "I don't know" rule. If the model writes "I don't know…", that is its own continuation, for example
"what is my name?" → "I don't know your name yet. I only know what you tell me in this chat. What is it?".

## 3. API

`POST /api/llm/chat`

| Field | Meaning |
|---|---|
| `message` | Required, up to 2000 characters. |
| `history` | Optional `[[user, reply], …]`. Malformed entries are ignored. |
| `temperature` | Optional, 0 to 1.5, default 0.6. |
| `seed` | Optional integer. Fixes the random draws, so a request can be reproduced exactly. |
| `maxTokens` | Optional, 8 to 160, default 120. |

The response is one JSON object per line:

* `{type:'start', mode:'pure-llm', model:{name, version, parameters, context}, temperature, seed, maxTokens}`
* `{type:'token', text}` for each piece of text
* `{type:'answer', mode:'pure-llm', ok, text, note?, finished, model, tokens, promptTokens, contextTurns, contextWindow, ms, tokensPerSecond, meanLogProb}`
* `{type:'done'}`

`note` appears when the model did not end its reply itself (length limit, stop) or produced no text. It describes the
reply; it never replaces it. Errors: 400 for a bad request, 429 when rate limited, 503 `llm_unavailable` when no model
is loaded. A 503 carries no reply text, and nothing else answers in the model's place.

Compared with 4.0.0, the endpoint no longer withholds a reply the model was unsure of or did not finish (it used to
report `ok: false` with a `reason`). It gained `start`, `seed`, `maxTokens`, `note`, `finished` and `contextWindow`.

## 4. What the tests prove

`npm run test:pure` runs `test/pure.test.js` (7 tests) and `test/ui-pure.test.js` (2 tests). They run offline against
the real server, the published model and a second, smaller fixture model.

| Claim | How it is tested |
|---|---|
| The reply is the network's own continuation | The test file re-derives each reply from the weights with its own decoding loop (run the network, take the most likely token, repeat) and requires the endpoint's text, token count and prompt length to be identical, for 8 messages, with and without history. Sampled replies with a fixed seed must equal the bare model runtime with that seed. |
| Nothing else runs | Counters wrap the engine's `ask`, every function of the rule-based brain, the web transport and DNS lookup. All four stay at 0 through every pure-mode request. A trap on `net.Socket.connect` records every TCP connection of the process: none leaves the machine. |
| The counters work | The same counters do go up when the Internet mode answers in the same test. |
| The weights decide | The same messages sent to a different network give different replies in 5 of 5 cases. A table of prepared replies would not change with the weights. |
| Sampling is real | At variety 0 the reply does not depend on the seed. At 1.2, 8 seeds must give at least 4 different replies, and one seed must give the same reply twice. |
| No filter, no fallback | With the Internet mode's thresholds set so that it would reject every generated reply, pure mode still delivers the text unchanged. A reply cut at 8 tokens is delivered as 8 tokens with a note. With no model: 503, no text, engine and brain not called. |
| Context is model input | Prompt length grows by exactly the tokens of the earlier turns; the reply equals the continuation of the whole conversation; 40 long turns are cut to the latest that fit; prompt plus reply never exceed the window. |
| The modes are separate | "what is 17 times 23": the Internet mode answers 391 through its calculator; pure mode returns the network's text, which does not contain 391, and the engine counter does not move. "What is the capital of Nepal?": the Internet mode fetches pages and cites them; pure mode fetches nothing. |
| The code path is narrow | The handler's source contains no reference to the engine, the brain or `fetch`. The three modules that generate text import only `node:fs`, `node:path`, `node:crypto` and each other. `public/llm.js` contains two API paths: `/api/llm/chat` and `/api/llm/status`. |
| The page shows what was generated | Through a fake DOM against the real server: the text on the page equals the text the endpoint sent; the second request carries the first turn as history; a failed request shows a notice, not a reply, and is left out of the context; New chat empties the context; the page never calls `/api/ask`. |

As a check on the tests themselves, the handler was temporarily changed to take the engine's answer for one message.
Five of the seven tests failed. The change was then removed.

Test results on this commit: `npm test` 93 passed, 0 failed (84 from before, 9 new). The PyTorch tests
(`npm run test:llm`) were not rerun because no training code changed.

## 5. What the model actually does (measured)

Published model `m0002`: 4 layers, width 128, 4 heads, 1,344,640 parameters, vocabulary 4096, context 256 tokens.
About 570 tokens per second on this machine's CPU, so a reply takes well under a second.

Replies at variety 0, new chat each time (reproducible: the page with Variety at 0, or the API with `"temperature": 0`):

| Message | Reply | Fits? |
|---|---|---|
| my name is Sam | Pleased to meet you, Sam. Ask me anything, or just chat. | yes |
| you are awesome | I'm glad. Being good company is exactly what I'm trying to be. | yes |
| what is the meaning of life | That one is beyond my brain, and I suspect beyond any database. … | yes |
| good night | Good evening! What can I do for you? | no (wrong greeting) |
| good morning | Good evening! What can I do for you? | no |
| hello | Good to hear I got it. | no |
| how are you? | I'm not sure what to repeat. Pick one: a joke, a riddle, a fun fact, or a fresh question. | no |
| thank you | Would you rather have a phone again or never watch a film again? | no |
| who are you? | I'm not perfect. I can't create original writing, … | no |
| tell me a joke | What is it? Tell me! | no |
| i feel sad | I don't have a face, so I'll take that as a note about my design. Noted! | no |
| bye | That's not me, but hello! I'm INFINI AI. Gambia and I have never met. | no |
| what is the capital of Nepal | I'm not perfect. I can't create original writing, … | no |
| what is 17 times 23 | A decade is 10 years, a century is 100 years and a millennium is 1,000 years. … | no |
| what is photosynthesis | I don't know your name yet. I only know what you tell me in this chat. What is it? | no |
| write a poem about the sea | There are seven continents: Asia, Africa, … | no |

Of the 20 messages tried, 3 got a reply that fits. The model's own evaluation on held-out phrasings gives a similar
picture: about 1 reply in 5 passes the reply check (`docs/INFINITY-LLM.md`, section 12).

A conversation at variety 0:

| Message | Reply | Earlier turns used |
|---|---|---|
| hi | Really. What part surprised you? | 0 |
| my name is Sam | Nice to meet you, Sam! I'll remember your name for this conversation. What can I do for you? | 1 |
| what is my name? | I don't know your name yet. I only know what you tell me in this chat. What is it? | 2 |
| i like football | That's great to hear! What's making it good? | 3 |
| what do i like? | I don't have a place the way you do. My code runs on servers in the cloud, … | 4 |
| thanks | I'm listening. Go on. | 3 of 5 |

The context reaches the model and changes its replies, but the model does not use it to recall anything.

## 6. Limits

* **Most replies do not fit the message.** The sentences are fluent and end cleanly, but the model usually picks a
  reply that belongs to a different message. It is equally confident when it is wrong.
* **It has no usable knowledge.** No facts, no arithmetic, no writing on request. It was trained on about 3.5 million
  characters of text for about 40 minutes on two CPU cores.
* **It does not use the conversation to remember.** It was told the name and still says it does not know it. In one
  sampled run it greeted "Sam" as "Luca".
* **It repeats sentences it was trained on.** Its conversation data was written by the Internet mode's rule-based
  brain. So although no prepared reply is looked up when it answers, much of what it writes is one of those sentences
  reproduced from its weights, including "I'm INFINI AI" and offers to "look it up", which this mode cannot do.
* **"I don't know" is not reliable.** It can write such a sentence, but it does not write one when it should, and it
  never knows whether what it wrote is right.
* **Short memory.** The window is 256 tokens, of which up to 120 are kept free for the reply. In practice the model
  sees the last three to six short turns.
* **No safety layer in this mode.** Nothing reviews the text. The model's vocabulary and training text make harmful
  output unlikely, but nothing enforces it.
* **Not verified on the deployed site from here.** The build sandbox cannot reach the public URL, so the checks above
  were run against the same code on a local server.

Making the replies better is a training matter (more data, a larger model, longer training). It was deliberately left
out of this work.
