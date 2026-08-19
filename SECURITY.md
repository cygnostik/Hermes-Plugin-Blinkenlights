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

Blinkenbar consumes local Hermes gateway event metadata and samples aggregate system counters through a namespaced FastAPI endpoint. It retains a bounded in-memory entity roster and plugin preferences. It has no intended outbound connection, analytics service, file-content reader, credential reader, database, or model-callable tool.

The optional Windows GPU probe obtains the system directory from the operating system and loads only the resulting absolute `System32\nvml.dll` path with `LOAD_LIBRARY_SEARCH_SYSTEM32`. It never falls back to the current directory, `PATH`, or another DLL search location; unavailable NVML degrades GPU counters without failing the endpoint.

The entity roster is capped at 18 entries with deterministic eviction while the focused primary entity remains protected. Goal and preview metadata are capped at 48 characters while live and redacted when an entity completes or errors, but may appear in local click notifications before redaction. Treat screen-sharing and notification surfaces as part of the operator’s privacy boundary.

## Response

Receipt will be acknowledged when practical. Triage, remediation, disclosure timing, and any credit are coordinated privately. No response-time or fix-time SLA is promised.
