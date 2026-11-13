# Infinity LLM — architecture

Infinity LLM is a neural language model that belongs to this project. Its weights start as random numbers and are
changed only by this project's own training code. No pretrained model, no outside model API and no borrowed weights
are used anywhere, in training or in answering.

This document describes what existed before, what was changed, what was kept, how the parts connect, and what the
system can and cannot do. Section 12 holds the measured results of the model that is in the repository; it is
written from the training system's own records.

## 1. What existed before (version 3.1.0)

| Part | What it was |
|---|---|
| Chat and reasoning | **No neural network.** `engine/brain/` matched a message against 52,938 stored phrasings and returned one of about 900 prepared replies, a common-sense fact, or the result of an exact skill (sums, dates, units). |
| Knowledge | `engine/` web pipeline: analyse the question, plan searches, query providers, fetch and parse pages, rank passages, detect agreement and contradiction, and assemble a cited answer from sentences found in the sources. Rules and statistics only. |
| Web access | One guarded HTTP client (`engine/net/http.js`): robots.txt, per-host rate budgets, SSRF guard, size and time limits. |
| Server | `server/app.js` (HTTP API, NDJSON streaming, rate limits, strict CSP), `api/index.js` (the same app as a serverless function). |
| Client | `public/`: a dependency-free chat interface, conversations stored in the browser. |
| Tests | 68 offline tests (`npm test`). |
| Training, checkpoints, datasets, model versions, evaluation of a model, deployment of a model | **None existed.** There was no model. |

The earlier documents said "no language model" and the assistant said so about itself. That was true then. It is no
longer true, so those statements were changed (section 10).

## 2. What changed, and what was kept

Kept and still in use, unchanged in behaviour when no model is loaded:

* the whole web pipeline, its providers, its evidence and confidence logic and its citations;
* the rule-based brain: memory within a chat, common sense, exact skills, safety replies, spelling repair, routing;
* the HTTP API, the streaming protocol, the interface, the rate limits and the security headers;
* zero npm dependencies for the app.

New:

| Layer | Where | What it does |
|---|---|---|
| Infinity LLM Core | `llm/` (Python, PyTorch) | The Transformer, training, checkpointing, evaluation, export, hardware detection. |
| Inference engine | `engine/neural/` (JavaScript, no dependencies) | Tokenizer, the same forward pass as the PyTorch model, sampling, chat / grounded / routing decoders. Runs inside the Node server, including on serverless hosts. |
| Learning system | `learning/` (JavaScript, no dependencies) | Finding documents, licence check, cleaning, quality filter, verification, dataset versions, the training cycle, behaviour evaluation, the promotion gate, the model registry, rollback, scheduling. |
| Integration | `server/app.js`, `engine/neural/service.js`, `learning/manager.mjs` | The model writes chat replies and chooses the lead sentences of web answers; three `/api/llm/*` routes; the learning process is started, watched and stopped from the server. |
| Interface | `public/app.js`, `public/learning.*` | Replies appear token by token; the learning dashboard; protected controls. |

Why two languages: training needs automatic differentiation and optimised tensor code, which PyTorch provides and
which would be slow and error-prone to rewrite. Answering needs to run wherever the app runs, including a serverless
function with no Python and no GPU. So the model is trained in PyTorch, exported as a flat file of numbers, and run by
about 300 lines of JavaScript that compute the same function. Every export carries reference outputs from PyTorch, and
the JavaScript engine must reproduce them before a model is allowed to answer (section 7).

## 3. How the parts connect

