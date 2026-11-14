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
- The hourly schedule in the workflow restarts a broken chain. GitHub runs schedules only from the default branch, and
  the workflow is on `main`, so this is in effect.

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

All of this was measured on 13 November 2026 (times in UTC). Nobody started, approved or restarted anything by hand
except where the text says so.

### 9.1 On GitHub Actions (hosted runner: 4 cores, 16 GB memory, 86 GB disk)

| When | What happened |
|---|---|
| 13:12:15 | Session 1 starts (a push to the start file; first session limited to 780 s). Empty state → started from the published `m0002`, published to the release `infinity-model`. |
| 13:12–13:23 | Eight discovery rounds: 320 documents fetched, 67 accepted, 253 rejected. |
| 13:24:12 | 67 verified documents are waiting (threshold 60): the worker starts cycle `c0003` by itself. |
| 13:25:15 | The session's time is used up in the middle of the cycle (data and dataset done). The worker stops the step, stores the state (24.0 MB) in the release `infinity-state` and ends; the workflow starts session 2. |
| 13:25:58 | Session 2's worker starts from the stored state: *"cycle c0003 is unfinished (phases done: acquire, dataset) and will be continued"*. |
| 13:28:41 | `c0003` ends: **`m0003` promoted**, all 15 checks passed. Held-out loss 1.8347 against 2.2548 for `m0002` on the same data; fixed benchmark 63.3% against 57.6%. Published to the release within 6 seconds, `channel.json` last. |
| 13:40–13:43 | Cycle `c0004` on 66 new documents: **`m0004` refused**. Benchmark 58.6% against 63.3% (allowed: −3 points); benchmark text loss 6.238 against 6.182 (allowed: +0.05). `m0003` stays; the caution level rises from 0 to 1. |
| 13:42:09 | The site (Vercel, deployed once with `INFINI_MODEL_CHANNEL`) handles its first request: reads the channel, downloads `m0003`, verifies the checksums, passes the self-test (largest difference 0.000006), and answers with it — 1.1 seconds in all. `/api/llm/status` reports version `m0003`, source `channel`, and the worker's records. |
| 13:48 | Still running: 19 discovery rounds, 760 documents fetched, 159 accepted, 601 rejected; 2 cycles (1 promoted, 1 refused); 1 recovery; 0 failed steps. |

Resources there: worker process 98–131 MB; trainer 695 MB; a cycle took 270 s and 209 s (training 369 steps each);
a discovery round 18–34 s plus a 60 s pause; the state grew from 32 MB to 100 MB.

Why documents were rejected (typical round of 40): no licence that permits reuse 8–17, too many from one website
10–13, could not be fetched 2–9, text quality 1–5, not English 0–3, duplicates 0–3.

**A fault this run exposed.** Every document of these two sessions came from the `web` source: the sources were asked
in a fixed order and the first one used up the whole round, so the other five were never asked. The sandbox had hidden
this, because `web` is unreachable there. Fixed (every source gets a share of each round, and the first place rotates;
section 2), with a test. The sessions above still ran the old order: a running session keeps the code it started with.

### 9.2 In the development sandbox (2 cores, 3.8 GB memory)

Five worker processes one after another on the same state, 68 minutes of worker time: 17 discovery rounds (361
documents fetched, 341 accepted, 20 rejected) and four cycles.

| Cycle | Training plan | Result | Decisive numbers (candidate against production, same data) |
|---|---|---|---|
| `c0003` | caution 0: learning rate 0.0004, 369 steps | **refused** | gap 1.31 (limit 0.6); benchmark text loss 6.904 against 6.713; held-out *document* loss 4.157 against 4.004 — although the overall held-out loss was lower (1.221 against 1.254) |
| `c0004` | caution 1: 0.0002, 303 steps | **refused** | gap 0.722 (limit 0.6; production on the same passages 0.341) |
| `c0005` | caution 2: 0.0001, 270 steps | **promoted** (`m0005`) | held-out loss 2.188 against 2.283; document loss 3.091 against 3.232; benchmark 58.6% against 57.6%; gap 0.539 against 0.540 |
| `c0006` | caution 1: 0.0002, 369 steps | **refused** | benchmark text loss 6.642 against 6.583 (allowed +0.05), although held-out loss was lower (2.186 against 2.234) |

