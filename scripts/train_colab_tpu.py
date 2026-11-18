"""Independent, single-device TPU continuation of the pinned books100m training cycle.

Runs only as a Colab subprocess. It uses the pinned repository's model, dataset
sampler, AdamW construction, and cosine schedule. Checkpoints are CPU-portable.
The parent notebook owns Drive backup and restart policy.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import numpy as np
import torch
import torch_xla
import torch_xla.core.xla_model as xm
import torch_xla.runtime as xr

from llm.common import Shards, now_iso, read_json, write_json_atomic
from llm.model import InfinityLM, ModelConfig
from llm.train import TRAIN_DEFAULTS, lr_at, make_optimizer


def run(data_dir: str, run_dir: str, max_seconds: float) -> None:
    if xr.device_type() != 'TPU':
        raise RuntimeError(f"TPU required, got {xr.device_type()!r}; select a TPU runtime in Colab")
    device = torch_xla.device()
    if device.type != 'xla':
        raise RuntimeError(f"Expected an XLA device, got {device}")
    checkpoint_path = os.path.join(run_dir, 'ckpt.pt')
    status_path = os.path.join(run_dir, 'status.json')
    # This path is either the SHA-verified initial release or the user's own
    # SHA-verified Drive backup. Pickle files from untrusted sources are unsafe.
    state = torch.load(checkpoint_path, map_location='cpu', weights_only=False)
    manifest = read_json(os.path.join(data_dir, 'dataset.json'))
    if not manifest:
        raise RuntimeError('Missing dataset manifest')
    cycle = state.get('cycle') or {}
    if (cycle.get('id'), cycle.get('start_step'), cycle.get('steps')) != ('books100m-v1', 500, 781250):
        raise RuntimeError('Wrong training cycle')
    if not state.get('optimizer') or state.get('optimizer_name') != 'adamw' or not state.get('np_rng') or state.get('torch_rng') is None:
        raise RuntimeError('Checkpoint missing AdamW or random state')
    mcfg = ModelConfig.from_dict(state['model_config'])
    if mcfg.vocab_size != int(manifest['vocab_size']) or (state.get('tokenizer_sha') and state['tokenizer_sha'] != manifest.get('tokenizer_sha')):
        raise RuntimeError('Checkpoint and dataset tokenizer do not match')
    cfg = {**TRAIN_DEFAULTS, 'batch_size': 1, 'sequence_length': 128, 'threads': 2, 'device': 'xla', 'precision': 'bf16',
           'lr': 0.00003, 'min_lr': 0.000003, 'warmup_steps': 1000, 'eval_interval': 5000,
           'eval_windows': 16, 'log_interval': 250, 'save_interval': 1000, 'nice': 0}
    torch.set_num_threads(2)
    model = InfinityLM(mcfg, seed=int(cfg['seed']))
    model.load_state_dict(state['model'])
    model.to(device)
    opt = make_optimizer(model, cfg)
    opt.load_state_dict(state['optimizer'])  # fail rather than silently resetting AdamW
    # Keep Adam's step and LR on the XLA device: otherwise changing Python
    # scalars force graph recompilation. Preserve all saved moment tensors.
    for group in opt.param_groups:
        group['capturable'] = True
        group['foreach'] = False
        for param in group['params']:
            if param not in opt.state or not all(k in opt.state[param] for k in ('step', 'exp_avg', 'exp_avg_sq')):
                raise RuntimeError('Incomplete AdamW state in checkpoint')
            pstate = opt.state[param]
            if not torch.is_tensor(pstate['step']):
                pstate['step'] = torch.tensor(float(pstate['step']))
            pstate['step'] = pstate['step'].to(device)
    step = int(state['step'])
    tokens = int(state.get('tokens_seen', 0))
    train_seconds = float(state.get('train_seconds', 0.0))
    end = cycle['start_step'] + cycle['steps']
    if not 536897 <= step < end:
        raise RuntimeError(f'Checkpoint step {step} outside the remaining cycle')
    rng = np.random.default_rng()
    rng.bit_generator.state = state['np_rng']
    torch.set_rng_state(state['torch_rng'])
    xm.set_rng_state(int(state.get('xla_rng', 1337)))
    train = Shards(data_dir, manifest, 'train')
    val = Shards(data_dir, manifest, 'val')
    if not train.items or not val.items:
        raise RuntimeError('Training or validation shards are missing')
    windows = val.fixed_windows(128, 16)
    if not windows:
        raise RuntimeError('No validation windows')
    print(json.dumps({'event': 'start', 'device': str(device), 'runtime': xr.device_type(), 'precision': 'bf16',
                      'step': step, 'cycle_end': end, 'optimizer_state_restored': True}), flush=True)
    start_step = step
    started = time.monotonic()
    model.train()
    while step < end and time.monotonic() - started < max_seconds:
        t0 = time.monotonic()
        # Passing each rate as a device tensor preserves the original per-step schedule.
        lr = lr_at(step - cycle['start_step'], cycle['steps'], cfg)
        lr_tensor = torch.tensor(lr, dtype=torch.float32).to(device)
        for group in opt.param_groups:
            group['lr'] = lr_tensor
        x, y = train.sample(1, 128, rng)
        x, y = x.to(device), y.to(device)
        opt.zero_grad(set_to_none=True)
        with torch.autocast('xla', dtype=torch.bfloat16):
            _, loss = model(x, y)
        loss.backward()
        grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), float(cfg['grad_clip']))
        # A synchronous finite check prevents an invalid update from becoming a backup.
        loss_value = float(loss.detach().cpu())
        norm_value = float(grad_norm.detach().cpu())
        if not math.isfinite(loss_value) or not math.isfinite(norm_value):
            raise RuntimeError('Non-finite training loss or gradient; refusing to save')
        opt.step()
        xm.mark_step()
        step += 1
        tokens += 128
        train_seconds += time.monotonic() - t0
        if step % 250 == 0:
            elapsed = max(0.001, time.monotonic() - started)
            print(json.dumps({'event': 'step', 'step': step, 'loss': loss_value, 'lr': lr,
                              'positions_per_second_including_compilation': round((step-start_step)*128/elapsed, 2)}), flush=True)
    if step <= start_step:
        raise RuntimeError('No TPU training steps completed')
    model.eval()
    losses = []
    with torch.no_grad():
        for x, y in windows:
            x = torch.from_numpy(x).unsqueeze(0).to(device)
            y = torch.from_numpy(y).unsqueeze(0).to(device)
            with torch.autocast('xla', dtype=torch.bfloat16):
                _, vloss = model(x, y)
            value = float(vloss.detach().cpu())
            if not math.isfinite(value):
                raise RuntimeError('Non-finite validation loss; refusing to save')
            losses.append(value)
    val_loss = sum(losses) / len(losses)
    # Save all XLA tensors as CPU tensors and atomically replace the local file.
    # The notebook separately copies to a new, checksum-verified Drive filename.
    xm.mark_step()
    output = {'model': model.state_dict(), 'optimizer': opt.state_dict(), 'optimizer_name': 'adamw',
              'model_config': mcfg.to_dict(), 'train_config': cfg, 'step': step, 'tokens_seen': tokens,
              'train_seconds': train_seconds, 'cycle': cycle, 'np_rng': rng.bit_generator.state,
              'torch_rng': torch.get_rng_state(), 'xla_rng': xm.get_rng_state(),
              'tokenizer_sha': manifest.get('tokenizer_sha', ''), 'dataset': manifest.get('version', ''),
              'val_loss': val_loss, 'saved': now_iso(), 'reason': 'TPU segment complete',
              'framework': 'torch ' + torch.__version__, 'initialisation': state.get('initialisation', '')}
    temporary = checkpoint_path + '.tmp'
    try:
        xm.save(output, temporary, master_only=False)
        with open(temporary, 'rb') as f:
            os.fsync(f.fileno())
        os.replace(temporary, checkpoint_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    status = {'state': 'done' if step == end else 'stopped', 'device': 'xla', 'runtime': 'TPU', 'precision': 'bf16',
              'source': 'resumed ' + checkpoint_path, 'optimizer_state_restored': True, 'step': step, 'cycle_end': end,
              'val_loss': val_loss, 'tokens_seen': tokens, 'elapsed_seconds': time.monotonic() - started}
    write_json_atomic(status_path, status)
    print(json.dumps({'event': 'end', **status}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--max-seconds', required=True, type=float)
    args = parser.parse_args()
    if not 0 < args.max_seconds <= 3600:
        parser.error('max-seconds must be between 0 and 3600')
    run(args.data, args.run, args.max_seconds)


if __name__ == '__main__':
    main()
