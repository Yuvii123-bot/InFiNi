"""Infinity LLM Core — a decoder-only Transformer language model trained from random initialisation.

Nothing here loads pretrained weights or calls an external model. PyTorch supplies tensors and automatic
differentiation; the architecture, the training loop, the checkpoints and the export format are this project's own.
"""
__all__ = ["model", "train", "evaluate", "export", "hw"]
