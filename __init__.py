"""Passive Blinkenbar telemetry plugin.

The agent-side plugin intentionally registers no model tools. Its only active
surface is the allow-listed FastAPI dashboard namespace used by Hermes Desktop.
"""
from __future__ import annotations


def register(ctx):
    del ctx
