"""Infinity LLM Core — training.

Self-supervised next-token prediction with backpropagation. Resumable: the checkpoint holds the weights, the optimizer
state, the step counter and the random-number state, and is written atomically, so a restart continues where it stopped.

  python -m llm.train --data data/datasets/current --run data/runs/current --config llm/config.json --steps 500

One invocation is one training cycle (or the rest of an interrupted one). The learning engine (learning/daemon.mjs)
decides when a cycle runs and whether its result is ever served; this file only trains and reports what happened.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sys
import time

import numpy as np
import torch

from .common import Shards, now_iso, pick_device, pick_precision, read_json, rss_mb, torch_save_atomic, write_json_atomic
from .model import InfinityLM, ModelConfig, PRESETS

TRAIN_DEFAULTS = dict(
    batch_size=32, grad_accum=1, lr=1e-3, min_lr=1e-4, warmup_steps=100, weight_decay=0.05, beta1=0.9, beta2=0.95,
    grad_clip=1.0, optimizer="adamw", precision="auto", device="auto", threads=0, seed=1337,
    eval_interval=250, eval_windows=64, log_interval=20, save_interval=250,
    anchor_l2=0.0,          # pull towards the weights the cycle started from (guards against forgetting); 0 = off
    duty=1.0,               # share of wall time spent training (0.5 = sleep as long as each step took)
    nice=10,                # lower scheduling priority so the chat server stays responsive
)


def lr_at(step_in_cycle: int, cycle_steps: int, cfg: dict) -> float:
    """Linear warm-up, then cosine decay to min_lr at the end of the cycle."""
    warm = max(0, int(cfg["warmup_steps"]))
    if warm and step_in_cycle < warm:
        return cfg["lr"] * (step_in_cycle + 1) / warm
    if cycle_steps <= warm:
        return cfg["lr"]
    p = min(1.0, (step_in_cycle - warm) / max(1, cycle_steps - warm))
    return cfg["min_lr"] + 0.5 * (cfg["lr"] - cfg["min_lr"]) * (1 + math.cos(math.pi * p))


def make_optimizer(model: torch.nn.Module, cfg: dict) -> torch.optim.Optimizer:
    decay = [p for n, p in model.named_parameters() if p.requires_grad and p.dim() >= 2]
    no_decay = [p for n, p in model.named_parameters() if p.requires_grad and p.dim() < 2]
    groups = [{"params": decay, "weight_decay": cfg["weight_decay"]}, {"params": no_decay, "weight_decay": 0.0}]
    name = str(cfg["optimizer"]).lower()
    if name == "adamw":
        return torch.optim.AdamW(groups, lr=cfg["lr"], betas=(cfg["beta1"], cfg["beta2"]))
    if name == "adam":
        return torch.optim.Adam(groups, lr=cfg["lr"], betas=(cfg["beta1"], cfg["beta2"]))
    if name == "sgd":
        return torch.optim.SGD(groups, lr=cfg["lr"], momentum=0.9)
    raise ValueError(f"unknown optimizer '{cfg['optimizer']}' (adamw, adam, sgd)")


def autocast_for(device: str, precision: str):
    if precision == "fp32":
        return torch.autocast(device_type="cpu", enabled=False)
    dtype = torch.bfloat16 if precision == "bf16" else torch.float16
    return torch.autocast(device_type="cuda" if device == "cuda" else "cpu", dtype=dtype)


@torch.no_grad()
def validation_loss(model, windows, device: str, precision: str, batch: int = 32) -> float:
    if not windows:
        return float("nan")
    model.eval()
    total, count = 0.0, 0
    for i in range(0, len(windows), batch):
        chunk = windows[i:i + batch]
        x = torch.from_numpy(np.stack([c[0] for c in chunk])).to(device)
        y = torch.from_numpy(np.stack([c[1] for c in chunk])).to(device)
        with autocast_for(device, precision):
            _, loss = model(x, y)
        total += float(loss) * len(chunk)
        count += len(chunk)
    model.train()
    return total / count


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Train Infinity LLM Core (one cycle, resumable).")
    ap.add_argument("--data", required=True, help="dataset directory containing dataset.json and token shards")
    ap.add_argument("--run", required=True, help="run directory: ckpt.pt, metrics.jsonl, status.json")
    ap.add_argument("--config", default="", help="JSON file with {model:{...}, train:{...}} (optional)")
    ap.add_argument("--preset", default="", help=f"model size preset: {', '.join(PRESETS)}")
    ap.add_argument("--init-from", default="", help="start from this checkpoint when the run directory has none")
    ap.add_argument("--steps", type=int, default=500, help="optimizer steps in this cycle")
    ap.add_argument("--max-seconds", type=float, default=0, help="stop the cycle after this much wall time (0 = no limit)")
    ap.add_argument("--cycle", default="", help="cycle id; an interrupted cycle with the same id is continued")
    ap.add_argument("--fresh", action="store_true", help="ignore an existing checkpoint and start from random weights")
    ap.add_argument("--set", action="append", default=[], metavar="key=value", help="override a train setting, e.g. --set lr=0.0005")
    args = ap.parse_args(argv)

    file_cfg = read_json(args.config, {}) if args.config else {}
    tcfg = {**TRAIN_DEFAULTS, **(file_cfg.get("train") or {})}
    for kv in args.set:
        k, _, v = kv.partition("=")
        if k not in tcfg:
            raise SystemExit(f"unknown train setting '{k}'")
        tcfg[k] = type(TRAIN_DEFAULTS[k])(float(v)) if not isinstance(TRAIN_DEFAULTS[k], str) else v

    os.makedirs(args.run, exist_ok=True)
    ckpt_path = os.path.join(args.run, "ckpt.pt")
    status_path = os.path.join(args.run, "status.json")
    metrics_path = os.path.join(args.run, "metrics.jsonl")
    stop_path = os.path.join(args.run, "stop")
    if os.path.exists(stop_path):
        os.remove(stop_path)

    manifest = read_json(os.path.join(args.data, "dataset.json"))
    if not manifest:
        raise SystemExit(f"no dataset.json in {args.data}")

    device = pick_device(tcfg["device"])
    precision = pick_precision(tcfg["precision"], device)
    if tcfg["threads"]:
        torch.set_num_threads(int(tcfg["threads"]))
    elif device == "cpu":
        torch.set_num_threads(max(1, os.cpu_count() or 1))
    try:
        if tcfg["nice"] and hasattr(os, "nice"):
            os.nice(int(tcfg["nice"]))
    except OSError:
        pass

    # ---- model: resume, or continue from an approved checkpoint, or start from random weights ----
    state = None
    source = "random initialisation"
    if not args.fresh and os.path.exists(ckpt_path):
        state = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        source = "resumed " + ckpt_path
    elif not args.fresh and args.init_from:
        state = torch.load(args.init_from, map_location="cpu", weights_only=False)
        source = "continued from " + args.init_from

    if state:
        mcfg = ModelConfig.from_dict(state["model_config"])
    else:
        base = dict(PRESETS[args.preset]) if args.preset else {}
        mcfg = ModelConfig.from_dict({**base, **(file_cfg.get("model") or {})})
    if mcfg.vocab_size != int(manifest["vocab_size"]):
        if state:
            raise SystemExit(f"checkpoint vocabulary ({mcfg.vocab_size}) does not match the dataset's tokenizer ({manifest['vocab_size']})")
        mcfg.vocab_size = int(manifest["vocab_size"])
    if state and state.get("tokenizer_sha") and manifest.get("tokenizer_sha") and state["tokenizer_sha"] != manifest["tokenizer_sha"]:
        raise SystemExit("the checkpoint was trained with a different tokenizer than this dataset uses")

    seed = int(tcfg["seed"])
    model = InfinityLM(mcfg, seed=seed)
    if state:
        model.load_state_dict(state["model"])
    model.to(device)
    opt = make_optimizer(model, tcfg)
    opt_restored = False
    if state and state.get("optimizer") and state.get("optimizer_name") == tcfg["optimizer"]:
        try:
            opt.load_state_dict(state["optimizer"])
            opt_restored = True
        except (ValueError, KeyError):
            opt_restored = False                      # different parameter groups: start the optimizer afresh
    scaler = torch.amp.GradScaler("cuda", enabled=(device == "cuda" and precision == "fp16"))

    step = int(state["step"]) if state else 0
    tokens_seen = int(state.get("tokens_seen", 0)) if state else 0
    train_seconds = float(state.get("train_seconds", 0.0)) if state else 0.0
    cycle = (state or {}).get("cycle") or {}
    if not args.cycle or cycle.get("id") != args.cycle:
        cycle = {"id": args.cycle or f"c{int(time.time())}", "start_step": step, "steps": int(args.steps), "started": now_iso(), "dataset": manifest.get("version", "")}
    cycle_end = cycle["start_step"] + cycle["steps"]

    rng = np.random.default_rng(seed + step)
    if state and state.get("np_rng") and source.startswith("resumed"):
        rng.bit_generator.state = state["np_rng"]
        torch.set_rng_state(state["torch_rng"])

    train = Shards(args.data, manifest, "train")
    val = Shards(args.data, manifest, "val")
    if not train.items:
        raise SystemExit("the dataset has no training shards")
    val_windows = val.fixed_windows(mcfg.context, int(tcfg["eval_windows"]))

    anchor = None
    if tcfg["anchor_l2"] > 0 and state:
        anchor = [p.detach().clone() for p in model.parameters()]

    stopping = {"flag": False, "why": ""}

    def ask_stop(signum, _frame):
        stopping["flag"], stopping["why"] = True, f"signal {signum}"

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, ask_stop)
        except (ValueError, OSError):
            pass

    info = dict(
        device=device, precision=precision, threads=torch.get_num_threads(), params=model.num_params(), model=mcfg.to_dict(),
        train={k: tcfg[k] for k in ("batch_size", "grad_accum", "lr", "min_lr", "warmup_steps", "weight_decay", "optimizer", "grad_clip", "anchor_l2", "duty")},
        dataset=manifest.get("version", ""), train_tokens_available=train.tokens, val_tokens_available=val.tokens,
        source=source, optimizer_state_restored=opt_restored, cycle=cycle, torch=torch.__version__, pid=os.getpid(),
    )

    def save(reason: str, val_loss=None) -> None:
        torch_save_atomic({
            "model": model.state_dict(), "optimizer": opt.state_dict(), "optimizer_name": tcfg["optimizer"],
            "model_config": mcfg.to_dict(), "train_config": tcfg, "step": step, "tokens_seen": tokens_seen,
            "train_seconds": train_seconds, "cycle": cycle, "np_rng": rng.bit_generator.state, "torch_rng": torch.get_rng_state(),
            "tokenizer_sha": manifest.get("tokenizer_sha", ""), "dataset": manifest.get("version", ""),
            "val_loss": val_loss, "saved": now_iso(), "reason": reason, "framework": "torch " + torch.__version__,
        }, ckpt_path)

    def status(state_name: str, **extra) -> None:
        write_json_atomic(status_path, {"state": state_name, "updated": now_iso(), "step": step, "cycle_end": cycle_end, "tokens_seen": tokens_seen, "train_seconds": round(train_seconds, 1), "rss_mb": rss_mb(), **info, **extra})

    def log(rec: dict) -> None:
        with open(metrics_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")

    status("starting")
    print(json.dumps({"event": "start", **info}), flush=True)

    bs, accum, ctx = int(tcfg["batch_size"]), max(1, int(tcfg["grad_accum"])), mcfg.context
    model.train()
    t_cycle = time.time()
    run_loss, run_n, t_log, tok_log = 0.0, 0, time.time(), 0
    last_val = None
    reason = "cycle complete"
    while step < cycle_end:
        if stopping["flag"] or os.path.exists(stop_path):
            reason = "stopped: " + (stopping["why"] or "stop file")
            break
        if args.max_seconds and time.time() - t_cycle > args.max_seconds:
            reason = "time budget used"
            break
        t_step = time.time()
        lr = lr_at(step - cycle["start_step"], cycle["steps"], tcfg)
        for g in opt.param_groups:
            g["lr"] = lr
        opt.zero_grad(set_to_none=True)
        loss_val = 0.0
        for _ in range(accum):                       # gradient accumulation: several small batches, one update
            x, y = train.sample(bs, ctx, rng)
            x, y = x.to(device), y.to(device)
            with autocast_for(device, precision):
                _, loss = model(x, y)
            scaler.scale(loss / accum).backward()    # backpropagation
            loss_val += float(loss.detach()) / accum
        if not math.isfinite(loss_val):
            reason = "stopped: the loss became NaN or infinite"
            status("failed", error=reason)
            print(json.dumps({"event": "error", "message": reason}), flush=True)
            return 3                                  # the last good checkpoint on disk is left untouched
        if anchor is not None:
            with torch.no_grad():
                for p, a in zip(model.parameters(), anchor):
                    if p.grad is not None:
                        p.grad.add_(p - a, alpha=float(tcfg["anchor_l2"]))
        if tcfg["grad_clip"] > 0:
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), tcfg["grad_clip"])
        scaler.step(opt)
        scaler.update()
        step += 1
        n_tok = bs * ctx * accum
        tokens_seen += n_tok
        tok_log += n_tok
        run_loss += loss_val
        run_n += 1
        dt = time.time() - t_step
        train_seconds += dt
        if 0 < tcfg["duty"] < 1:
            time.sleep(dt * (1 - tcfg["duty"]) / tcfg["duty"])

        do_eval = (step % int(tcfg["eval_interval"]) == 0) or step == cycle_end
        if do_eval:
            last_val = validation_loss(model, val_windows, device, precision, bs)
        if step % int(tcfg["log_interval"]) == 0 or do_eval:
            rec = {"t": now_iso(), "step": step, "loss": round(run_loss / max(1, run_n), 4), "lr": round(lr, 7), "tokens": tokens_seen,
                   "tok_per_s": round(tok_log / max(1e-6, time.time() - t_log)), "elapsed_s": round(train_seconds, 1), "cycle": cycle["id"], "rss_mb": rss_mb()}
            if do_eval and last_val == last_val:
                rec["val_loss"] = round(last_val, 4)
            log(rec)
            status("training", loss=rec["loss"], lr=rec["lr"], tok_per_s=rec["tok_per_s"], val_loss=(round(last_val, 4) if last_val is not None and last_val == last_val else None))
            print(json.dumps({"event": "step", **rec}), flush=True)
            run_loss, run_n, t_log, tok_log = 0.0, 0, time.time(), 0
        if step % int(tcfg["save_interval"]) == 0:
            save("periodic", last_val)

    if last_val is None or step != cycle_end:
        last_val = validation_loss(model, val_windows, device, precision, bs)
    save(reason, last_val)
    finished = step >= cycle_end
    final = {"event": "end", "reason": reason, "finished": finished, "step": step, "val_loss": (round(last_val, 4) if last_val == last_val else None), "tokens_seen": tokens_seen,
             "train_seconds": round(train_seconds, 1), "cycle_seconds": round(time.time() - t_cycle, 1), "checkpoint": ckpt_path, "rss_mb": rss_mb()}
    status("done" if finished else "stopped", reason=reason, val_loss=final["val_loss"])
    print(json.dumps(final), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