- **Killed without warning.** At 13:07:43, during the training of `c0006`, the worker was killed with `kill -9`, then
  the step process; the trainer was left running alone. A new worker, started at 13:08:05, reported: *"the previous
  worker (pid 3670) ended without shutting down; a stale step lock was removed; cycle c0006 is unfinished (phases done:
  acquire, dataset) and will be continued"*, stopped the orphaned trainer, resumed training from the checkpoint and
  finished the cycle at 13:15:39. Checkpoints were 200 steps apart then, so about 100 steps were repeated; they are
  50 steps apart now.
- **Stopped properly.** SIGTERM: stopped, published and released the lock in 2 seconds.
- **Model to a running server.** A second server process, started with the deployed `m0002` and pointed at the worker's
  channel directory, answered with `m0005` after the promotion without a restart (self-test difference 0.000003);
  "hello, who are you?" → "I'm glad. Being good company is exactly what I'm trying to be." (19 tokens, 90 ms).
- Training ran at about 11,000 tokens per second; the trainer used 1.29 GB, the worker 77–136 MB; an evaluation
  (held-out data, probes, benchmark, memorisation probe, for both models) took about two minutes.

### 9.3 Fixed benchmark, every version measured so far

| Version | Where | Status | Score | Language | Knowledge | Reasoning | Conversation | Text loss |
|---|---|---|---|---|---|---|---|---|
| `m0002` | both | start | 57.6% | 58.3% | 47.9% | 52.1% | 71.9% | 6.713 |
| `m0003` | sandbox | refused | 58.1% | 58.3% | 50.0% | 52.1% | 71.9% | 6.904 |
| `m0004` | sandbox | refused | 56.8% | 60.4% | 47.9% | 43.8% | 75.0% | 6.691 |
| `m0005` | sandbox | promoted | 58.6% | 58.3% | 52.1% | 45.8% | 78.1% | 6.583 |
| `m0006` | sandbox | refused | 56.8% | 64.6% | 43.8% | 50.0% | 68.8% | 6.642 |
| `m0003` | runner | **promoted, answering on the site** | 63.3% | — | — | — | — | 6.182 |
| `m0004` | runner | refused | 58.6% | — | — | — | — | 6.238 |

The sandbox and the runner are two separate learning histories that both began at `m0002`; their version numbers
coincide by accident. The runner's is the one the site follows. (Its per-part scores are on the dashboard; they were
not copied here.)

### 9.4 Tests

`npm test`: 116 tests, all passing, offline, about 70 seconds. 23 of them are for this work (`npm run test:worker`):
the real worker with stand-in steps (unattended discover → train → publish; refusal; crash retry; kill and resume;
clean stop; second worker refused; sessions; ending for newer code; damaged model rolled back; pause; hand-over from
the dashboard), the benchmark and its exclusion from training, the memorisation probe, the gate, the state archive,
publication to a GitHub release (stand-in API), the channel (verify, refuse, follow a rollback, survive an outage),
a server swapping models through the channel, the source shares, the MediaWiki collector, the deployment files, and
the dashboard rendered from a snapshot that a real worker published.

## 10. Limits

These are the things that are not solved, or not verified.

**The model**

- It is still a 1.3-million-parameter network. Continuous learning makes it measurably better on its own tests cycle by
  cycle; it does not make it a capable assistant. On the fixed benchmark, guessing scores 50% and the best version so
  far scores 63%.
- The benchmark is small (176 items). A difference of a few items between two versions is within noise; the gate
  therefore refuses on several independent measurements, and it will sometimes refuse a candidate that was in fact
  fine (in the sandbox run, `m0006` was refused for reading the 16 benchmark passages 0.058 worse, with a limit of 0.05).
- "Better on held-out data of this cycle" is measured on documents from the same sources as the training data. It says
  nothing about subjects the sources do not cover.
- The gate cannot detect a source that is consistently wrong in a way other sources do not contradict. The
  cross-source verification, the licence allow-list and the limit per website reduce that risk; they do not remove it.

**GitHub Actions as the host**

