# Blinkenbar Product Website Brief

## Purpose

Create a focused product site that explains Blinkenbar, earns trust with a transparent local-first architecture, and converts Hermes users into contributors and adopters of this MIT-licensed plugin. The site must not imply endorsement by Hermes/Nous Research.

## Audiences

1. **Hermes power users:** want an immediate visual answer to “what are my agents doing?”
2. **Multi-agent developers:** need to observe parent/child work without reading noisy event logs.
3. **Technical team leads and demo operators:** want an expressive, glanceable system display that remains operationally honest.
4. **Security-conscious users:** require precise data-flow, permission, and network-behavior disclosures.

## Positioning

**Category:** Local agent-activity visualization for Hermes Desktop.  
**Promise:** See the machine and the agent mesh move—in one compact pane.  
**Differentiators:** event-driven hierarchy, local system telemetry, no cloud account or analytics, theme-aware canvas performance, and a distinctive blinkenlight visual language.

Avoid “observability platform,” which overstates retention and analysis. Blinkenbar is a live activity display, not a log store, profiler, or audit system.

## Page structure and copy

### 1. Hero

**Eyebrow:** MIT-licensed plugin for Hermes Desktop  
**Headline:** See your agent mesh at a glance.  
**Body:** Blinkenbar translates local system load and live Hermes agent events into an animated bank of lights—so concurrent work is understandable without opening another dashboard.  
**Primary CTA:** Install from GitHub  
**Secondary CTA:** Explore how it works  
**Proof strip:** Local-first · No analytics · Visibility-aware · Unified Hermes plugin

Hero media: a silent 8–12 second loop showing an idle bank, a main turn, two subagents, a waiting state, and completion. Use synthetic labels and redact all prompts and identifiers.

### 2. Problem / outcome

**Heading:** Multi-agent work should not feel invisible.

Three concise cards:

- **Know what is active.** Distinguish thinking, tools, waiting, errors, and completion.
- **See hierarchy.** Follow the primary agent and nested subagents as separate light banks.
- **Watch the host.** Relate CPU, memory, disk, and optional GPU activity to the work in progress.

### 3. Feature sections

#### Live agent mesh

Explain that Hermes gateway events are reduced in memory into a bounded roster. Show labeled callouts for main agent, subagent, nested subagent, activity color, and status pulse.

#### System pulse

Show the top eight resource rows. Clarify that values are aggregate indicators, GPU is Windows/NVML-only in this release, and disk fallback animation is not a benchmark.

#### Designed for the desktop

Highlight docking, resize handling, theme-derived colors, 8 Hz capped animation, hidden-pane suspension, and two-second visible-only metric polling.

#### Make it yours, keep it generic

Show color/pattern controls and the identity command. State that the default label is `AGENT`; organization, profile, and machine names are never baked into the package.

### 4. How it works

Use a four-step horizontal sequence:

1. Hermes emits local gateway events.
2. The desktop plugin classifies and bounds the live entity roster.
3. A namespaced FastAPI endpoint samples local aggregate system counters on request.
4. The canvas paints light banks only while visible.

Add: “No prompt archive. No remote collector. No analytics account.”

### 5. Architecture

Diagram:

```text
Hermes gateway events ──> desktop reducer ──> canvas pane/status chip
                                   ^
                                   │ ctx.rest('/metrics')
                                   │
psutil + optional NVML ──> namespaced FastAPI endpoint
```

Architecture notes:

- Unified package under `$HERMES_HOME/plugins/blinkenbar`.
- Python half exposes no model tools.
- Desktop half imports only Hermes SDK and Hermes-provided React.
- Preferences use plugin-scoped storage.
- No database, daemon, remote API, or analytics SDK.

### 6. Privacy and permissions

Use a plain-language data table:

| Data | Purpose | Persistence | Leaves host? |
|---|---|---|---|
| Event type/status/tool name | Activity classification | Memory only | No |
| Truncated goal/preview | Optional click detail | Memory only | No |
| Short session/subagent identifiers | Stable bank mapping | Memory only | No |
| Aggregate system counters | Resource rows | Not retained | No |
| Label/mode/pattern | User preference | Plugin storage | No |

Call out that click details may expose truncated task metadata during screen sharing. State that remote gateway topology affects which host metrics represent.

