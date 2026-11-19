"""Mocked checkpoint/Drive smoke test; does not test actual GPU, Colab or downloads.

Run from repository root: python3 scripts/check_latest_gpu_notebook.py
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

notebook = json.loads(Path('notebooks/Infinity_Latest_GPU_738591.ipynb').read_text())
assert notebook['nbformat'] == 4
source = ''.join(notebook['cells'][1]['source'])
compile(source, 'notebook', 'exec')
assert 'infinity-qa75m-44428577193/checkpoint-22-1.pt' in source
assert '77301b854f08b39e8185e4f606ce014b0fd28eec464bacfc2fc2936d9953a422' in source
# Execute only the backup/segment part with an in-memory trainer replacement.
source = source[source.index('import json, re, shutil, time, math'):].replace('SEGMENTS = 4', 'SEGMENTS = 1')

with tempfile.TemporaryDirectory() as temp:
    base = Path(temp)
    run, backup, repo, data = (base / name for name in ('run', 'backup', 'repo', 'data'))
    for directory in (run, backup, repo, data):
        directory.mkdir()
    initial = base / 'initial.pt'
    state = {'cycle': {'id': 'books100m-v1', 'start_step': 500, 'steps': 781250},
             'optimizer': {'state': 1}, 'np_rng': {'x': 1}, 'torch_rng': [1],
             'step': 738591, 'tokens_seen': 94539648}
    initial.write_text(json.dumps(state))
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()
    class FakeTorch:
        def load(self, path, **kwargs):
            return json.loads(path.read_text())
    class FakeSubprocess:
        fail = False
        def run(self, cmd, cwd):
            assert '--cycle' in cmd and 'books100m-v1' in cmd and 'device=cuda' in cmd
            p = run / 'ckpt.pt'
            state = json.loads(p.read_text())
            state['step'] += 10
            state['tokens_seen'] += 1280
            p.write_text(json.dumps(state))
            (run / 'status.json').write_text(json.dumps({'device': 'cuda', 'optimizer_state_restored': True,
                'source': 'resumed ckpt', 'val_loss': 1.2, 'step': state['step']}))
            return type('Result', (), {'returncode': 1 if self.fail else 0})()
    fake = FakeSubprocess()
    env = {'torch': FakeTorch(), 'RUN': run, 'BACKUP': backup, 'REPO': repo, 'DATA': data,
           'checkpoint': initial, 'CKPT_SHA': sha(initial), 'sha256_file': sha,
           'sys': sys, 'subprocess': fake, 'os': os}
    exec(source, env)
    exec(source, env)
    assert len(list(backup.glob('*.pt'))) == 2
    fake.fail = True
    try:
        exec(source, env)
    except RuntimeError as error:
        assert 'Training failed' in str(error)
    else:
        raise AssertionError('Failed segment should not be promoted')
    assert (run / 'segment-in-progress').exists()
    assert len(list(backup.glob('*.pt'))) == 2
    fake.fail = False
    exec(source, env)
    assert len(list(backup.glob('*.pt'))) == 3
    assert len(list(run.glob('ckpt-unverified-*'))) == 1
    latest = sorted(backup.glob('*.pt'))[-1]
    latest.write_bytes(b'corrupted')
    try:
        exec(source, env)
    except RuntimeError as error:
        assert 'corrupted' in str(error)
    else:
        raise AssertionError('Corrupt newest backup should not be trusted')
print('PASS: notebook syntax, mocked GPU segments, interruption recovery and checksum refusal')