```
                                  ┌──────────────────────── learning process (own OS process, low priority) ───────────────────────┐
 open web / open repositories ──▶ │ acquire ─▶ licence ─▶ clean ─▶ quality ─▶ dedupe ─▶ verify ─▶ corpus (documents + provenance)  │
   (same guarded HTTP client      │                                                                  │                             │
    and providers as answering)   │  rule-based brain as teacher ─▶ conversations ───────────────────┤                             │
                                  │                                                                  ▼                             │
                                  │                                      dataset version dNNNN (train / validation, token shards)  │
                                  │                                                                  │                             │
                                  │                           llm/train.py: continue from the production checkpoint ─▶ candidate   │
                                  │                                                                  │                             │
                                  │                 llm/export.py ─▶ weights.bin + model.json ─▶ evaluation in the JS engine       │
                                  │                                                                  │                             │
                                  │                                     promotion gate ── fail ─▶ rejected (production untouched)  │
                                  │                                                  └── pass ─▶ registry: production = candidate  │
                                  └──────────────────────────────────────────────────────────────────┬─────────────────────────────┘
                                                                                                     │ registry file changes
                                                                                                     ▼
 message ─▶ server/app.js ─▶ engine.ask ─▶ brain ──▶ chat reply (rules) ──▶ neural service ─▶ Infinity LLM writes the reply
                                             │                                                (shown only if it agrees with the rules' reply)
                                             └─▶ web pipeline ─▶ cited answer ─▶ neural service ─▶ Infinity LLM chooses the lead
                                                                                                   sentences among the retrieved evidence
```

The chat server and the learning process share only files on disk. The server never trains. The learning process
never answers a user. A model reaches users only through the registry, and the registry is changed only by the gate
or by an administrator's rollback.

## 4. Infinity LLM Core (`llm/`)

**Architecture** (`llm/model.py`): a decoder-only autoregressive Transformer.

```
tokens ─▶ token embedding + learned positional embedding
       ─▶ N × [ RMSNorm ─▶ causal multi-head self-attention ─▶ + residual
                RMSNorm ─▶ feed-forward (linear, GELU, linear) ─▶ + residual ]
       ─▶ RMSNorm ─▶ projection onto the vocabulary (weights shared with the token embedding)
```

* Token embeddings, positional embeddings, multi-head self-attention, a causal mask (a position cannot see later
  positions), feed-forward layers, normalisation (RMSNorm, or LayerNorm by configuration) and residual connections
  are all implemented in the file and all are trained.
* Training objective: next-token prediction with cross-entropy loss, backpropagation, AdamW with weight decay on the
  matrices only, linear warm-up then cosine decay of the learning rate, gradient clipping at 1.0, gradient
  accumulation, and mixed precision when the device supports it (CUDA: bf16 or fp16 autocast; CPU: bf16 only where the processor has
  bf16 instructions, otherwise fp32).
* Generation: one token at a time, each sampled from the model's distribution given everything before it
  (temperature, top-k, top-p, repetition penalty), with cached keys and values so each new token costs one position.
* Initialisation: normal distribution with standard deviation 0.02 from a recorded seed; residual output projections
  scaled by depth. `llm/tests/test_core.py` checks that an untrained model's loss equals that of a uniform guess over
  the vocabulary, which is what "knows nothing" means.

**Sizes.** All sizes are configuration, not code. Presets:

| Preset | Layers | Heads | Width | Context | Parameters (vocabulary 4,096) |
|---|---|---|---|---|---|
| nano | 2 | 2 | 64 | 128 | 368,960 |
| micro | 4 | 4 | 128 | 256 | 1,344,640 |
| mini | 4 | 4 | 192 | 256 | 2,606,784 |
| small | 6 | 6 | 288 | 384 | about 7.3 million |
| base | 8 | 8 | 512 | 512 | about 27.6 million |
| large | 12 | 12 | 768 | 1,024 | about 88.9 million |

`llm/hw.py` detects the processor, memory and any CUDA or Apple-Silicon GPU, times a few training steps of each preset
that fits, and recommends the largest one that trains at a useful rate. The first three parameter counts above were
measured; the last three are computed from the configuration and have not been trained here.

**Tokenizer** (`engine/neural/tokenizer.js`): byte-level byte-pair encoding, trained by this project on its own
training text. Ids 0–7 are control tokens (`<|end|>`, `<|user|>`, `<|assistant|>`, `<|search|>`, `<|evidence|>`,
`<|doc|>`, padding, one reserved), 8–263 are the 256 byte values, and merges follow. Any text can be encoded; nothing
is "unknown". The tokenizer is trained once, with the first dataset, and then frozen: a checkpoint is tied to its
tokenizer by hash and training refuses to mix them.

**Checkpoints** (`llm/train.py`): `ckpt.pt` holds the weights, the optimiser state, the step count, tokens seen,
training seconds, the model configuration, the tokenizer hash and the history of cycles. It is written atomically
(temporary file, then rename) at intervals, at the end, and when the process receives SIGTERM or finds a `stop` file.
A later run continues from it with the optimiser state restored.