### 7. Demo storyboard

1. **0–3 s — Quiet:** pane docked right; system rows move subtly; label reads AGENT.
2. **3–7 s — Turn starts:** primary bank brightens and reports THINKING.
3. **7–13 s — Delegation:** two child banks appear; one browses, one writes.
4. **13–17 s — Nested work:** a compact second-level bank runs a terminal task.
5. **17–21 s — Attention:** one bank pulses WAITING in the attention color.
6. **21–25 s — Resolution:** rows sweep to DONE, then settle.
7. **25–28 s — Customization:** cycle color mode and ambient pattern.
8. **28–30 s — End card:** “See your agent mesh at a glance” and install CTA.

Use synthetic events via the built-in signal test. Do not capture real conversations, usernames, paths, hostnames, profile names, notifications, or API credentials.

## Visual direction

- Dark, restrained technical interface with dense rectangular light cells.
- Use Hermes theme tokens in product captures; website accents may echo ember, cyan, violet, and matrix modes.
- Typography: neutral grotesk for narrative, monospace for telemetry labels.
- Motion: crisp packets and fades, not neon bloom or sci-fi distortion.
- Layout: generous negative space around dense product imagery.
- Accessibility: 4.5:1 body-text contrast, visible focus states, reduced-motion stills, descriptive alt text, and captions for all video.
- Do not imitate Boz Brown’s branding, assets, exact composition, or copy. A credits-page note may identify the video as visual inspiration with explicit no-affiliation language.

## FAQ

**Does Blinkenbar send telemetry to a server?**  
No. “Telemetry” means local system counters displayed locally. There is no analytics or remote collector.

**Does it read my prompts or files?**  
It does not read files or prompt bodies. It consumes gateway event metadata; truncated goal/preview fields may appear in click details.

**Is it a profiler or audit log?**  
No. It is a live, bounded activity display and does not retain an audit history.

**Which platforms are supported?**  
CPU, memory, and disk use psutil on macOS, Linux, and Windows. Direct NVIDIA/NVML GPU metrics currently target Windows.

**Can I change the agent name?**  
Yes. The default is the generic `AGENT`; any user can set a local label from the command palette.

**Does it work with remote gateways?**  
Agent events follow Hermes connectivity. System counters describe the machine running the plugin backend.

**What permissions does it need?**  
Read access to aggregate system counters and local Hermes gateway event metadata. It requests no filesystem, microphone, camera, location, credential, or outbound-network access.

**Is it open source?**  
Yes. Blinkenbar is MIT-licensed; source is available in the GitHub repository.

**How do I get it?**  
Install it directly from the GitHub repository with `hermes plugins install`.

## CTAs and conversion

- Primary: **Install from GitHub** → repository page with README install steps.
- Secondary: **Review privacy architecture** → anchor link to the privacy section.
- Contributor CTA: **Read the contributing guide** → CONTRIBUTING.md in the repository.
- Footer CTA: **Contact support** → `chrism@promethean-dynamic.com`.

## SEO copy and metadata

**Title:** Blinkenbar — Local Agent Activity for Hermes Desktop  
**Meta description:** Blinkenbar turns local system telemetry and live Hermes agent events into a compact, animated activity display. MIT-licensed; no analytics or remote collector.  
**Canonical:** Reserve the final first-party HTTPS product URL; do not point to a repository or temporary preview host.  
**Open Graph title:** See your Hermes agent mesh at a glance  
**Open Graph description:** A local-first blinkenlight display for system load, active agents, and nested work.  
**Open Graph image:** 1200×630 synthetic product capture.  
**Keywords:** Hermes Desktop plugin, agent activity visualization, multi-agent interface, local system telemetry, blinkenlights  
**Structured data:** `SoftwareApplication` with accurate operating systems, version, license (MIT), and release status; omit ratings unless independently collected.

Suggested homepage H1: **See your agent mesh at a glance.**  
Suggested alt text: **Blinkenbar pane showing resource rows and separate animated light banks for one primary agent and three nested tasks.**

## Launch checklist

Before launch: replace placeholders with sanitized media, establish the canonical domain, validate claims against the shipped version, publish a support process, and complete the accessibility review.
