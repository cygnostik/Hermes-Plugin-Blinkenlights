# Browser checks and media

This development-only harness imports the emitted `desktop/plugin.js` unchanged. It uses React, React Query, nanostores, Tailwind and Chromium from an existing Hermes development checkout. The SDK boundary supplies isolated state, events and REST responses; it never connects to a running Hermes gateway. Tooltip wrapping and haptics are no-ops.

Set `HERMES_DESKTOP_ROOT` to that checkout's `apps/desktop` directory, with its development dependencies installed. The harness uses Playwright's installed Chromium; `BLINKENBAR_BROWSER` can select another Chromium executable. No packages are installed by the script.

```bash
HERMES_DESKTOP_ROOT=/path/to/hermes-agent/apps/desktop node scripts/qa/run.mjs
```

Results, screenshots and Vite caches are written to ignored `.qa/`. Assertions cover the passive canvas/chip, genuine canvas motion, isolated event-driven activity, narrow/wide layout, all presentation controls, offscreen suspension, telemetry retry, late child progress and teardown. Controlled events and sample values in this test mode are fixtures, not live work.

## Public media

Use an actual aggregate sample and an idle agent. No synthetic agent events are injected in media mode. The captured counter values are a snapshot, not a recording of changing system utilization. The palette comes from the test dark theme; the header, buttons, canvas and footer are rendered by the real plugin.

Using a Python interpreter with FastAPI and psutil installed:

```bash
python scripts/qa/sample_metrics.py .qa/local-metrics.json
HERMES_DESKTOP_ROOT=/path/to/hermes-agent/apps/desktop \
  BLINKENBAR_METRICS_FILE=.qa/local-metrics.json \
  node scripts/qa/run.mjs --media
ffmpeg -hide_banner -loglevel error -y -framerate 8 \
  -i .qa/frames/frame_%03d.png \
  -filter_complex '[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' \
  -loop 0 docs/media/blinkenbar-demo.gif
```

Media mode overwrites the README stills and catalog image. The animation combines 64 sequential browser captures at an eight-frame-per-second playback rate; it is not a timing benchmark. Review generated assets before committing them. Images demonstrate the renderer, not native Hermes installation or live gateway integration.

Do not include `.qa/`, dependency directories or local metrics files in a release. A clean-checkout security scan avoids irrelevant warnings from generated third-party Vite caches.