**Metrics**: every logged step appends one line to `metrics.jsonl`: step, training loss, learning rate, tokens seen,
tokens per second, elapsed seconds, memory, and validation loss when it was measured. The dashboard's chart is drawn
from these lines.

## 5. Sequence formats: how one model does three jobs

Every training sequence ends in `<|end|>`.

```
conversation   <|user|> hello <|assistant|> Hello! What's on your mind? <|end|>          (earlier turns may precede)
grounded       <|user|> question <|search|> <|evidence|> s1 <|evidence|> s2 … <|assistant|> the sentence that answers <|end|>
prose          <|doc|> Title ⏎ running text <|end|>
```

* **Chat.** After `<|user|> …` the server appends `<|assistant|>` and the model generates the reply.
* **Routing.** After `<|user|> …` the model's own probabilities for `<|assistant|>` versus `<|search|>` say whether it
  would reply or look the thing up. This is measured and reported; the rule-based router still makes the decision.
* **Grounded answering.** The retrieved sentences are placed after `<|evidence|>` markers. The decoder is
  *constrained*: at each step only tokens that continue one of the evidence sentences are allowed. The model therefore
  chooses which sentences answer the question, by its own probabilities, but it cannot write a factual sentence that
  is not in a retrieved source. Each chosen sentence keeps its citation.

That constraint is the reason a model this small can be used on factual questions at all. Free generation of facts by
a model of a few million parameters would be wrong most of the time, and the interface would give no way to tell.

## 6. Learning system (`learning/`)

One **cycle** (`learning/cycle.mjs`) runs these phases in order. Its progress is saved after each phase, so a cycle
that is interrupted resumes where it stopped.

1. **Acquire** (`sources.mjs`, `corpus.mjs`). Sources are configured, each with a type:
   * `web`: topics are sent to the app's own search providers and the result pages are fetched with the app's own
     guarded HTTP client, so robots.txt, rate budgets and size limits apply exactly as they do when answering;
   * `github`: an openly licensed repository is read through the GitHub API (currently the World Factbook country
     profiles, public domain, and the OpenStax *Physics* textbook, CC BY 4.0).
2. **Licence** (`licence.mjs`). A document is kept only when a licence on the allow-list is found: CC0, public-domain
   mark, CC BY, CC BY-SA, MIT, Apache-2.0, BSD-3-Clause, US-government public domain. No licence found means not
   permitted. Non-commercial and no-derivatives licences are refused. A page or header that opts out of AI training or
   text mining (`noai`, `noimageai`, TDM-Reservation) is refused whatever its licence.
3. **Clean and filter** (`process.mjs`). Markup, navigation and boilerplate are removed by the app's extractor. A
   document is rejected, with the reason recorded, when it is too short, not English, mostly links or lists, repetitive,
   keyword-stuffed, or below the quality score.
4. **Deduplicate**. Exact copies by SHA-256 of the normalised text; near copies by 64-bit SimHash over word 4-grams.
5. **Verify** (`verify.mjs`). Sentences that carry a number or a year are compared across documents from *different*
   publishers. Agreement between independent origins raises a document's score; a contradiction lowers it and the
   disputed sentences are listed and left out of training. A single unknown website that nothing independent supports
   is held back. The result is a score from 0 to 1 and a status (`corroborated`, `single-source`, `disputed`), stored
   with the document. Uncertainty is recorded, not resolved by guessing.
6. **Dataset** (`dataset.mjs`). A new immutable version `dNNNN` is built: token shards, a manifest, and probe sets for
   evaluation. Each document goes to training or validation by a hash of its content, so the same document is always
   on the same side; the manifest records a check that no validation document, hash or phrasing appears in training.
   The mixture is configurable: conversation data, newly collected documents, and replay of earlier documents.
7. **Train** (`llm/train.py`, run as a child process with a time budget, a thread limit, lowered priority and a memory
   limit). The first cycle starts from random weights. Every later cycle **continues from the production checkpoint**
   with a lower learning rate, a pull towards the starting weights, and replay of earlier data, so that learning new
   material does not erase old material. It never starts again from zero.
8. **Export** (`llm/export.py`): `weights.bin` (16-bit floats by default) and `model.json` with the configuration,
   hashes and reference outputs.
