"""Look at the machine and say what it can train.

  python -m llm.hw                 # inventory + recommended model size
  python -m llm.hw --bench         # also measure real training throughput for the sizes that fit

Nothing is assumed: the recommendation comes from the memory, the accelerator and (with --bench) the measured speed.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time

import torch

from .common import cpu_flags, pick_device, pick_precision
from .model import InfinityLM, ModelConfig, PRESETS


def memory_gb() -> float:
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return round(int(line.split()[1]) / 1024 / 1024, 2)
    except OSError:
        pass
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024 ** 3, 2)
    except (ValueError, OSError, AttributeError):
        return 0.0


def inventory() -> dict:
    flags = cpu_flags()
    cuda = torch.cuda.is_available()
    mps = bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_available())
    device = pick_device("auto")
    gpus = []
    if cuda:
        for i in range(torch.cuda.device_count()):
            p = torch.cuda.get_device_properties(i)
            gpus.append({"name": p.name, "memory_gb": round(p.total_memory / 1024 ** 3, 2)})
    return {
        "platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version(), "torch": torch.__version__,
        "cpu_count": os.cpu_count(), "torch_threads": torch.get_num_threads(), "memory_gb": memory_gb(),
        "cpu_training": True, "gpu_training": cuda or mps, "cuda": cuda, "apple_silicon_mps": mps, "gpus": gpus,
        "cpu_simd": sorted(f for f in flags if f in ("avx2", "avx512f", "avx512_bf16", "amx_bf16", "fma", "neon", "asimd")),
        "mixed_precision": pick_precision("auto", device) != "fp32", "device": device, "precision": pick_precision("auto", device),
    }


def recommend(inv: dict) -> str:
    """Largest preset that this machine can train in a useful time. Deliberately conservative on CPUs."""
    if inv["cuda"]:
        vram = max((g["memory_gb"] for g in inv["gpus"]), default=0)
        return "large" if vram >= 20 else "base" if vram >= 7 else "small"
    if inv["apple_silicon_mps"]:
        return "base" if inv["memory_gb"] >= 16 else "small"
    cores, mem = inv["cpu_count"] or 1, inv["memory_gb"]
    if cores >= 16 and mem >= 16:
        return "small"
    if cores >= 4 and mem >= 6:
        return "mini"
    if mem >= 2:
        return "micro"
    return "nano"


def bench(preset: str, vocab: int, device: str, steps: int = 4, batch: int = 16) -> dict:
    cfg = ModelConfig.from_dict({**PRESETS[preset], "vocab_size": vocab})
    model = InfinityLM(cfg, seed=1).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
    x = torch.randint(0, vocab, (batch, cfg.context), device=device)
    times = []
    for i in range(steps + 1):
        t = time.time()
        _, loss = model(x, x)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        if device == "cuda":
            torch.cuda.synchronize()
        if i:                                          # the first step includes one-off allocation
            times.append(time.time() - t)
    s = sum(times) / len(times)
    return {"preset": preset, "params": model.num_params(), "context": cfg.context, "batch": batch, "seconds_per_step": round(s, 3), "tokens_per_second": round(batch * cfg.context / s)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", action="store_true")
    ap.add_argument("--vocab", type=int, default=4096)
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args(argv)
    if args.threads:
        torch.set_num_threads(args.threads)
    elif not torch.cuda.is_available():
        torch.set_num_threads(max(1, os.cpu_count() or 1))
    inv = inventory()
    inv["torch_threads"] = torch.get_num_threads()
    rec = recommend(inv)
    out = {"hardware": inv, "recommended_preset": rec, "presets": {k: v for k, v in PRESETS.items()}}
    if args.bench:
        order = list(PRESETS)
        upto = min(len(order), order.index(rec) + 2)
        out["bench"] = []
        for p in order[:upto]:
            try:
                out["bench"].append(bench(p, args.vocab, inv["device"]))
            except RuntimeError as e:                  # usually: out of memory
                out["bench"].append({"preset": p, "error": str(e).split("\n")[0][:160]})
                break
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
