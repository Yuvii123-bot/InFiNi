"""Export a checkpoint for the JavaScript inference engine.

Writes  weights.bin  (every tensor, little-endian float16 or float32, concatenated)
and     model.json   (architecture, tensor table, training provenance, and reference logits computed by PyTorch from
                      the exported numbers, so engine/neural/model.js can prove it computes the same function).

  python -m llm.export --ckpt data/runs/current/ckpt.pt --out data/models/m0001 --dtype f16
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import numpy as np
import torch

from .common import now_iso, write_json_atomic
from .model import InfinityLM, ModelConfig

FORMAT = "infinity-llm/1"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dtype", default="f16", choices=["f16", "f32"])
    args = ap.parse_args(argv)

    state = torch.load(args.ckpt, map_location="cpu", weights_only=False)
    cfg = ModelConfig.from_dict(state["model_config"])
    model = InfinityLM(cfg)
    model.load_state_dict(state["model"])
    model.eval()

    np_dtype = np.dtype("<f2") if args.dtype == "f16" else np.dtype("<f4")
    tensors, chunks, offset = [], [], 0
    rounded = {}
    for name, t in model.state_dict().items():
        if cfg.tie_weights and name == "head.weight":
            continue                                   # shared with tok_emb.weight
        arr = t.detach().to(torch.float32).numpy().astype(np_dtype)
        rounded[name] = torch.from_numpy(arr.astype(np.float32))
        tensors.append({"name": name, "shape": list(arr.shape), "offset": offset, "size": int(arr.size)})
        chunks.append(arr.tobytes())
        offset += int(arr.size)
    blob = b"".join(chunks)

    # reference: run PyTorch on exactly the numbers that were written (after rounding to the export precision)
    sd = dict(rounded)
    if cfg.tie_weights:
        sd["head.weight"] = sd["tok_emb.weight"]
    model.load_state_dict(sd)
    g = np.random.default_rng(20261113)
    n = min(24, cfg.context)
    tokens = g.integers(0, cfg.vocab_size, size=n).astype(np.int64)
    with torch.no_grad():
        logits, _ = model(torch.from_numpy(tokens)[None, :])
    last = logits[0, -1].double()
    reference = {
        "tokens": tokens.tolist(),
        "argmax": logits[0].argmax(-1).tolist(),
        "last_logits_head": [round(float(v), 6) for v in last[:32]],
        "last_logsumexp": round(float(torch.logsumexp(last, 0)), 6),
        "last_max": round(float(last.max()), 6),
    }

    os.makedirs(args.out, exist_ok=True)
    tmp = os.path.join(args.out, ".weights.tmp")
    with open(tmp, "wb") as f:
        f.write(blob)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, os.path.join(args.out, "weights.bin"))
    meta = {
        "format": FORMAT, "config": cfg.to_dict(), "params": model.num_params(), "dtype": args.dtype, "tensors": tensors,
        "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
        "step": int(state.get("step", 0)), "tokens_seen": int(state.get("tokens_seen", 0)), "train_seconds": float(state.get("train_seconds", 0.0)),
        "val_loss": state.get("val_loss"), "dataset": state.get("dataset", ""), "tokenizer_sha": state.get("tokenizer_sha", ""),
        "framework": state.get("framework", "torch " + torch.__version__), "initialisation": "random (seeded); no pretrained weights",
        "exported": now_iso(), "reference": reference,
    }
    write_json_atomic(os.path.join(args.out, "model.json"), meta)
    print(json.dumps({"out": args.out, "params": meta["params"], "bytes": len(blob), "dtype": args.dtype, "sha256": meta["sha256"], "step": meta["step"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
