# Changelog

All notable changes to Blinkenbar will be recorded here. The format follows Keep a Changelog, and versions use Semantic Versioning.

## [Unreleased]

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
