"""Infinity LLM Core — the neural network.

A decoder-only autoregressive Transformer:
  token embedding + learned positional embedding
  -> N x [ RMSNorm -> causal multi-head self-attention -> residual ; RMSNorm -> feed-forward (GELU) -> residual ]
  -> RMSNorm -> output projection onto the vocabulary (weights shared with the token embedding by default)
trained with next-token cross-entropy. Every weight starts from a seeded random initialisation.

The JavaScript inference engine (engine/neural/model.js) implements exactly this forward pass; export.py writes
reference logits so that the two can be compared number by number.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict, fields

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ModelConfig:
    vocab_size: int = 4096
    context: int = 256          # longest sequence the model attends over (tokens)
    n_layer: int = 4            # Transformer blocks
    n_head: int = 4             # attention heads per block
    d_model: int = 192          # hidden dimension
    mlp_ratio: float = 4.0      # feed-forward width = mlp_ratio * d_model
    dropout: float = 0.0
    norm: str = "rmsnorm"       # "rmsnorm" or "layernorm"
    tie_weights: bool = True    # output projection shares the token-embedding matrix

    @classmethod
    def from_dict(cls, d: dict) -> "ModelConfig":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})

    def to_dict(self) -> dict:
        return asdict(self)

    def validate(self) -> "ModelConfig":
        if self.d_model % self.n_head:
            raise ValueError(f"d_model ({self.d_model}) must be divisible by n_head ({self.n_head})")
        if self.norm not in ("rmsnorm", "layernorm"):
            raise ValueError("norm must be 'rmsnorm' or 'layernorm'")
        if not (2 <= self.vocab_size <= 65536):
            raise ValueError("vocab_size must fit an unsigned 16-bit token id")
        return self


class RMSNorm(nn.Module):
    """x / sqrt(mean(x^2) + eps) * weight — no mean subtraction, no bias."""

    def __init__(self, dim: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps) * self.weight


class LayerNormNoBias(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.layer_norm(x, self.weight.shape, self.weight, None, self.eps)


def make_norm(cfg: ModelConfig) -> nn.Module:
    return RMSNorm(cfg.d_model) if cfg.norm == "rmsnorm" else LayerNormNoBias(cfg.d_model)


class CausalSelfAttention(nn.Module):
    """Multi-head self-attention in which position t may only attend to positions <= t."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.n_head = cfg.n_head
        self.dropout = cfg.dropout
        self.qkv = nn.Linear(cfg.d_model, 3 * cfg.d_model, bias=False)
        self.proj = nn.Linear(cfg.d_model, cfg.d_model, bias=False)
        self.resid_drop = nn.Dropout(cfg.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, c = x.shape
        q, k, v = self.qkv(x).split(c, dim=2)
        shape = (b, t, self.n_head, c // self.n_head)
        q, k, v = (z.view(shape).transpose(1, 2) for z in (q, k, v))            # (b, heads, t, head_dim)
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True, dropout_p=self.dropout if self.training else 0.0)
        return self.resid_drop(self.proj(y.transpose(1, 2).contiguous().view(b, t, c)))


class FeedForward(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        hidden = int(round(cfg.mlp_ratio * cfg.d_model))
        self.fc = nn.Linear(cfg.d_model, hidden, bias=False)
        self.proj = nn.Linear(hidden, cfg.d_model, bias=False)
        self.drop = nn.Dropout(cfg.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.drop(self.proj(F.gelu(self.fc(x), approximate="tanh")))


class Block(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.norm1 = make_norm(cfg)
        self.attn = CausalSelfAttention(cfg)
        self.norm2 = make_norm(cfg)
        self.mlp = FeedForward(cfg)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.norm1(x))          # residual connection around attention
        return x + self.mlp(self.norm2(x))        # residual connection around the feed-forward network


class InfinityLM(nn.Module):
    def __init__(self, cfg: ModelConfig, seed: int | None = None):
        super().__init__()
        self.cfg = cfg.validate()
        if seed is not None:
            torch.manual_seed(seed)
        self.tok_emb = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.pos_emb = nn.Embedding(cfg.context, cfg.d_model)
        self.drop = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList(Block(cfg) for _ in range(cfg.n_layer))
        self.norm_f = make_norm(cfg)
        self.head = nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)
        if cfg.tie_weights:
            self.head.weight = self.tok_emb.weight
        self.apply(self._init)
        for name, p in self.named_parameters():      # residual branches start small so that depth does not blow up the signal
            if name.endswith("proj.weight"):
                nn.init.normal_(p, mean=0.0, std=0.02 / math.sqrt(2 * cfg.n_layer))

    @staticmethod
    def _init(m: nn.Module) -> None:
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)

    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def forward(self, idx: torch.Tensor, targets: torch.Tensor | None = None):
        b, t = idx.shape
        if t > self.cfg.context:
            raise ValueError(f"sequence of {t} tokens exceeds the context length {self.cfg.context}")
        pos = torch.arange(t, device=idx.device)
        x = self.drop(self.tok_emb(idx) + self.pos_emb(pos))
        for block in self.blocks:
            x = block(x)
        logits = self.head(self.norm_f(x))
        loss = None
        if targets is not None:      # next-token prediction: cross-entropy between each position's logits and the token that follows
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.reshape(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx: torch.Tensor, max_new_tokens: int, temperature: float = 0.8, top_k: int | None = 40, stop: int | None = None) -> torch.Tensor:
        """Autoregressive sampling (reference implementation; the server uses the JavaScript engine)."""
        self.eval()
        for _ in range(max_new_tokens):
            logits, _ = self(idx[:, -self.cfg.context:])
            logits = logits[:, -1, :]
            if temperature <= 0:
                nxt = logits.argmax(-1, keepdim=True)
            else:
                logits = logits / temperature
                if top_k:
                    kth = torch.topk(logits, min(top_k, logits.size(-1))).values[:, [-1]]
                    logits = logits.masked_fill(logits < kth, float("-inf"))
                nxt = torch.multinomial(F.softmax(logits, dim=-1), 1)
            idx = torch.cat([idx, nxt], dim=1)
            if stop is not None and bool((nxt == stop).all()):
                break
        return idx


# Sizes to start from. hw.py picks one after looking at the machine; every field can be overridden in the config file.
PRESETS = {
    "nano":  dict(n_layer=2, n_head=2, d_model=64,  context=128),
    "micro": dict(n_layer=4, n_head=4, d_model=128, context=256),
    "mini":  dict(n_layer=4, n_head=4, d_model=192, context=256),
    "small": dict(n_layer=6, n_head=6, d_model=288, context=384),
    "base":  dict(n_layer=8, n_head=8, d_model=512, context=512),
    "large": dict(n_layer=12, n_head=12, d_model=768, context=1024),
    "xl":    dict(n_layer=16, n_head=16, d_model=768, context=1024),
}
