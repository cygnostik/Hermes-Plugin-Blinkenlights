"""Capture aggregate counters for an idle-state product image, never session data."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from dashboard.plugin_api import metrics


async def sample():
    await metrics()
    await asyncio.sleep(0.2)
    return await metrics()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    payload = asyncio.run(sample())
    if not payload.get('ok'):
        raise SystemExit('Aggregate sample unavailable')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    print('Aggregate metrics sample captured; no session or host identifiers.')
