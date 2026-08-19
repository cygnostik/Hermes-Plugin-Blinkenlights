# Contributing to Blinkenbar

Blinkenbar is MIT-licensed. Contributions are welcome through issues and pull requests.

## Before starting

1. Do not add credentials, prompt transcripts, hostnames, user paths, profile names, generated runtime state, or private customer data.
2. Keep the unified plugin layout intact and avoid new runtime dependencies unless discussed first.

## Development standards

- Preserve local-first behavior and do not add outbound networking or analytics.
- Default all visible identity labels to generic values; customization must be opt-in and local.
- Use only `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime` imports in `desktop/plugin.js`.
- Use Hermes theme tokens rather than hardcoded UI colors. Canvas colors must resolve from host tokens.
- Keep comments rare, concise, and limited to non-obvious technical constraints.
- Remove dead code, commented-out code, temporary diagnostics, TODO markers, and generated artifacts before review.
- Keep metric semantics honest: proxies must be described as activity indicators, not measurements.

## Verification

Run from the package root:

```bash
./scripts/verify.sh
```

Then verify in Hermes Desktop:

- enable/disable and hot reload;
- pane docking and resizing;
- light-bank hierarchy and bounded retention;
- all color modes and patterns;
- identity configuration and generic reset;
- signal test and click detail;
- telemetry-offline recovery;
- hidden-pane rendering/polling suspension;
- GPU-unavailable behavior on systems without supported NVML.

Include the exact command output and platform details with a review request. Never include secrets or unrelated machine diagnostics.

## Changes and review

Use focused changes and update `CHANGELOG.md` under **Unreleased**. Reviewers should check behavior, privacy impact, dependency changes, documentation, and visual regressions.

By submitting material, a contributor confirms they have the right to submit it under the MIT license.
