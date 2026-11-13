# The always-on learning worker

Infinity LLM learns in a separate, long-running process: `learning/worker.mjs`. Nobody has to open a page or press a
button. The worker keeps finding and checking new text, starts a training cycle by itself when enough of it has
arrived, lets the gate decide about every candidate, publishes an approved model to the machines that serve the chat,
and goes back to finding text. A crash, a kill or a reboot does not end this: everything the worker knows is on disk,
and the next worker process continues at the phase where the last one stopped.

This file describes what was built, where it runs, and what was measured. Section 9 lists the measurements;
section 10 lists what is not solved.

Contents: 1 [What runs where](#1-what-runs-where) · 2 [The loop](#2-the-loop) · 3 [Failure and recovery](#3-failure-and-recovery) ·
4 [The fixed benchmark](#4-the-fixed-benchmark) · 5 [The promotion gate](#5-the-promotion-gate) ·
6 [Training caution](#6-training-caution) · 7 [Publishing: the model channel](#7-publishing-the-model-channel) ·
8 [Running it](#8-running-it) · 9 [Measured](#9-measured) · 10 [Limits](#10-limits) · 11 [Files](#11-files)

## 1. What runs where

| Part | What it is | Needs |
|---|---|---|
| **Worker** (`node learning/worker.mjs`) | One permanent process. Discovers, verifies, trains, evaluates, promotes, publishes. | Node 20+, Python with PyTorch, a disk that keeps its files (or a place to store an archive of them), outbound internet |
| **Server** (`server/server.js`, or the Vercel function) | Answers the chat and shows the dashboard. Never trains. | Node 20+. No Python, no writable disk |
| **Model channel** | The place where the worker puts an approved model and its records: a directory, or the assets of a GitHub release | — |

Vercel cannot run the worker: a serverless function lives for seconds, has no disk and no Python. Vercel runs the
server only. The server reads the channel (section 7), so a model the worker approves reaches the site without a
redeploy.

Three ways to run the worker are in the repository:

1. **A machine that stays on** (a VPS, a home server, Fly.io, Railway, any container host with a volume):
   `Dockerfile.worker`, `docker-compose.yml`, `deploy/infinity-worker.service` (systemd), `deploy/fly.worker.toml`.
   This is the intended home: one process, one disk, restarted by the host when it dies.
2. **GitHub Actions** (`.github/workflows/infinity-learning.yml`): a hosted runner lives for at most six hours, so the
   worker runs as a chain of sessions. Each session restores the state from the release `infinity-state`, runs the
   worker for up to five hours, stores the state again, and starts the next session. Costs nothing on a public
   repository and needs no secret beyond the token GitHub provides. Section 10 says what this arrangement cannot promise.
3. **By hand**, for development: `node learning/worker.mjs` in a checkout with `.venv/bin/python`.

## 2. The loop

```
start     take the supervisor lock (a second worker on the same state refuses to start, exit code 3)
          clear what a dead worker left behind: stale lock, a step or a trainer still running, an unfinished cycle
          empty state? start it from the model published in model/ (weights turned back into a training checkpoint)
          check the production model's health · publish
loop      paused?                         wait
          backing off after a failure?    wait
          unfinished cycle?               continue it at the phase where it stopped
          no production model?            collect data and train the first one
          enough new verified documents?  train a candidate on them          (60, or 5 after 45 minutes)
          otherwise                       discover: read the sources, filter, verify, keep or reject
after     failure → wait 15 s, 30 s, 60 s … at most 15 min, then try again
each      health check of the production model (automatic rollback) · remove old large files
step      publish the model if it changed, and the records · store the state archive (hosts without a disk)
stop      SIGTERM / SIGINT / end of a session: the trainer writes its checkpoint, the cycle stays resumable,
          the final state is published and stored
```

Every step runs in a child process (`node learning/cli.mjs discover | cycle`), so an error or an out-of-memory kill in
a step cannot take the worker down. The worker itself uses about 80–140 MB.

**Discovery** (`discover` in `learning/cycle.mjs`) is the first half of a learning cycle on its own: collect up to 40
documents per round from the configured sources, check the licence, the language and the text quality, remove
duplicates and near-duplicates, compare checkable statements across independent publishers, and store each document
with its source, licence, hash and verification record — or reject it with the reason. Documents that passed wait in
the corpus until a cycle trains on them. Nothing is trained on without having passed these checks, and nothing is
trained on twice as "new": after a cycle the documents become replay material.

**Sources.** `factbook` (CC0) and `openstax-physics` (CC BY 4.0) from public GitHub repositories; `simplewiki`,
`wikibooks`, `wikivoyage` through the MediaWiki API (random articles, stubs skipped, CC BY-SA); and `web` (search by
topic, a document is kept only if its page declares an allow-listed licence). Each source has a per-round limit so that
no single one dominates. The licence allow-list and the opt-out rules of `docs/INFINITY-LLM.md` section 6 apply unchanged.

**A training cycle** is the one described in `docs/INFINITY-LLM.md`: dataset → train → export → evaluate → gate →
promote or reject. New in this version: the dataset builder removes benchmark sentences and refuses to hand over a
dataset in which it finds benchmark or validation material; the evaluation runs the fixed benchmark and a memorisation
probe on the candidate and on production; the gate has more checks (section 5); the amount of training adapts
(section 6).

**Controls stay.** Pause, resume, rollback and "start a cycle now" on the dashboard still work. When a worker is
alive, the server does not start a second trainer next to it; "start a cycle now" is handed to the worker, which takes
it as its next step.

## 3. Failure and recovery

| What happens | What the worker does |
|---|---|
| A step exits with an error, or is killed (for example by the kernel for memory) | Counts the failure, waits (15 s, doubled each time, at most 15 min), tries again. An interrupted cycle is continued, not restarted. |
| A step reports nothing for 30 minutes | Kills it and treats it as a failed step. |
| A source is unreachable | The round continues with the other sources; the error is recorded per source. |
| Training is impossible (no Python, not enough free memory) | Keeps discovering; tries training again after 30 minutes (5 minutes for memory). |
| The worker receives SIGTERM or SIGINT, or its session time ends | Asks the step to stop (the trainer writes a checkpoint), kills it after 45 s if it does not, publishes, stores the state, records a clean stop. |
| The worker is killed without warning (power cut, `kill -9`, host reboot) | The next worker sees that the last one never said goodbye. It stops a step or a trainer that is still running, removes the stale lock, and continues the unfinished cycle. Training resumes from the last checkpoint (written every 50 steps). |
| The production model's files are damaged, or it fails its self-test | Rolls back to the previous stable model at once, publishes the rollback, records the reason. The damaged model is marked `unhealthy` and is not offered as a rollback target. |
| Publishing fails | Recorded as an error; tried again after the next step. The model in production does not depend on it. |
| The disk fills with old versions | After each step, weights and checkpoints of old versions are removed. Production, the previous stable model and the six newest versions keep their files; every version keeps its card and evaluation. |

The worker writes `worker.json` every 10 seconds: heartbeat, what it is doing, uptime, starts, recoveries, failed
steps, the last 20 errors, memory and disk. The dashboard reads it; a worker whose heartbeat is older than three
minutes is shown as not alive. `node learning/cli.mjs alive` gives the same answer as an exit code (the container's
health check).

## 4. The fixed benchmark

`learning/benchmark/v1.json` — `infinity-bench-1` — is the same for every model version, so results can be compared
across versions. (The held-out data of a cycle cannot be: each cycle has its own.)

- **176 items in four parts.** Language (48), knowledge (48), reasoning (48): each item is a pair of sentences that
  differ in one point, one right and one wrong; the model passes if it gives the right one the higher probability.
  Conversation (32): a message with a fitting and an unfitting reply. Guessing scores 50% on every part. The score is
  the mean of the four parts.
- **16 passages** of ordinary prose (918 tokens with the current tokenizer): the loss on them says how well the model
  reads text it has never seen.
- **Never trained on.** The dataset builder drops every benchmark sentence from documents (compared without case and
  punctuation). After the shards are written, it decodes them again and searches for every benchmark sentence; a
  dataset in which one is found is not trained on. The count is stored with the dataset (`integrity`).
- **Cannot change unnoticed.** The file carries a checksum of its content; a changed file is refused. A new benchmark
  would be a new file with a new name, and the old results would stay labelled with the old one.

The benchmark is small. One item is 0.6 percentage points of the score; the standard error of a score near 58% on 176
items is about 3.7 points. A difference of one or two items between two models is not evidence of anything, which is
why the gate asks for more than the score (section 5).

**Memorisation probe.** With every dataset, 64 passages exactly as they are trained on and 64 from held-out documents
are set aside. After training, the model gets the first 24 tokens of each and has to continue. Two numbers come out:
how often it continues the true text word for word for 16 tokens or more, and how much lower its loss is on trained
passages than on unseen ones (the *gap*). The production model is measured on the same passages, as the control.

## 5. The promotion gate

A candidate replaces production only if every check passes. Nothing is promoted by a person, a timer or a default.

| Check | Limit |
|---|---|
| Exported weights reproduce the training framework's outputs | required |
| Held-out loss is a number | required |
| Held-out loss not worse than production's on the same data | +0 |
| Earlier knowledge kept: conversation loss | +0.05 |
| **Held-out document text not read worse** | +0.05 |
| Reply match, evidence choice, search decision did not fall | −0.04 each |
| Sampled replies do not loop | at most 35% |
| **Fixed benchmark was run** | required |
| **Fixed benchmark score did not fall** | −0.03 |
| **Fixed benchmark text not read worse** | +0.05 loss |
| **Does not recite its training text** | at most 15% of trained passages, and at most 10 points more than unseen ones |
| **Trained text not much easier than unseen text** (gap) | 0.6; or production's own gap on the same passages + 0.15 when that is larger; never above 1.0 |
| **Measurably better than production** | held-out loss lower by at least 0.002, **or** benchmark score higher by at least 0.01 |

Bold rows are new. "Not worse" used to be enough; now a candidate must be better by a stated margin, must not have
bought a better conversation loss with worse reading of documents, and must not show the signs of memorising. A first
model (nothing to compare with) must clear absolute floors and must have a benchmark result.

Two of the limits were changed after the first real cycle, and the reasons are on record:

- The *held-out document text* check was added because the first candidate (`m0003`) lowered the overall held-out
  loss while reading held-out documents worse (4.157 against 4.004): better conversation hid it.
- The gap limit was a fixed 0.6. On the passages of the first cycle, production itself — which had not been trained in
  that cycle — measured 0.62, because the two passage sets differ in difficulty. A fixed limit below what an untouched
  model measures would refuse every candidate for a reason that has nothing to do with it. The limit now takes
  production on the same passages as the control (+0.15), with a hard ceiling of 1.0. `m0003` (gap 1.31) is refused
  under the old rule and under the new one.

The gate's defaults are in `learning/store.mjs` (`DEFAULTS.gate`) and are pinned by a test, so a change has to be
deliberate.

## 6. Training caution

The first candidate the worker trained by itself was refused for overfitting: 69 new documents, read 1.35 times at the
learning rate meant for much more data. Rejecting it was right; training the next one the same way would have been
pointless. So the amount of training now adapts:

- A level from 0 to 3 is kept in the state. A candidate refused by one of the generalisation checks (benchmark,
  held-out document text, memorisation, earlier knowledge) raises it by one; a promotion lowers it by one.
- At level *n*, an incremental cycle uses the learning rate ÷ 2ⁿ, the pull towards the approved weights × 2ⁿ, and at
  most 1.5 ÷ (1 + n) passes over its training data (whichever is less: that, or the time budget).

The plan of every cycle (level, learning rate, passes, steps) is stored with the cycle and shown on the dashboard.
This is a simple rule, not a search for the best settings.

## 7. Publishing: the model channel

After a promotion or a rollback, and every two minutes for the records, the worker writes the channel:

```
channel.json            which version is in production, and name, size and SHA-256 of each of its three files
m0005.model.json        the version's files, named after the version, so a reader never sees a mix of two versions
m0005.tokenizer.json
m0005.weights.bin
snapshot.json           the learning records for the dashboard (no file paths of the worker's machine)
status.json             a short status
```

`channel.json` is written last. Targets: a directory (`INFINI_PUBLISH_DIR`) and/or the assets of a GitHub release
(`INFINI_PUBLISH_GITHUB=owner/repository`, release `infinity-model`). Release assets of a public repository can be
downloaded by anyone without a token.

**The serving side** (`engine/neural/channel.js`) is given the address with `INFINI_MODEL_CHANNEL`. Every five minutes
at most (and on the first request of a new process) it reads `channel.json`. If the version differs from the one it
answers with, it downloads the three files into a scratch directory, compares each SHA-256, loads the model and runs
the model's self-test (the model must reproduce reference outputs stored with it). Only then does the new version
answer. If any step fails — unreachable channel, damaged download, wrong checksum, failed self-test, a file name that
tries to leave the directory — the model that is answering keeps answering and the error is shown on the dashboard.
A rollback on the worker reaches the servers the same way. If the channel names exactly the model that was deployed
with the app, nothing is downloaded.

The channel carries weights and records. It never carries a reply, a rule or a message; in the Infinity LLM chat, the
reply is still produced by the network's weights and nothing else (`docs/PURE-LLM.md`).

On Vercel, a function instance keeps a received model in its temporary directory. A new instance fetches it again
(2.8 MB at present); the first request of that instance waits for this, up to 12 seconds, and is answered by the
deployed model if the download takes longer.

## 8. Running it

**A machine that stays on, with Docker**

```bash
docker compose up -d            # the chat server on :8787 and the worker, sharing one volume
docker compose logs -f worker
```

The server reads the worker's state directly from the shared volume; no channel is needed. Both containers restart by
themselves. To serve from somewhere else (Vercel), give the worker `INFINI_PUBLISH_GITHUB` and `GITHUB_TOKEN`, and the
site `INFINI_MODEL_CHANNEL`.

**A machine that stays on, without Docker**

```bash
python3 -m venv .venv && .venv/bin/pip install torch numpy
sudo cp deploy/infinity-worker.service /etc/systemd/system/     # edit User, WorkingDirectory, environment first
sudo systemctl enable --now infinity-worker
journalctl -u infinity-worker -f
```

**GitHub Actions**

- Start: change `.github/infinity-learning.start` on a branch and push, or run the workflow "Infinity LLM learning"
  by hand. Each session ends by starting the next.
- Stop: set the repository variable `INFINITY_LEARNING` to `off`, or disable the workflow.
- Roll back, pause, resume: run the workflow by hand with `action` = `rollback`, `pause` or `resume`.
- The hourly schedule in the workflow restarts a broken chain. GitHub runs schedules only from the default branch, so
  this takes effect once the workflow is on `main`.

**The site**

Set `INFINI_MODEL_CHANNEL=https://github.com/<owner>/<repo>/releases/download/infinity-model` on the serving
deployment and deploy once. From then on new models arrive by themselves.

**Commands**

```bash
node learning/worker.mjs [--max-runtime SECONDS] [--once] [--no-seed]
node learning/cli.mjs status            # everything the dashboard shows, as JSON
node learning/cli.mjs alive             # exit code 0 while a worker's heartbeat is fresh
node learning/cli.mjs discover          # one discovery round
node learning/cli.mjs cycle [--no-acquire]
node learning/cli.mjs health            # check the production model; roll back if it is damaged
node learning/cli.mjs benchmark [dir]   # run the fixed benchmark on a model
node learning/cli.mjs pause | resume | rollback [mNNNN]
node learning/cli.mjs pack [file] | restore [file] | state-pull | state-push | channel | seed
```

Settings are in `.env.example` (section "The always-on learning worker") and in `learning/store.mjs`
(`DEFAULTS.worker`, `DEFAULTS.gate`, `DEFAULTS.cycle`); a file `config.json` in the state directory overrides them.

## 9. Measured

RESULTS-PLACEHOLDER

## 10. Limits

LIMITS-PLACEHOLDER

## 11. Files

| File | Contents |
|---|---|
| `learning/worker.mjs` | The worker: lock, recovery, the loop, backoff, heartbeat, stop |
| `learning/cycle.mjs` | `discover()`, the cycle with resumable phases, training caution, `snapshot()` for the dashboard |
| `learning/benchmark.mjs`, `learning/benchmark/v1.json` | The fixed benchmark and the memorisation probe |
| `learning/evalsuite.mjs` | Evaluation and the promotion gate |
| `learning/persist.mjs` | Start from the published model, health check and automatic rollback, pruning, state archive |
| `learning/publish.mjs` | The channel: directory and GitHub release; state archive in a release |
| `engine/neural/channel.js` | The serving side of the channel |
| `learning/sources.mjs` | Collectors, including MediaWiki |
| `llm/import_weights.py` | Exported weights → training checkpoint (reproduces the reference outputs exactly) |
| `.github/workflows/infinity-learning.yml`, `.github/infinity-learning.start` | Worker sessions on GitHub Actions |
| `Dockerfile.worker`, `docker-compose.yml`, `deploy/` | The worker on a machine that stays on |
| `test/worker.test.js`, `test/ui-worker.test.js`, `test/helpers/fake-cli.mjs` | Tests |