9. **Evaluate** (`llm/evaluate.py`, `evalsuite.mjs`): section 7.
10. **Gate and registry** (`registry.mjs`): section 8.

Every accepted document has a record: URL, publisher, licence and how it was established, collection time, SHA-256,
quality score, verification status and score, and which side of the split it is on. Every rejected document has a
record with the stage and the reason.

**Scheduling** (`manager.mjs`). The server starts the learning process on a schedule when `cycle.auto` is on, or when
an administrator asks. Only one cycle can run (a lock file with a heartbeat). A cycle that finds fewer new documents
than `minNewDocs` ends as `no-new-data` and trains nothing. Pause is a file the cycle checks between phases and the
trainer checks between steps.

## 7. Evaluation

Two kinds, both on held-out material only:

* **Loss** (PyTorch): validation loss overall and separately for conversation data and web text.
* **Behaviour** (the JavaScript engine that will actually serve):
  * *parity*: the exported weights must reproduce PyTorch's reference outputs within tolerance;
  * *reply match*: for validation phrasings never seen in training, word-overlap F1 and exact match between the
    model's reply and the expected replies;
  * *evidence choice*: given a question and several sentences, how often the model picks the sentence that answers
    it, reported next to the chance rate;
  * *search decision*: how often the model's `<|assistant|>` / `<|search|>` preference is right;
  * *looping*: the share of sampled replies that repeat themselves or never end;
  * inference speed in tokens per second.

What these numbers are: measurements of specific abilities on specific held-out sets built from this project's own
data. What they are not: a general intelligence score, or evidence about questions unlike the training data.

## 8. Promotion gate, versions and rollback

The gate (`promotionGate` in `evalsuite.mjs`) compares the candidate with the production model **on the same new
validation set**. All checks must pass:

* the exported weights reproduce the training framework;
* validation loss is not worse than production's;
* loss on conversation data has not risen by more than the allowed amount (earlier knowledge kept);
* reply match, evidence choice and search decision have not fallen by more than the allowed amount;
* sampled replies do not loop.

For the very first model there is nothing to compare with, so absolute floors apply instead: loss well below a uniform
guess, and each behaviour measure above its floor and above chance.

If any check fails the candidate is marked `rejected`, its numbers and the reasons are kept, and **production does
not change**. If all pass, the candidate becomes `production` and the model it replaced becomes `previous stable`.

The registry (`registry.json`) records for every model: id, parent, dataset version, cycle, configuration, parameter
count, steps, tokens seen, training seconds, SHA-256 of the weights, tokenizer hash, validation losses, behaviour
measures, the gate result, and timestamps. It also holds the history of promotions, rejections and rollbacks.

**Rollback** makes the previous stable model (or a named earlier one) production again, in one registry write. The
running server notices the change within two seconds and loads that model; no restart is needed.

**Publishing** (`node learning/cli.mjs publish`) copies the production model and a snapshot of the learning records
into `model/` in the repository, which is what a host without a disk (a serverless function) serves.

## 9. Serving (`engine/neural/service.js`)

* The server looks for a production model in the live state directory first, then in the published copy in `model/`.
* A model is loaded only if its self-test passes (parity with the reference outputs). Otherwise the app runs exactly
  as version 3.1.0 did, and `/api/status` says why.
* **Chat messages**: the rule-based brain still classifies the message first and produces its reply. If the message
  is conversation, Infinity LLM generates its own reply token by token. That reply is then **checked before anyone
  sees it**:
  1. it must be complete, must not loop, and the model's own mean log-probability for it must be above a threshold;
  2. it must say what a correct reply to this message says: its word-overlap F1 with at least one of the rule-based
     wordings for the same message must reach 0.6 (`INFINI_LLM_MIN_AGREEMENT`).

  Up to three samples are tried. If one passes, it is sent to the browser and labelled as written by the model, with
  the agreement figure. If none passes, the rule-based reply is shown and the label says so and why. Nothing of a
  rejected reply is sent.

  The second check exists because of a measured weakness, not as decoration: a model of this size often writes a
  fluent, confident reply to the wrong message (for example, answering "hello" with "Thank you!"), and its own
  confidence does not reveal that. The check makes the rule-based system the judge of whether the model understood
  the message. The consequence, stated plainly: **in conversation the model never says anything the rules would not
  have said**; what it contributes is the wording, generated from its weights. The share of generated replies that
  pass the check is counted and shown on the learning page ("replies accepted"), and it is the honest measure of how
  much of the conversation the model is really carrying.
