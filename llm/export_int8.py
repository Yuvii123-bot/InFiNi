"""Export a checkpoint as split, per-tensor symmetric int8 weights for the JS engine.

This is a compact deployment format, not a training checkpoint. Its reference logits are computed by PyTorch
using the dequantized values actually exported, so the serving engine can still check parity before use.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os

import numpy as np
import torch

from .common import now_iso, write_json_atomic
from .model import InfinityLM, ModelConfig


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--part-bytes', type=int, default=64 * 1024 * 1024)
    args = ap.parse_args()
    if args.part_bytes < 1:
        raise ValueError('part-bytes must be positive')
    torch.set_num_threads(2)
    state = torch.load(args.ckpt, map_location='cpu', weights_only=False, mmap=True)
    cfg = ModelConfig.from_dict(state['model_config'])
    model = InfinityLM(cfg)
    model.load_state_dict(state['model'])
    model.eval()
    os.makedirs(args.out, exist_ok=True)
    tensors, parts, offset = [], [], 0
    sha = hashlib.sha256()
    current = None
    size = 0

    def write_bytes(data):
        nonlocal current, size
        view = memoryview(data)
        while view:
            if current is None or size == args.part_bytes:
                if current:
                    current.close()
                name = f'weights.{len(parts)}.bin'
                parts.append(name)
                current = open(os.path.join(args.out, name), 'wb')
                size = 0
            piece = view[:args.part_bytes - size]
            current.write(piece)
            sha.update(piece)
            size += len(piece)
            view = view[len(piece):]

    with torch.no_grad():
        for name, tensor in model.state_dict().items():
            if cfg.tie_weights and name == 'head.weight':
                continue
            maximum = float(tensor.abs().max())
            scale = maximum / 127.0 if maximum else 1.0
            q = torch.clamp(torch.round(tensor / scale), -127, 127).to(torch.int8)
            data = q.numpy().tobytes()
            write_bytes(data)
            tensors.append({'name': name, 'shape': list(q.shape), 'offset': offset, 'size': q.numel(), 'scale': scale})
            offset += q.numel()
            tensor.copy_(q.to(torch.float32) * scale)
    if current:
        current.close()

    g = np.random.default_rng(20261113)
    tokens = g.integers(0, cfg.vocab_size, size=min(24, cfg.context)).astype(np.int64)
    with torch.no_grad():
        logits, _ = model(torch.from_numpy(tokens)[None, :])
    last = logits[0, -1].double()
    reference = {'tokens': tokens.tolist(), 'argmax': logits[0].argmax(-1).tolist(),
                 'last_logits_head': [round(float(v), 6) for v in last[:32]],
                 'last_logsumexp': round(float(torch.logsumexp(last, 0)), 6), 'last_max': round(float(last.max()), 6)}
    meta = {'format': 'infinity-llm/1', 'config': cfg.to_dict(), 'params': model.num_params(),
            'dtype': 'q8', 'tensors': tensors, 'weight_parts': parts, 'bytes': offset, 'sha256': sha.hexdigest(),
            'step': int(state.get('step', 0)), 'tokens_seen': int(state.get('tokens_seen', 0)),
            'train_seconds': float(state.get('train_seconds', 0.0)), 'val_loss': state.get('val_loss'),
            'dataset': state.get('dataset', ''), 'tokenizer_sha': state.get('tokenizer_sha', ''),
            'framework': state.get('framework', ''), 'initialisation': 'random (seeded); no pretrained weights',
            'exported': now_iso(), 'reference': reference}
    write_json_atomic(os.path.join(args.out, 'model.json'), meta)
    print(json.dumps({'out': args.out, 'params': meta['params'], 'bytes': offset, 'parts': parts, 'step': meta['step'], 'sha256': meta['sha256']}))


if __name__ == '__main__':
    main()
