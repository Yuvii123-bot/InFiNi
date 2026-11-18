"""Benchmark private copies of a checkpoint; never publish the trained copies.

Run on the same machine in alternating order. --max-seconds bounds the training
loop, while reported cycle time includes final validation and saving. This is a
short throughput benchmark, not a measure of model quality or convergence.
"""
import argparse
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--checkpoint', required=True)
    p.add_argument('--data', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--seconds', type=int, default=75)
    args = p.parse_args()
    checkpoint = Path(args.checkpoint).resolve()
    data = Path(args.data).resolve()
    output = Path(args.output).resolve()
    assert checkpoint.is_file() and (data / 'dataset.json').is_file()
    assert 10 <= args.seconds <= 300
    import torch
    state = torch.load(checkpoint, map_location='cpu', weights_only=False, mmap=True)
    start_step = int(state['step'])
    start_tokens = int(state['tokens_seen'])
    start_seconds = float(state['train_seconds'])
    assert start_step == 536897 and state['cycle']['id'] == 'books100m-v1'
    assert state.get('optimizer') and state.get('np_rng') and state.get('torch_rng') is not None
    del state
    try:
        affinity = len(os.sched_getaffinity(0))
    except AttributeError:
        affinity = None
    try:
        cpu_quota = Path('/sys/fs/cgroup/cpu.max').read_text().strip()
    except OSError:
        cpu_quota = None
    runs = []
    # Balanced order controls for short-term drift. Each subprocess starts from
    # the exact same full optimizer and RNG state, independently of the others.
    for index, threads in enumerate((2, 4, 4, 2), 1):
        with tempfile.TemporaryDirectory(prefix='infini-thread-bench-') as work:
            shutil.copyfile(checkpoint, Path(work) / 'ckpt.pt')
            env = {**os.environ, 'OMP_NUM_THREADS': str(threads), 'MKL_NUM_THREADS': str(threads)}
            cmd = [sys.executable, '-m', 'llm.train', '--data', str(data), '--run', work,
                   '--steps', '781250', '--max-seconds', str(args.seconds), '--cycle', 'books100m-v1']
            values = {'batch_size': 1, 'sequence_length': 128, 'threads': threads,
                      'lr': 0.00003, 'min_lr': 0.000003, 'warmup_steps': 1000,
                      'eval_interval': 5000, 'eval_windows': 16, 'log_interval': 250,
                      'save_interval': 1000, 'nice': 0}
            for key, value in values.items(): cmd += ['--set', f'{key}={value}']
            print(f'Benchmark {index}/4: {threads} threads', flush=True)
            completed = subprocess.run(cmd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            if completed.returncode:
                print(completed.stdout, flush=True)
                raise RuntimeError(f'benchmark {index} failed: exit {completed.returncode}')
            events = [json.loads(line) for line in completed.stdout.splitlines() if line.startswith('{')]
            start = next(e for e in events if e.get('event') == 'start')
            end = next(e for e in events if e.get('event') == 'end')
            final = json.loads((Path(work) / 'status.json').read_text())
            assert start['source'].startswith('resumed ') and start['optimizer_state_restored']
            assert start['device'] == 'cpu' and start['precision'] == 'bf16' and start['threads'] == threads
            assert start['dataset'] == 'books100m-v1' and end['reason'] == 'time budget used'
            steps = end['step'] - start_step
            tokens = end['tokens_seen'] - start_tokens
            compute_seconds = end['train_seconds'] - start_seconds
            assert steps > 0 and tokens == steps * 128 and compute_seconds > 0 and end['cycle_seconds'] > 0
            row = {'order': index, 'threads': threads, 'start_step': start_step, 'steps': steps,
                   'positions': tokens, 'train_step_seconds': round(compute_seconds, 2),
                   'cycle_seconds_including_final_save_and_validation': end['cycle_seconds'],
                   'train_positions_per_second': round(tokens / compute_seconds, 2),
                   'cycle_positions_per_second': round(tokens / end['cycle_seconds'], 2),
                   'loss': final.get('val_loss'), 'optimizer_restored': start['optimizer_state_restored']}
            runs.append(row)
            print(json.dumps(row), flush=True)
    medians = {str(t): statistics.median(r['train_positions_per_second'] for r in runs if r['threads'] == t) for t in (2, 4)}
    result = {'source': 'independent preserved checkpoint-16-1.pt, step 536897', 'dataset': 'books100m-v1',
              'sequence_length': 128, 'batch_size': 1, 'precision': 'bf16',
              'seconds_per_run': args.seconds, 'cpu_affinity_count': affinity, 'cgroup_cpu_max': cpu_quota,
              'cpu_count': os.cpu_count(), 'platform': platform.platform(), 'torch': torch.__version__,
              'runs': runs, 'median_training_positions_per_second': medians,
              'four_vs_two_ratio': round(medians['4'] / medians['2'], 3),
              'note': 'Independent short runs from the same checkpoint and RNG, not a quality or convergence test. Training-step throughput excludes validation and saving; cycle throughput includes a final validation/save, which are disproportionately frequent in this short benchmark.'}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    main()