* **Questions about the assistant itself** are always answered from records, not generated, so that the version and
  parameter count it states are exact.
* **Memory, common sense, exact skills and safety replies** stay with the rules. A language model of this size cannot
  be trusted to add numbers or recall what the user said.
* **Web answers**: after the pipeline has built its cited answer, the model chooses up to two lead sentences among the
  retrieved evidence (section 5). They are shown above the pipeline's answer in a marked box, with citations. The
  pipeline's answer is never removed.
* The user can switch the model off for themselves in Settings.

Resource use in the server: the weights are held once in memory (about 5 MB for `micro` as 32-bit floats); generating
a reply takes a fraction of a second on one CPU core at this size.

## 10. Honesty changes

* The assistant's statements about itself now depend on what is loaded. With a model serving, it says it has a small
  language model trained from scratch; with none, it says what it said before. Sources: `tools/brain/intents/`.
* Every reply shows where it came from: Infinity LLM (with version, parameter count, tokens and speed), the built-in
  rules, or the web with sources.
* The dashboard shows measured values read from files the training system wrote. Nothing on it is simulated. Where a
  value does not exist yet, it shows a dash.

## 11. Limits

* **Size.** The model in this repository has about 1.3 million parameters. Commercial assistants have on the order of
  a hundred thousand times more. It can hold a short conversation in the style of its training data. It does not
  reason, plan, write essays or code, or know facts by itself.
* **It often answers the wrong message, so its replies are checked.** Measured on phrasings it had not seen, the
  first published version writes a reply that passes the reply check (section 9) for roughly one message in five. For
  the other four the rule-based reply is shown. In conversation the model therefore adds no ability the rule-based
  brain lacks: where its reply is shown, it is the same content, written by the network instead of taken from a list.
  The exact share is in section 12 and on the learning page. It should rise as later versions train longer; if it
  does not, that is what the records will show.
* **Evidence choice is barely better than chance** in the first version (section 12). The cited answer built by the
  retrieval pipeline is always shown underneath, so a poor choice by the model costs a less useful opening sentence,
  never a wrong fact: every sentence it can show comes from a retrieved page.
* **What "learning" means here.** The system collects permitted text, trains on it and keeps a new version only if
  it measures better. It does not understand in a human sense, it is not conscious, and it does not improve without
  bound: a model of fixed size stops improving when it has no capacity left, and then only a larger preset on stronger
  hardware helps.
* **Training needs a real machine.** A serverless host has no persistent disk, no Python and a time limit of minutes.
  It can serve a published model. It cannot train one. Continuous learning runs wherever `node server/server.js` runs
  with Python and PyTorch installed.
* **Verification is partial.** Cross-source comparison only applies to sentences with numbers or years, and only when
  two independent documents cover the same thing. A document from a vetted source can be accepted with status
  `single-source`. The record says so.
* **Conversation data comes from the rule-based brain.** The model's conversational style is therefore bounded by
  what that brain can say. This was chosen because it is the only large body of dialogue the project owns outright.

## 12. Measured results

<!-- results:start -->
Written by `tools/llm/report.mjs` from `model/snapshot.json` (published 2026-11-13T10:22:00Z). Every figure below was recorded by
the training and evaluation code during the runs it describes.

**Machine**: 2 CPU cores, 3.85 GB memory, no GPU; PyTorch 2.15.0+cu132, device `cpu`, precision fp32.

Training speed measured on it (a few real optimiser steps per size, batch 16):

| Size | Parameters | Seconds per step | Training tokens per second |
|---|---|---|---|
| nano | 368,960 | 0.094 | 21,812 |
| micro | 1,344,640 | 0.39 | 10,504 |
| mini | 2,606,784 | 0.536 | 7,638 |

Size chosen: `micro`.

**Production model: m0002**

