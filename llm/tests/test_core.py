"""Tests of the Infinity LLM core: it is a real neural language model, trained by next-token prediction from random weights.

    python -m unittest llm.tests.test_core
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import torch

from llm.model import InfinityLM, ModelConfig, PRESETS

TINY = dict(vocab_size=96, context=32, n_layer=2, n_head=2, d_model=32)


def make_dataset(d: str, vocab: int = 96, n: int = 6000) -> None:
    """A learnable toy language: a noisy repeating pattern, so a model that learns must beat the uniform guess."""
    rng = np.random.default_rng(0)
    base = np.arange(n) % 17 + 8
    noise = rng.integers(8, vocab, size=n)
    ids = np.where(rng.random(n) < 0.1, noise, base).astype("<u2")
    ids[: n - 800].tofile(os.path.join(d, "train.bin"))
    ids[n - 800:].tofile(os.path.join(d, "val.bin"))
    with open(os.path.join(d, "dataset.json"), "w") as f:
        json.dump({"version": "toy", "vocab_size": vocab, "tokenizer_sha": "toy", "shards": [
            {"file": "train.bin", "split": "train", "weight": 1, "group": "dialogue"},
            {"file": "val.bin", "split": "val", "weight": 1, "group": "dialogue"}]}, f)


def run(mod: str, *args: str) -> list[dict]:
    p = subprocess.run([sys.executable, "-m", mod, *args], capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    if p.returncode != 0:
        raise AssertionError(f"{mod} failed ({p.returncode}): {p.stderr[-800:]}")
    out = []
    for line in p.stdout.splitlines():
        if line.startswith("{"):
            out.append(json.loads(line))
    return out


class Architecture(unittest.TestCase):
    def test_is_a_decoder_only_transformer(self):
        m = InfinityLM(ModelConfig.from_dict(TINY), seed=1)
        names = [n for n, _ in m.named_parameters()]
        for part in ("tok_emb.weight", "pos_emb.weight", "blocks.0.attn.qkv.weight", "blocks.0.attn.proj.weight", "blocks.0.mlp.fc.weight", "blocks.0.mlp.proj.weight", "blocks.0.norm1.weight", "blocks.1.norm2.weight", "norm_f.weight"):
            self.assertIn(part, names)
        x = torch.randint(0, 96, (3, 20))
        logits, loss = m(x, x)
        self.assertEqual(tuple(logits.shape), (3, 20, 96))               # one score per vocabulary entry at every position
        self.assertTrue(torch.isfinite(loss))
        self.assertEqual(m.num_params(), sum(p.numel() for p in m.parameters()))

    def test_weights_are_randomly_initialised_not_loaded(self):
        a, b, c = (InfinityLM(ModelConfig.from_dict(TINY), seed=s) for s in (1, 1, 2))
        wa, wb, wc = (m.blocks[0].attn.qkv.weight for m in (a, b, c))
        self.assertTrue(torch.equal(wa, wb))                              # same seed, same numbers
        self.assertFalse(torch.equal(wa, wc))                             # another seed, other numbers
        self.assertAlmostEqual(float(wa.mean()), 0.0, delta=0.01)
        self.assertAlmostEqual(float(wa.std()), 0.02, delta=0.01)        # the spread the initialiser asks for, nothing learned
        # an untrained model knows nothing: its loss is that of a uniform guess over the vocabulary
        x = torch.randint(0, 96, (8, 32))
        _, loss = a(x[:, :-1], x[:, 1:])
        self.assertAlmostEqual(float(loss), math.log(96), delta=0.25)

    def test_attention_is_causal(self):
        m = InfinityLM(ModelConfig.from_dict(TINY), seed=3).eval()
        x = torch.randint(0, 96, (1, 24))
        y = x.clone()
        y[0, 15:] = torch.randint(0, 96, (9,))                            # change the future
        with torch.no_grad():
            la, _ = m(x)
            lb, _ = m(y)
        self.assertTrue(torch.allclose(la[0, :15], lb[0, :15], atol=1e-5))    # the past does not notice
        self.assertFalse(torch.allclose(la[0, 15:], lb[0, 15:], atol=1e-5))

    def test_loss_is_next_token_cross_entropy(self):
        m = InfinityLM(ModelConfig.from_dict(TINY), seed=4).eval()
        x = torch.randint(0, 96, (2, 16))
        inp, tgt = x[:, :-1], x[:, 1:]
        with torch.no_grad():
            logits, loss = m(inp, tgt)
        manual = -torch.log_softmax(logits, -1).gather(-1, tgt.unsqueeze(-1)).mean()
        self.assertAlmostEqual(float(loss), float(manual), places=5)

    def test_backpropagation_reaches_every_weight_and_learning_lowers_loss(self):
        m = InfinityLM(ModelConfig.from_dict(TINY), seed=5)
        opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
        x = (torch.arange(33) % 7 + 10).unsqueeze(0).repeat(8, 1)
        _, first = m(x[:, :-1], x[:, 1:])
        first.backward()
        for n, p in m.named_parameters():
            self.assertIsNotNone(p.grad, n)
            self.assertGreater(float(p.grad.abs().sum()), 0.0, n)
        for _ in range(60):
            _, loss = m(x[:, :-1], x[:, 1:])
            opt.zero_grad()
            loss.backward()
            opt.step()
        self.assertLess(float(loss), 0.3 * float(first))

    def test_autoregressive_generation(self):
        m = InfinityLM(ModelConfig.from_dict(TINY), seed=6).eval()
        prompt = torch.randint(0, 96, (1, 5))
        out = m.generate(prompt, max_new_tokens=12, temperature=0.0)
        self.assertEqual(out.shape[1], 17)
        self.assertTrue(torch.equal(out[:, :5], prompt))
        again = m.generate(prompt, max_new_tokens=12, temperature=0.0)
        self.assertTrue(torch.equal(out, again))                          # greedy decoding is deterministic
        # each new token is the most likely one given everything before it
        with torch.no_grad():
            logits, _ = m(out[:, :10])
        self.assertEqual(int(logits[0, -1].argmax()), int(out[0, 10]))

    def test_configurable_sizes(self):
        for name, p in PRESETS.items():
            cfg = ModelConfig.from_dict({**p, "vocab_size": 512})
            self.assertEqual(cfg.d_model % cfg.n_head, 0, name)
        small = InfinityLM(ModelConfig.from_dict({**TINY, "n_layer": 1})).num_params()
        big = InfinityLM(ModelConfig.from_dict({**TINY, "n_layer": 3, "d_model": 64})).num_params()
        self.assertGreater(big, small)
        ln = InfinityLM(ModelConfig.from_dict({**TINY, "norm": "layernorm"}))
        self.assertTrue(torch.isfinite(ln(torch.randint(0, 96, (1, 8)))[0]).all())


class Training(unittest.TestCase):
    def test_train_checkpoint_resume_evaluate_export(self):
        with tempfile.TemporaryDirectory() as d:
            make_dataset(d)
            runp = os.path.join(d, "run")
            cfgp = os.path.join(d, "cfg.json")
            with open(cfgp, "w") as f:
                json.dump({"model": {"context": 32, "n_layer": 2, "n_head": 2, "d_model": 32}}, f)
            common = ["--data", d, "--run", runp, "--config", cfgp, "--set", "batch_size=16", "--set", "eval_interval=40", "--set", "log_interval=20", "--set", "warmup_steps=10", "--set", "lr=0.003", "--set", "nice=0"]
            ev = run("llm.train", *common, "--steps", "80", "--cycle", "a")
            start, end = ev[0], ev[-1]
            self.assertEqual(start["source"], "random initialisation")
            self.assertTrue(end["finished"])
            self.assertEqual(end["step"], 80)
            steps = [e for e in ev if e["event"] == "step"]
            self.assertLess(steps[-1]["loss"], steps[0]["loss"])                # training loss fell
            self.assertLess(end["val_loss"], 0.7 * math.log(96))                # and so did loss on text it never trained on
            ckpt = os.path.join(runp, "ckpt.pt")
            state = torch.load(ckpt, map_location="cpu", weights_only=False)
            for key in ("model", "optimizer", "step", "tokens_seen", "model_config", "tokenizer_sha"):
                self.assertIn(key, state)
            # loading the checkpoint gives exactly the model that was saved
            m = InfinityLM(ModelConfig.from_dict(state["model_config"]))
            m.load_state_dict(state["model"])
            x = torch.randint(8, 96, (1, 16))
            with torch.no_grad():
                a, _ = m(x)
            m2 = InfinityLM(ModelConfig.from_dict(state["model_config"]), seed=99)
            m2.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=False)["model"])
            with torch.no_grad():
                b, _ = m2(x)
            self.assertTrue(torch.equal(a, b))
            # a second cycle continues from the checkpoint instead of starting over
            ev2 = run("llm.train", *common, "--steps", "40", "--cycle", "b")
            self.assertTrue(ev2[0]["source"].startswith("resumed"))
            self.assertTrue(ev2[0]["optimizer_state_restored"])
            self.assertEqual(ev2[-1]["step"], 120)
            self.assertGreater(ev2[-1]["tokens_seen"], end["tokens_seen"])
            with open(os.path.join(runp, "metrics.jsonl")) as f:
                rows = [json.loads(l) for l in f if l.strip()]
            for key in ("step", "loss", "lr", "tokens", "tok_per_s"):
                self.assertIn(key, rows[-1])
            self.assertTrue(any(r.get("val_loss") is not None for r in rows))
            res = run("llm.evaluate", "--data", d, "--ckpt", ckpt)[0]["results"][0]
            self.assertAlmostEqual(res["val_loss"], ev2[-1]["val_loss"], delta=0.15)
            self.assertIn("dialogue", res["groups"])
            out = os.path.join(d, "export")
            exp = run("llm.export", "--ckpt", ckpt, "--out", out, "--dtype", "f32")[0]
            meta = json.load(open(os.path.join(out, "model.json")))
            self.assertEqual(meta["format"], "infinity-llm/1")
            self.assertEqual(os.path.getsize(os.path.join(out, "weights.bin")), exp["params"] * 4)
            self.assertEqual(len(meta["reference"]["tokens"]), len(meta["reference"]["argmax"]))

    def test_split_q8_export_import_and_shorter_training_window(self):
        with tempfile.TemporaryDirectory() as d:
            make_dataset(d)
            cfg = ModelConfig.from_dict(TINY)
            model = InfinityLM(cfg, seed=3)
            source = os.path.join(d, "source.pt")
            torch.save({"model": model.state_dict(), "model_config": cfg.to_dict(), "step": 7, "tokenizer_sha": "toy"}, source)
            out = os.path.join(d, "q8")
            exported = run("llm.export_int8", "--ckpt", source, "--out", out, "--part-bytes", "10000")[0]
            self.assertGreater(len(exported["parts"]), 1)
            imported = os.path.join(d, "imported.pt")
            result = run("llm.import_weights", "--model", out, "--out", imported)[0]
            self.assertEqual(result["step"], 7)
            self.assertTrue(result["reference"]["ok"])
            runp = os.path.join(d, "continued")
            events = run("llm.train", "--data", d, "--run", runp, "--init-from", imported, "--steps", "1", "--cycle", "short", "--set", "batch_size=1", "--set", "sequence_length=16", "--set", "eval_windows=2", "--set", "nice=0", "--set", "threads=1")
            self.assertEqual(events[-1]["step"], 8)
            self.assertEqual(events[-1]["tokens_seen"], 16)
            saved = torch.load(os.path.join(runp, "ckpt.pt"), map_location="cpu", weights_only=False)
            self.assertEqual(saved["model_config"]["context"], 32)
            self.assertEqual(saved["train_config"]["sequence_length"], 16)

    def test_compare_models_on_the_same_context_windows(self):
        with tempfile.TemporaryDirectory() as d:
            make_dataset(d)
            checkpoints = []
            for context in (16, 32):
                cfg = ModelConfig.from_dict({**TINY, "context": context})
                model = InfinityLM(cfg, seed=1)
                ckpt = os.path.join(d, f"{context}.pt")
                torch.save({"model": model.state_dict(), "model_config": cfg.to_dict()}, ckpt)
                checkpoints.append(ckpt)
            results = run("llm.evaluate", "--data", d, "--ckpt", checkpoints[0], "--ckpt", checkpoints[1], "--context", "16", "--windows", "5", "--threads", "1")[0]["results"]
            self.assertEqual([r["context"] for r in results], [16, 16])
            self.assertEqual([r["tokens"] for r in results], [80, 80])
            self.assertTrue(all(math.isfinite(r["val_loss"]) for r in results))

    def test_a_checkpoint_from_another_tokenizer_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            make_dataset(d)
            runp = os.path.join(d, "run")
            run("llm.train", "--data", d, "--run", runp, "--preset", "nano", "--steps", "2", "--set", "batch_size=4", "--set", "nice=0")
            man = json.load(open(os.path.join(d, "dataset.json")))
            man["tokenizer_sha"] = "another"
            json.dump(man, open(os.path.join(d, "dataset.json"), "w"))
            p = subprocess.run([sys.executable, "-m", "llm.train", "--data", d, "--run", runp, "--steps", "2"], capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("different tokenizer", p.stderr + p.stdout)


if __name__ == "__main__":
    unittest.main()
