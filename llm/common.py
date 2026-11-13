"""Shared helpers: atomic files, device and precision selection, token shards."""
from __future__ import annotations

import json
import os
import platform
import tempfile
import time

import numpy as np
import torch


def write_json_atomic(path: str, obj) -> None:
    """Write through a temporary file and rename, so a reader never sees half a file and a crash never truncates one."""
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def torch_save_atomic(obj, path: str) -> None:
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "wb") as f:
        torch.save(obj, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path: str, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def cpu_flags() -> set:
    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("flags"):
                    return set(line.split(":", 1)[1].split())
    except OSError:
        pass
    return set()


def pick_device(want: str = "auto") -> str:
    if want and want != "auto":
        if want == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("device 'cuda' was requested but CUDA is not available")
        if want == "mps" and not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
            raise RuntimeError("device 'mps' was requested but Apple Metal acceleration is not available")
        return want
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def pick_precision(want: str, device: str) -> str:
    """fp32 | bf16 | fp16. 'auto': half precision only where the hardware really accelerates it."""
    if want and want != "auto":
        return want
    if device == "cuda":
        return "bf16" if torch.cuda.is_bf16_supported() else "fp16"
    if device == "cpu" and ({"avx512_bf16", "amx_bf16"} & cpu_flags()):
        return "bf16"
    return "fp32"


def rss_mb() -> float:
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        pass
    try:
        import resource
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(r / (1024 * 1024 if platform.system() == "Darwin" else 1024), 1)
    except Exception:
        return 0.0


class Shards:
    """Token shards written by the dataset builder: flat little-endian uint16 arrays, sampled as random windows."""

    def __init__(self, data_dir: str, manifest: dict, split: str, group: str = ""):
        self.items = []
        self.starts = []                               # per shard: offsets where a training sequence begins (or None)
        for s in manifest.get("shards", []):
            if s.get("split") != split or (group and s.get("group") != group):
                continue
            arr = np.memmap(os.path.join(data_dir, s["file"]), dtype="<u2", mode="r")
            if len(arr) < 2:
                continue
            idx = None
            if s.get("index") and os.path.exists(os.path.join(data_dir, s["index"])):
                idx = np.memmap(os.path.join(data_dir, s["index"]), dtype="<u4", mode="r")
                if len(idx) == 0:
                    idx = None
            self.items.append((s, arr))
            self.starts.append(idx)
        w = np.array([max(0.0, float(s.get("weight", 1.0))) for s, _ in self.items], dtype=np.float64)
        self.probs = w / w.sum() if len(w) and w.sum() > 0 else None
        self.tokens = int(sum(len(a) for _, a in self.items))

    def sample(self, batch: int, context: int, rng: np.random.Generator):
        """A batch of (inputs, targets): targets are the inputs shifted by one token."""
        x = np.empty((batch, context), dtype=np.int64)
        y = np.empty((batch, context), dtype=np.int64)
        picks = rng.choice(len(self.items), size=batch, p=self.probs)
        for i, k in enumerate(picks):
            arr = self.items[k][1]
            n = len(arr)
            if n <= context + 1:                       # a shard shorter than one window: wrap around
                reps = np.resize(np.asarray(arr), context + 1)
                x[i], y[i] = reps[:-1], reps[1:]
                continue
            idx = self.starts[k]
            if idx is not None:                        # begin at the start of a sequence, as a conversation does at inference
                o = min(int(idx[int(rng.integers(0, len(idx)))]), n - context - 1)
            else:
                o = int(rng.integers(0, n - context - 1))
            x[i] = arr[o:o + context]
            y[i] = arr[o + 1:o + context + 1]
        return torch.from_numpy(x), torch.from_numpy(y)

    def fixed_windows(self, context: int, limit: int):
        """The same evenly spaced windows every time, so two checkpoints are always compared on identical text."""
        out = []
        offsets = []                                   # (shard, offset) of every candidate window, in a fixed order
        for k, (_, arr) in enumerate(self.items):
            n = len(arr)
            if n <= context + 1:
                continue
            idx = self.starts[k]
            if idx is not None:
                last = -context
                for o in idx:                          # non-overlapping windows that begin at a sequence start
                    o = int(o)
                    if o - last >= context and o + context + 1 <= n:
                        offsets.append((k, o))
                        last = o
            else:
                offsets.extend((k, w * context) for w in range((n - 1) // context))
        if not offsets:
            return out
        stride = max(1, len(offsets) // max(1, limit))
        for j in range(0, len(offsets), stride):
            if len(out) >= limit:
                break
            k, o = offsets[j]
            arr = self.items[k][1]
            out.append((np.asarray(arr[o:o + context], dtype=np.int64), np.asarray(arr[o + 1:o + context + 1], dtype=np.int64)))
        return out


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