| | |
|---|---|
| Architecture | decoder-only Transformer, 4 layers, 4 heads, width 128, context 256 tokens, vocabulary 4,096 |
| Parameters | 1,344,640 |
| Initialisation | continued from m0001 |
| Built from | m0001 (continued training) |
| Optimiser steps | 2,908 |
| Tokens trained on (with repetition) | 23,822,336 |
| Training time | 39.9 min |
| Weights file | 2.56 MB, SHA-256 `2d6d9516c8edf8e3…` |
| Validation loss | 2.131 (perplexity 8.4; a uniform guess over the vocabulary would be 8.32) |
| Validation loss, conversation data | 1.040 |
| Validation loss, document text | 3.143 |
| Reply match on unseen phrasings | F1 43.4%, exact 18.8% |
| Generated replies that pass the reply check (single attempt, unseen phrasings) | 20.6%; the others are replaced by the rule-based reply |
| Evidence choice | 50.0% (chance 36.7%) |
| Search decision | 96.7% |
| Looping replies | 0.0% |
| JavaScript engine versus PyTorch | reproduces the reference outputs |
| Inference speed (JavaScript, one core) | 239 tokens per second |

**All model versions**

| Version | Status | Built from | Trained on | Steps | Validation loss (measured on) | Reply F1 | Passes reply check | Evidence | Search | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| m0001 | previous | random weights | d0001 | 2,423 | 1.126 (d0001) | 41.7% | 20.0% | 45.8% | 97.5% | passed |
| m0002 | production | m0001 | d0002 | 2,908 | 2.131 (d0002) | 43.4% | 20.6% | 50.0% | 96.7% | passed |

Validation loss depends on the validation set, and each dataset version has its own (later ones hold more document text,
which is harder to predict than conversation). Figures measured on different datasets must not be compared. The gate
never does: in each cycle it measures the candidate and the current model on the same new validation set, and those
two figures are in the gate checks below.

**Learning cycles**

| Cycle | Outcome | Documents collected / accepted / rejected | Dataset | Training tokens in dataset | Training time | What happened |
|---|---|---|---|---|---|---|
| c0001 | promoted | 100 / 98 / 2 | d0001 | 2,404,368 | 33.4 min | m0001 is the first production model (held-out loss 1.1256) |
| c0002 | promoted | 100 / 91 / 9 | d0002 | 3,524,468 | 6.6 min | m0002 replaced m0001 (held-out loss 2.131 vs 2.3502) |

Gate checks of cycle c0001 (candidate m0001, first model: absolute floors):

* passed: exported weights reproduce the training framework (largest difference 0.000003)
* passed: validation loss is a number (1.1256)
* passed: learned something (loss well below a uniform guess) (1.1256 vs 0.6 × ln(4096) = 4.99)
* passed: replies resemble the expected ones (0.4171 (floor 0.15))
* passed: chooses the right evidence more often than chance (0.4583 (chance 0.3813, floor 0.4))
* passed: search decision is better than guessing (0.975 (floor 0.7))
* passed: sampled replies do not loop (0 (limit 0.35))

Gate checks of cycle c0002 (candidate m0002, compared with m0001):

* passed: exported weights reproduce the training framework (largest difference 0.000003)
* passed: validation loss is a number (2.131)
* passed: held-out loss is not worse than production (2.131 vs 2.3502 (allowed +0))
* passed: earlier knowledge kept (conversation data) (1.0404 vs 1.0366 (allowed +0.05))
* passed: reply match did not fall (0.434 vs 0.4257 (allowed −0.04))
* passed: evidence choice did not fall (0.5 vs 0.4583 (allowed −0.04))
* passed: search decision did not fall (0.9667 vs 0.9417 (allowed −0.04))
* passed: sampled replies do not loop (0 (limit 0.35))

**Training data**

* 189 documents accepted (176 for training, 13 held out), 3,478,980 characters; 11 rejected (format 7, language 4).
* By licence: CC0-1.0 110, CC-BY-4.0 79. By source: factbook 110, openstax-physics 79.
* Verification: single-source 189; mean score 0.74; 0 disputed statements left out.
* Latest dataset d0002: 3,524,468 training tokens, 222,170 validation tokens; validation documents, hashes or phrasings found in training: 0.

**Promotions, rejections and rollbacks**

* 2026-11-13T10:04:51Z: m0001 promoted (gate: first model; passed all 7 checks)
* 2026-11-13T10:18:23Z: m0002 promoted, replacing m0001 (gate: passed all 8 checks against m0001)
<!-- results:end -->