- It is a chain of sessions, not one process. Between two sessions nothing learns (measured once: 43 seconds from the
  end of one session's worker to the start of the next).
- The chain can break: GitHub can fail to start a run, delay it, or stop a job. The hourly watchdog restarts a broken
  chain, but only from the default branch; on any other branch a broken chain stays broken until somebody starts it.
- GitHub disables scheduled workflows in a repository without activity for 60 days, and its terms do not promise
  free runners for a permanent workload. A machine that stays on (section 8) has neither problem.
- A running session keeps the code it started with. A fix reaches it when the session ends: by itself between two
  steps once it notices the newer commit (sessions started from this version on), otherwise after at most five hours.
- The state travels as one archive. Checkpoints are uploaded between steps and at shutdown, not in the middle of a
  training cycle. If a runner dies before the next successful upload, work since the last archive is lost. For the
  117M challenger an AdamW checkpoint alone is roughly 1.4 GB uncompressed; compression and upload can take substantial
  time, and GitHub release-asset size limits may prevent state persistence. The new archive is uploaded before the old
  one is removed, with a staging-asset fallback if its final rename fails. Monitor the worker's checkpoint errors.
- The configured `xl` architecture has 117,203,712 parameters with a 4096-token vocabulary. It is trained from scratch
  as a persistent challenger, not grown from the production weights. It continues across cycles even without new docs;
  production is retained until the challenger passes the same comparative quality gate. Training uses batch size one,
  with a 10.5 GB RSS safety threshold. These are not a guarantee that a particular runner will fit or finish in two days.
  The state directory's `config.json` overrides repository settings; inspect it when the runner behaves differently.
- Job logs are not readable from outside GitHub without signing in; the release text of `infinity-model` and the
  dashboard are the windows into a session.

**Serving**

- On a serverless host, a new function instance downloads the current model (2.8 MB) before its first reply, or
  answers that request with the deployed model if the download is slow. The dashboard there shows the worker's
  records with a delay of up to nine minutes.
- The channel is public and unsigned: its integrity rests on GitHub (only someone who can write to the repository's
  releases can publish) and on the checks before a swap (checksums, self-test). There is no signature that would let a
  server refuse a model published by someone who gained write access.

**Not run**

- `Dockerfile.worker`, `docker-compose.yml`, `deploy/infinity-worker.service` and `deploy/fly.worker.toml` were
  written and checked for consistency with the worker's commands; no image was built and no service was started
  (neither Docker nor systemd is available where this was developed).
- The MediaWiki sources (Simple English Wikipedia, Wikibooks, Wikivoyage) are tested against a fake site. In the
  sandbox they are unreachable; on the runner the sessions measured below ran before the fix that gives every source
  its share, so they were not asked yet.
- The watchdog job has not run (it needs the default branch).
- Rollback through the workflow (`action = rollback`) is covered by tests of the command it calls, not by a run.
- No run longer than about an hour has been observed. Behaviour over days — disk growth, the corpus limit, the
  caution level settling — is designed for (pruning, limits) but not measured.

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

### Explicit 117M chat selection

`INFINI_PINNED_MODEL=1` selects the step-2110 117,203,712-parameter q8 Q&A export, not the worker's mutable production channel. Each cold serving instance downloads the four public GitHub release files identified in `engine/neural/pinned-channel.js`, verifies their sizes and SHA-256 checksums, and runs the model's numerical self-test before serving it. Cold starts and generation can be slow. If the files are unavailable or validation fails, the neural model is unavailable rather than silently serving a different model. Set `INFINI_PINNED_VERSION=xl-step110` and redeploy to restore the previous 117M Drive-backed model, or set `INFINI_PINNED_MODEL=0` and redeploy to use the older worker channel. Keep the release and Drive files available. The Q&A checkpoint and optimizer are stored separately in the GitHub release.

The step-2110 model is experimental: it was trained for 1,500 further steps sampling from a set that contains 25,920 additional synthetic arithmetic Q&As and conversational replay; it did not necessarily see every example. Its 16-window held-out loss on that set fell from 4.2377 to 2.8613, but greedy probes produced incorrect arithmetic and failed the name question. Raw neural chat answers must not be treated as reliable.

This checkpoint was trained for only 110 steps on synthetic dialogue from random initialization. It is undertrained and may generate poor or nonsensical responses; more parameters do not imply better quality. The normal assistant can still use its rules or retrieval, while `/llm.html` shows unfiltered model output.
