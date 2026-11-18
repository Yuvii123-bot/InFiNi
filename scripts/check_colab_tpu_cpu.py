"""Standalone smoke test: run from the repository root with PyTorch and NumPy installed.

This test mocks TPU/XLA and does not test TPU hardware or compilation.
"""
import sys, types, tempfile, pathlib, json
import numpy as np, torch
import torch.optim.adam as adam
from llm.train import TRAIN_DEFAULTS, make_optimizer
from llm.model import ModelConfig, InfinityLM

# Emulate only XLA device plumbing, while running real model/optimizer math on CPU.
# This does not test XLA compilation or actual TPU behavior.
xla = types.ModuleType('torch_xla'); xla.device = lambda: torch.device('cpu')
core = types.ModuleType('torch_xla.core'); xm = types.ModuleType('torch_xla.core.xla_model')
xm.set_rng_state=lambda seed: None; xm.get_rng_state=lambda: 1337; xm.mark_step=lambda: None
xm.save=lambda obj,path,master_only=False: torch.save(obj,path)
xr=types.ModuleType('torch_xla.runtime'); xr.device_type=lambda: 'TPU'
for n,m in [('torch_xla',xla),('torch_xla.core',core),('torch_xla.core.xla_model',xm),('torch_xla.runtime',xr)]: sys.modules[n]=m
adam._get_capturable_supported_devices=lambda: ['cpu']
source=pathlib.Path('scripts/train_colab_tpu.py').read_text().replace("if device.type != 'xla':", "if device.type != 'cpu':").replace("torch.autocast('xla'", "torch.autocast('cpu'")
env={'__name__':'synthetic_test'}; exec(compile(source,'scripts/train_colab_tpu.py','exec'),env)
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp); data=root/'data'; run=root/'run'; data.mkdir();run.mkdir()
 rng=np.random.default_rng(42)
 for name in ['train','val']:
  rng.integers(0,32,size=2048,dtype=np.uint16).tofile(data/(name+'.bin'))
 manifest={'vocab_size':32,'tokenizer_sha':'test','version':'test','shards':[{'split':n,'file':n+'.bin'} for n in ['train','val']]}
 (data/'dataset.json').write_text(json.dumps(manifest))
 cfg=ModelConfig(vocab_size=32,context=128,n_layer=1,n_head=2,d_model=16,dropout=0.0)
 model=InfinityLM(cfg,seed=1); config={**TRAIN_DEFAULTS,'lr':0.00003,'min_lr':0.000003,'warmup_steps':1000}
 opt=make_optimizer(model,config); x=torch.randint(0,32,(1,128)); loss=model(x,x)[1]; loss.backward();opt.step()
 state={'model':model.state_dict(),'model_config':cfg.to_dict(),'optimizer':opt.state_dict(),'optimizer_name':'adamw',
 'step':536897,'tokens_seen':68722816,'train_seconds':0,'cycle':{'id':'books100m-v1','start_step':500,'steps':781250},
 'np_rng':rng.bit_generator.state,'torch_rng':torch.get_rng_state(),'tokenizer_sha':'test','dataset':'test'}
 path=run/'ckpt.pt'; torch.save(state,path)
 env['run'](str(data),str(run),0.2)
 first=torch.load(path,weights_only=False,map_location='cpu'); status=json.loads((run/'status.json').read_text())
 assert first['step']>536897 and status['step']==first['step'] and status['optimizer_state_restored']
 assert first['tokens_seen']==68722816+(first['step']-536897)*128
 assert not torch.equal(state['model']['tok_emb.weight'],first['model']['tok_emb.weight'])
 opt2=make_optimizer(InfinityLM(cfg),config);opt2.load_state_dict(first['optimizer'])
 assert len(opt2.state)==len(opt.state)
 env['run'](str(data),str(run),0.2)
 second=torch.load(path,weights_only=False,map_location='cpu')
 assert second['step']>first['step'] and second['cycle']==state['cycle'] and second['xla_rng']==1337
 print('PASS: real CPU model, AdamW state, schedule, sampling, save and resumed segment (XLA mocked)')
