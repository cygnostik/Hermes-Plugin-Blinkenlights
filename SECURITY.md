# Security Policy

## Reporting

Security reports should be sent privately to `chrism@promethean-dynamic.com`. Please do not open a public issue for vulnerabilities; coordinated disclosure is preferred.

## What to report

Please report suspected:

- unintended outbound network access or analytics;
- exposure or persistence of prompt, goal, preview, session, profile, path, or credential data;
- traversal or namespace escapes in the plugin API;
- unsafe handling of gateway events or UI strings;
- excessive permissions or access beyond aggregate local counters;
- dependency or dynamic-library loading risks;
- denial-of-service conditions caused by event volume or rendering.

Include the affected version, platform, Hermes version, reproducible steps, impact, and minimal sanitized evidence. Do not send credentials, production prompt content, private paths, full logs, or unrelated system data.

## Expected behavior and trust boundary

Blinkenbar consumes Hermes gateway event metadata and samples aggregate system counters through a namespaced FastAPI endpoint. It retains a bounded in-memory entity roster and plugin preferences. It has no analytics service, file-content reader, credential reader, database, model-callable tool or independent telemetry destination. With a remote Hermes gateway, event metadata and metrics travel through the existing Hermes connection to the desktop.

The optional Windows GPU probe obtains the system directory from the operating system and loads only the resulting absolute `System32\nvml.dll` path with `LOAD_LIBRARY_SEARCH_SYSTEM32`. It never falls back to the current directory, `PATH`, or another DLL search location; unavailable NVML degrades GPU counters without failing the endpoint.

The entity roster is capped at 18 entries with deterministic eviction while the focused primary entity remains protected. It retains activity and ownership identifiers, not goals, previews, prompt bodies or model labels. A bounded set of completed child identities prevents late events from reopening known terminal work. The canvas exposes no click notifications. Configured agent names, local overrides and short identifiers remain visible on the panel. Naming metadata is read through Hermes's existing `profiles.list` RPC and retained only in memory; overrides are stored in plugin-scoped preferences by connection and profile.

## Response

Receipt will be acknowledged when practical. Triage, remediation, disclosure timing, and any credit are coordinated privately. No response-time or fix-time SLA is promised.
