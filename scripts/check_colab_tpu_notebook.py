"""Standalone smoke test: run from the repository root with PyTorch and NumPy installed.

This test mocks TPU/XLA and does not test TPU hardware or compilation.
"""
import json, pathlib, tempfile, hashlib, sys, os
import torch
n=json.load(open('notebooks/Infinity_Colab_Parallel_TPU.ipynb'))
for i,c in enumerate(n['cells']):
 if c['cell_type']=='code': compile(''.join(c['source']),f'cell {i}','exec')
code=''.join(n['cells'][5]['source']).replace('SEGMENTS = 4','SEGMENTS = 1')
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp); run=root/'run'; backup=root/'drive'; repo=root/'repo'; data=root/'data'
 for d in (run,backup,repo,data): d.mkdir()
 initial=root/'initial.pt'; adapter=root/'trainer.py'; adapter.touch()
 state={'cycle':{'id':'books100m-v1','start_step':500,'steps':781250},'optimizer':{'state':1},'np_rng':{'x':1},'torch_rng':torch.get_rng_state(),'step':536897,'tokens_seen':68722816}
 torch.save(state,initial)
 def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
 class FakeSubprocess:
  fail=False
  def run(self,cmd,cwd,env):
   assert env['PJRT_DEVICE']=='TPU' and str(repo) in env['PYTHONPATH'] and str(adapter) in cmd
   p=run/'ckpt.pt'; state=torch.load(p,weights_only=False); state['step']+=10; state['tokens_seen']+=1280; torch.save(state,p)
   (run/'status.json').write_text(json.dumps({'device':'xla','runtime':'TPU','optimizer_state_restored':True,'source':'resumed ckpt','val_loss':1.2,'step':state['step']}))
   return type('Result',(),{'returncode':1 if self.fail else 0})()
 fake=FakeSubprocess(); env={'torch':torch,'RUN':run,'BACKUP':backup,'REPO':repo,'DATA':data,'ADAPTER':adapter,'checkpoint':initial,'CKPT_SHA':sha(initial),'sha256_file':sha,'sys':sys,'subprocess':fake,'os':os}
 exec(code,env); assert len(list(backup.glob('*.pt')))==1
 exec(code,env); assert len(list(backup.glob('*.pt')))==2
 fake.fail=True
 try: exec(code,env)
 except RuntimeError as e: assert 'Training failed' in str(e)
 else: raise AssertionError('Expected failure')
 assert (run/'segment-in-progress').exists() and len(list(backup.glob('*.pt')))==2
 fake.fail=False; exec(code,env)
 assert len(list(backup.glob('*.pt')))==3 and len(list(run.glob('ckpt-unverified-*')))==1
 # Corrupt the latest backup: must stop instead of blindly loading it.
 latest=sorted(backup.glob('*.pt'))[-1]; latest.write_bytes(b'corrupted')
 try: exec(code,env)
 except RuntimeError as e: assert 'corrupted' in str(e)
 else: raise AssertionError('Expected checksum failure')
 print('PASS: notebook syntax, independent folder, backup, resume, failed segment recovery and corruption refusal')
