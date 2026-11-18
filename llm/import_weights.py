"""Rebuild a training checkpoint from a published export (model.json + weights.bin).

A learning worker on a new machine has the published weights (model/current, or the model channel) but no checkpoint.
This turns the exported numbers back into a checkpoint that llm.train can continue from, so the worker goes on from the
approved weights instead of starting again from random ones. The optimizer state is not part of an export; training
starts a fresh optimizer (it warms up again), the weights are exactly the exported ones.

  python -m llm.import_weights --model model/current --out data/llm/models/m0002/ckpt.pt
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

import numpy as np
import torch

from .common import now_iso, read_json, torch_save_atomic
from .model import InfinityLM, ModelConfig


def load_export(model_dir: str):
    meta = read_json(os.path.join(model_dir, "model.json"))
    if not meta:
        raise SystemExit(f"no model.json in {model_dir}")
    parts = meta.get("weight_parts", ["weights.bin"])
    if not isinstance(parts, list) or not parts or any(not isinstance(p, str) or not re.fullmatch(r"weights(?:\.\d+)?\.bin", p) for p in parts):
        raise SystemExit("invalid weight parts")
    chunks = []
    for part in parts:
        with open(os.path.join(model_dir, part), "rb") as f:
            chunks.append(f.read())
    blob = b"".join(chunks)
    del chunks
    if meta.get("sha256") and hashlib.sha256(blob).hexdigest() != meta["sha256"]:
        raise SystemExit("weights.bin does not match the checksum in model.json")
    kind = meta.get("dtype", "f16")
    if kind not in ("f16", "f32", "q8"):
        raise SystemExit("unsupported model dtype")
    dtype = np.dtype("i1" if kind == "q8" else "<f2" if kind == "f16" else "<f4")
    flat = np.frombuffer(blob, dtype=dtype)
    if flat.size != sum(t["size"] for t in meta["tensors"]):
        raise SystemExit("wrong weight count")
    cfg = ModelConfig.from_dict(meta["config"])
    sd = {}
    for t in meta["tensors"]:
        offset, size = t["offset"], t["size"]
        if not isinstance(offset, int) or not isinstance(size, int) or offset < 0 or size < 0 or offset + size > flat.size:
            raise SystemExit("invalid tensor bounds")
        arr = flat[offset:offset + size].astype(np.float32).reshape(t["shape"])
        if kind == "q8":
            scale = t.get("scale")
            if not isinstance(scale, (int, float)) or not np.isfinite(scale) or scale <= 0:
                raise SystemExit("invalid q8 tensor scale")
            arr *= scale
        sd[t["name"]] = torch.from_numpy(arr.copy())
    if cfg.tie_weights and "head.weight" not in sd:
        sd["head.weight"] = sd["tok_emb.weight"]
    return meta, cfg, sd


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="directory with model.json and weights.bin")
    ap.add_argument("--out", required=True, help="checkpoint file to write")
    args = ap.parse_args(argv)
    meta, cfg, sd = load_export(args.model)
    model = InfinityLM(cfg)
    model.load_state_dict(sd)
    # proof that the rebuilt network is the published one: the reference logits stored at export time
    ref = meta.get("reference") or {}
    check = None
    if ref.get("tokens"):
        model.eval()
        with torch.no_grad():
            logits, _ = model(torch.tensor(ref["tokens"], dtype=torch.long)[None, :])
        last = logits[0, -1].double()
        diff = max(abs(float(a) - float(b)) for a, b in zip(last[:len(ref["last_logits_head"])], ref["last_logits_head"]))
        check = {"max_diff": round(diff, 6), "ok": diff < 1e-3}
        if not check["ok"]:
            raise SystemExit(f"the rebuilt model does not reproduce the reference logits (difference {diff})")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    torch_save_atomic({
        "model": model.state_dict(), "optimizer": None, "optimizer_name": "", "model_config": cfg.to_dict(), "train_config": {},
        "step": int(meta.get("step", 0)), "tokens_seen": int(meta.get("tokens_seen", 0)), "train_seconds": float(meta.get("train_seconds", 0.0)),
        "cycle": {}, "tokenizer_sha": meta.get("tokenizer_sha", ""), "dataset": meta.get("dataset", ""), "val_loss": meta.get("val_loss"),
        "saved": now_iso(), "reason": "imported from the published export", "framework": "torch " + torch.__version__,
    }, args.out)
    print(json.dumps({"out": args.out, "params": model.num_params(), "step": int(meta.get("step", 0)), "reference": check, "source": args.model}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
