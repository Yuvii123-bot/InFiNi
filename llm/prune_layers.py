"""Create a smaller decoder by retaining an explicitly specified set of layers.

This is a lossy warm start, not an equivalent model. Optimizer state and training counters
are intentionally reset, and the parent provenance is retained. The tokenizer is unchanged.
"""
from __future__ import annotations

import argparse
import json
import re

import torch

from .common import now_iso, torch_save_atomic
from .model import ModelConfig


def prune(state, layers):
    cfg = ModelConfig.from_dict(state['model_config'])
    if not layers or len(set(layers)) != len(layers) or layers != sorted(layers) or layers[0] < 0 or layers[-1] >= cfg.n_layer:
        raise ValueError('layers must be a nonempty sorted list of distinct valid layer indices')
    new_cfg = cfg.to_dict()
    new_cfg['n_layer'] = len(layers)
    remap = {old: new for new, old in enumerate(layers)}
    result = {}
    for key, tensor in state['model'].items():
        match = re.match(r'^blocks\.(\d+)\.(.+)$', key)
        if match:
            old = int(match.group(1))
            if old in remap:
                result[f'blocks.{remap[old]}.{match.group(2)}'] = tensor
        else:
            result[key] = tensor
    if cfg.tie_weights:
        result['head.weight'] = result['tok_emb.weight']
    params = sum(t.numel() for n, t in result.items() if not (cfg.tie_weights and n == 'head.weight'))
    return {
        'model': result, 'model_config': new_cfg, 'step': 0, 'tokens_seen': 0, 'train_seconds': 0.0,
        'tokenizer_sha': state.get('tokenizer_sha', ''), 'saved': now_iso(), 'reason': 'lossy layer pruning',
        'parent_step': int(state.get('step', 0)), 'parent_tokens_seen': int(state.get('tokens_seen', 0)),
        'parent_layers': cfg.n_layer, 'retained_layers': layers, 'optimizer_reset': True,
        'initialisation': f'pruned from a {cfg.n_layer}-layer trained model at step {int(state.get("step", 0))}; optimizer reset',
    }, params


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--layers', required=True, help='comma-separated ordered original layer indices')
    args = ap.parse_args()
    state = torch.load(args.ckpt, map_location='cpu', weights_only=False, mmap=True)
    child, params = prune(state, [int(x) for x in args.layers.split(',')])
    torch_save_atomic(child, args.out)
    print(json.dumps({'out': args.out, 'params': params, 'parent_step': child['parent_step'],
                      'parent_layers': child['parent_layers'], 'retained_layers': child['retained_layers'],
                      'step': child['step'], 'optimizer_reset': child['optimizer_reset']}))


if __name__ == '__main__':
    main()
