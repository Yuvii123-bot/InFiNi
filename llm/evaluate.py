"""Held-out validation loss of one or more checkpoints on the same fixed windows of the same validation shards.

  python -m llm.evaluate --data data/datasets/current --ckpt a.pt --ckpt b.pt
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import torch

from .common import Shards, pick_device, pick_precision, read_json
from .model import InfinityLM, ModelConfig
from .train import validation_loss


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--ckpt", action="append", required=True)
    ap.add_argument("--windows", type=int, default=128)
    ap.add_argument("--context", type=int, default=0, help="shared window length when comparing different architectures")
    ap.add_argument("--split", default="val")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args(argv)
    if args.threads:
        torch.set_num_threads(args.threads)
    manifest = read_json(os.path.join(args.data, "dataset.json"))
    if not manifest:
        raise SystemExit(f"no dataset.json in {args.data}")
    device = pick_device(args.device)
    precision = pick_precision("auto", device)
    out = []
    for path in args.ckpt:
        state = torch.load(path, map_location="cpu", weights_only=False)
        cfg = ModelConfig.from_dict(state["model_config"])
        model = InfinityLM(cfg)
        model.load_state_dict(state["model"])
        model.to(device)
        context = args.context or cfg.context
        if context > cfg.context or context < 1:
            raise ValueError(f"comparison context {context} exceeds model context {cfg.context}")
        windows = Shards(args.data, manifest, args.split).fixed_windows(context, args.windows)
        loss = validation_loss(model, windows, device, precision)
        groups = {}
        for g in sorted({s.get("group", "") for s in manifest.get("shards", []) if s.get("split") == args.split and s.get("group")}):
            gw = Shards(args.data, manifest, args.split, group=g).fixed_windows(context, args.windows)
            gl = validation_loss(model, gw, device, precision) if gw else float("nan")
            groups[g] = {"val_loss": None if gl != gl else round(gl, 4), "windows": len(gw)}
        out.append({"groups": groups,"ckpt": path, "step": int(state.get("step", 0)), "val_loss": None if loss != loss else round(loss, 4),
                    "perplexity": None if loss != loss else round(math.exp(min(20.0, loss)), 2), "windows": len(windows), "tokens": len(windows) * context, "context": context,
                    "dataset": manifest.get("version", ""), "split": args.split})
    print(json.dumps({"results": out}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
