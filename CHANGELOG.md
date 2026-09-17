# Changelog

All notable changes to Blinkenbar will be recorded here. The format follows Keep a Changelog, and versions use Semantic Versioning.

## [0.9.0-pre.3] - 2026-09-17

### Added

- Automatic main-agent labels from Hermes profile metadata, with short identifiers retained for unnamed delegated workers.

### Fixed

- Refresh main-agent identities when focused sessions or owners change, including older SDK fallback behavior.
- Keep known completed children terminal when late progress arrives; explicit starts can reopen them.
- Ignore housekeeping broadcasts, exclude events tagged for other connections, and separate child identities by profile.
- Mark disconnected work unverified instead of leaving active lights and counts indefinitely.
- Suspend metrics polling for hidden panes and disconnected gateways; isolate cached telemetry across connection changes.
- Display unavailable measurements as `--` rather than measured zero, and keep tiny lamp grids within their container.

### Changed

- Preserve the dense light field, subdued labels, existing palettes and ambient/activity motion.
- Remove the psutil upper-version cap; keep Hermes compatibility capability-based rather than imposing a host version range.
- Retry telemetry without reconnecting or restarting the gateway.
- Replace renderer-slicing media tools with a browser harness that loads the emitted plugin and actual React/Query runtime.
- Refresh public media with actual aggregate counter samples and an idle agent; add a 2:1 catalog image.
- Clarify runtime data use, remote-host metrics and the difference between ambient animation and measured activity.

### Removed

- Live synthetic-agent signal test and its command.
- Canvas click inspection, hit regions and interactive status-chip behavior.
- Retention of goals, message previews, model labels and click-detail metadata.

## [0.9.0-pre.2] - 2026-08-18

### Fixed

- Left-aligned the lamp grid with the label brackets and footer rule instead of centering it, so the grid edge no longer drifts relative to the pane chrome at different widths.
- Restricted Windows NVML loading to the absolute OS-reported System32 path with safe loader flags.
- Enforced the 18-entry entity bound under primary-session and active-subagent churn, with deterministic eviction and focused-entity protection.
- Capped live goal/preview metadata, redacted it on completion/error, and made component telemetry failures return a stable degraded payload.

## [0.9.0-pre.1] - 2026-08-18

### Added

- Unified Hermes plugin package with desktop UI and a namespaced FastAPI metrics backend.
- CPU, memory, disk-activity, and optional Windows NVML GPU rows.
- Live primary-agent, session, subagent, and nested-subagent light banks.
- Theme-aware color modes, ambient patterns, status chip, click details, and signal test.
- Local configurable agent label with a generic `AGENT` default.
- Architecture, privacy, security, contribution, website, and third-party documentation.
- Local verification script and backend unit tests.

### Changed

- Removed organization-specific runtime identity and bridge labels.
- Marked the desktop contribution opt-in and aligned package metadata.
- Tightened comments and ignored runtime/build artifacts.

### Security

- Confirmed no intended outbound telemetry, model-callable tools, embedded secrets, or bundled runtime state.
