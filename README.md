# Blinkenbar

A supercomputer-style light panel for Hermes Desktop. Blinkenbar turns aggregate system counters and agent activity into dense banks of moving lights, with the rhythm and theatre of classic mainframe panels.

Idle patterns keep the panel alive; real gateway events change its activity, color and pulse. The small labels are hints for close inspection. Individual lamps are a visual interpretation, not hardware registers, token counters or a progress percentage.

## In motion

![Blinkenbar idle animation](docs/media/blinkenbar-demo.gif)

The current images and animation use the actual desktop plugin in an isolated Chromium harness, an aggregate system-counter sample, and an idle agent. No agent events are injected into these captures. The harness supplies a dark theme and an isolated host connection; these are not screenshots of a running Hermes session.

| EMBER | ION | VIOLET |
|---|---|---|
| ![Ember light panel](docs/media/blinkenbar-hero.png) | ![Ion light panel](docs/media/blinkenbar-mode-ion.png) | ![Violet light panel](docs/media/blinkenbar-mode-violet.png) |
| **MATRIX** | **THEME** | **QUIET** |
| ![Matrix light panel](docs/media/blinkenbar-mode-matrix.png) | ![Theme light panel](docs/media/blinkenbar-mode-theme.png) | ![Quiet pattern](docs/media/blinkenbar-quiet.png) |

## What drives the lights

- **System banks:** CPU, memory, disk activity and optional NVIDIA GPU counters from the machine running the plugin backend.
- **Agent banks:** primary sessions, subagents and nested work, classified from gateway events such as thinking, reading, writing, browsing, terminal use, waiting and completion.
- **Ambient movement:** four patterns—CROSSWASH, STOCHASTIC, SHIFT and QUIET—combined with real activity signals. Ambient light alone does not indicate work.
- **Color:** five modes—EMBER, ION, VIOLET, MATRIX and THEME—using Hermes theme colors over a black instrument field.
- **Identity:** automatic main-agent names from Hermes's Bot Mode titles, profile display names or profile names. Unnamed delegated workers retain short `SUB·…` identifiers.

The canvas and status chip are passive. There is no live demo mode or click-to-inspect view. Mode and pattern buttons change the presentation. **Blinkenbar: Override focused profile label** in the command palette sets a local override for that connection and profile; leave it blank to restore automatic naming. Names refresh when the plugin loads, the gateway reconnects or the connection/profile route changes. Legacy unscoped label preferences are ignored rather than assigned to an unknown owner.

## Install and enable

You need Hermes Desktop with unified-plugin support, plus FastAPI and psutil in the Hermes Python runtime. Blinkenbar declares `psutil>=5.9`, with no upper-version cap or exact dependency pin. It imposes no Hermes version range and uses the host's SDK and React rather than bundling a fixed copy. Optional identity metadata falls back to profile names or short identifiers when unavailable.

[Install in Hermes](hermes://plugin/install?repo=cygnostik/Hermes-Plugin-Blinkenlights) opens the desktop install dialog for this repository. Review the source and components before confirming.

Or use the CLI in the intended Hermes profile:

```bash
hermes plugins install cygnostik/Hermes-Plugin-Blinkenlights
hermes plugins enable blinkenbar
hermes plugins doctor --ci blinkenbar
```

Enable **Blinkenbar** in **Hermes Desktop → Settings → Plugins** as well. The unified package includes both the Python metrics backend and the desktop pane; do not separate them. If hot reload does not occur, use **Reload desktop plugins** from the command palette.

The source scanner can flag the `sudo.request` event classifier for review. Blinkenbar observes this event name to indicate waiting; it does not invoke sudo. Read scanner findings rather than bypassing them automatically.

For a manual installation, copy the complete package to `$HERMES_HOME/plugins/blinkenbar`. When not set, the default Hermes home is `~/.hermes`; named profiles have their own home. Disable the plugin before removing that directory.

## Operation

Preferences are stored through plugin-scoped `ctx.storage`. The pane initially docks to the right of the workspace and can be moved using Hermes layout controls.

The roster holds up to 18 entries, protecting the focused primary entity during eviction. Completed children remain briefly before leaving. Late progress does not revive a known completed child; an explicit new start can reopen it. Housekeeping broadcasts do not count as activity. On disconnect, live activity becomes unverified until a fresh event arrives. When Hermes supplies connection ownership, events from other connections are excluded; child identities are separated by profile.

The canvas paints at roughly eight frames per second while visible. Metrics are requested every two seconds only when the pane is visible and the gateway is connected. **RETRY** retries the metrics request without reconnecting or restarting Hermes. Missing or failed measurements display `--`, distinct from measured zero.

## Data and privacy

The plugin consumes event types, tool names, status, hierarchy, session/subagent identifiers and profile ownership to maintain a bounded in-memory roster. It does not retain goal text, message previews, prompt bodies or model labels. It stores only presentation preferences through Hermes.

The metrics endpoint samples aggregate counters on request. There is no analytics service, telemetry upload, background sampler, model-callable tool, file-content reader or credential reader. Remote gateway connections still carry events and metrics between Hermes and the desktop: counters describe the backend machine, not necessarily the desktop computer.

## Platform behavior

- CPU, memory and disk sampling use psutil on macOS, Linux and Windows.
- Optional NVIDIA GPU sampling currently targets Windows. It loads NVML only from the absolute Windows system-directory path, with restricted loader flags. Unsupported or unavailable GPU sampling displays `--`.
- Disk activity prefers native `busy_time`. When unavailable, it uses a byte-rate animation proxy, not a disk-utilization measurement.
- The local verification environment is macOS. The Python tests exercise component failures and the restricted NVML loading contract; they are not live Windows or Linux validation.

## Architecture

```text
blinkenbar/
├── plugin.yaml
├── __init__.py                 Tool-free Python registration
├── dashboard/
│   ├── manifest.json
│   └── plugin_api.py           Namespaced /metrics endpoint
└── desktop/
    └── plugin.js               Gateway-event reducer and canvas pane
```

The desktop imports Hermes's SDK and React. Metrics use the plugin-scoped REST API and Hermes's shared React Query client. No independent runtime dependency bundle is shipped with the desktop code.

## Development and verification

```bash
./scripts/verify.sh
hermes plugins validate .
```

The first command checks JavaScript, desktop regressions, Python tests, a real metrics sample, metadata, repository hygiene and plugin doctor. The second is the plugin admission validator and security scan.

For the isolated browser checks, use an existing Hermes desktop checkout with its development dependencies installed:

```bash
HERMES_DESKTOP_ROOT=/path/to/hermes-agent/apps/desktop node scripts/qa/run.mjs
```

The browser harness imports `desktop/plugin.js` unchanged and uses real React, React Query and nanostores. Only the Hermes host boundary is substituted. It checks controls, rendering, resize behavior, hidden-pane suspension, retry and disposal; test-only events never reach a live gateway. Evidence and build caches stay in ignored `.qa/`.

See [scripts/qa/README.md](scripts/qa/README.md) for media capture, and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

## Credits and support

Chris M. · ProDyn.ai / Promethean Dynamic

`chrism@promethean-dynamic.com`

Inspired by classic supercomputer light panels and the blinkenlight aesthetic demonstrated by Boz Brown in [this video](https://www.youtube.com/watch?v=vKjqw5iGqnQ). Boz Brown is not affiliated with or an endorser of Blinkenbar.

Open an issue for ordinary bugs. Send security reports privately as described in [SECURITY.md](SECURITY.md). See [CHANGELOG.md](CHANGELOG.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT — see [LICENSE](LICENSE).
