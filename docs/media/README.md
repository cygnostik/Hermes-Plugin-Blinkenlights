# Blinkenbar media

## Which image belongs where

| File | Dimensions | Consumer and status |
|---|---|---|
| `blinkenbar-catalog-hero.png` | 1200×600 | Dedicated **candidate** for the catalog's single `image` field: card, detail header and detail-page Open Graph image. Generated independently; not published by this change. |
| `blinkenbar-prodyn-hero.png` | 1200×600 | Approved README/editorial artwork and existing promotional treatment. Preserve it; the currently reviewed catalog also uses this file. |
| `cm5-inspired-study.png` | 1774×887 | Preserved source artwork, not a screenshot or a historical photograph. |
| `blinkenbar-catalog.png` | 1200×600 | Older actual-plugin panel capture. Kept intact; **not** the new catalog candidate. The runtime capture harness still owns this filename. |
| `blinkenbar-spectrum.png` | 1200×690 | README composite of actual Ember, Ion and Matrix panels. |
| `blinkenbar-hero.png`, `blinkenbar-mode-*.png`, `blinkenbar-quiet.png` | 420×556 | Actual-plugin stills from the isolated browser harness. |
| `blinkenbar-demo.gif` | Existing animation | Sequential real-plugin captures; see the [capture instructions](../../scripts/qa/README.md). |

The README stays on its existing full-ratio artwork. No GitHub Social preview setting is changed: that is a separate upload, not the catalog's `image` field. This repository does not contain a separate social-export generator. Do not replace the approved README/social treatment merely to fit the catalog.

## Why a separate composition

The [catalog card](https://hermes-agent.nousresearch.com/docs/plugins) uses `aspect-ratio: 2 / 1; object-fit: cover`. The [plugin detail header](https://hermes-agent.nousresearch.com/docs/plugins/blinkenbar) instead uses `width: 100%; max-height: 360px; object-fit: cover`, centered, with a 1px bottom border. These are different crops, even though they share one image URL. There is no independent hero or focal-point field.

Renderer references:
- [Card CSS](https://github.com/NousResearch/hermes-agent/blob/main/website/src/pages/plugins/styles.module.css): `.cardImage`.
- [Detail CSS](https://github.com/NousResearch/hermes-agent/blob/main/website/src/components/PluginCatalog/pages.module.css): `.heroImage`, `.shot img`, `.readme img`.
- [Detail renderer](https://github.com/NousResearch/hermes-agent/blob/main/website/src/components/PluginCatalog/PluginPage.tsx).

The measurements below came from the deployed page in isolated Chromium during this media update. They are regression fixtures, not a promise that upstream CSS cannot change. Recheck them before publishing.

| Surface / viewport | Image border box | Image content box |
|---|---|---|
| Card / 1440px | 368.65625×184.328125 | 368.65625×183.328125 |
| Header / 1440px | 1134×360 | 1134×359 |
| Header / 1024px | 958×360 | 958×359 |
| Header / 768px | 734×360 | 734×359 |
| Header / 390px | 387.328125×194.65625 | 387.328125×193.65625 |

At 390px, the deployed page independently overflows horizontally (421px document). The header starts at x=17 and extends past the viewport. An image-frame crop passing does **not** prove viewport fit. This media change does not modify, hide or fix that site defect.

For centered cover, compute `scale = max(contentWidth / imageWidth, contentHeight / imageHeight)`. Divide the content dimensions by that scale, then center the resulting rectangle in the source. Subtract borders before calculating. Intersect those rectangles across the card and headers.

For the measured 1200×600 candidate, the intersection is **x=0–1200, y=110.05291–489.94709**. Each essential layer must fit with **18 source pixels of breathing room**. `catalog-layout.mjs` computes this, rather than treating a hardcoded “safe band” as the renderer contract. A same-ratio resize still loses the same fraction of the source.

The previous title/signature already fit the wide crop; the full-height cabinet scene lost its upper/lower context. The new composition scales the cabinet scene independently, moves the approved lettering into its own central stack, and enlarges it for the card. Faint outer atmosphere is expendable. The prominent cabinet scene, title, benefit and ProDyn.ai mark are all protected:

| Layer | Conservative source-space output bounds `[left, top, right, bottom]` |
|---|---|
| Cabinet scene | `[480, 140, 1140, 470]` |
| Title and eyebrow | `[60, 193, 450, 284.25]` |
| Benefit | `[60, 310, 440.8, 387]` |
| ProDyn.ai signature | `[60, 405, 251.8, 448.4]` |

These rectangles drive the renderer **and** the checks. Visible-ink bounds measured from the processed layers are included in the generated evidence report. The main scene is feathered at the edges; the existing source artwork itself already frames/cuts the nearest cabinets. This is not a reconstruction of missing hardware.

Gallery thumbnails use **16:10 cover**, not either of these frames; do not automatically add this banner to `screenshots`. Use separate useful plugin captures if a gallery is approved. Imported README images remain proportional (`height: auto`).

## Regenerate and check

From the repository root, reuse an existing Playwright installation and installed Chromium. The generator does not install dependencies, fetch fonts, load the plugin, sample counters or connect to any gateway/account. Browser requests are blocked; inputs are the two committed PNG sources above.

```bash
export BLINKENBAR_PLAYWRIGHT_ROOT=/path/to/project-with-playwright
# Alternatively reuse the existing HERMES_DESKTOP_ROOT dependency checkout.
# Optional: BLINKENBAR_BROWSER=/path/to/chromium
# Optional: BLINKENBAR_MEDIA_EVIDENCE=/path/to/scratch/evidence
node scripts/media/render-catalog.mjs
node --test tests/test_catalog_media.mjs
node scripts/media/render-catalog.mjs --check
```

The normal render overwrites **only** `docs/media/blinkenbar-catalog-hero.png` plus evidence. `--check` regenerates in memory and compares the exact PNG bytes to the on-disk candidate without replacing it. Use the same browser version for byte-level reproducibility; a browser upgrade requires regeneration and visual review, not an assertion of cross-engine pixel identity.

The source lettering and actual brand mark are sampled from the approved raster hero, with dark-background removal; no replacement logo, font download or new typesetting is introduced. Preserve those inputs and dimensions. If they change, review the source crop coordinates and regenerate.

Evidence defaults to ignored `.qa/catalog-media/`:
- `results.json`: browser, source/output dimensions, essential and visible-ink bounds, crop intersection, decoded artifact checks and measured fixture boxes.
- `before-card-{dark,light}.png` and `after-card-{dark,light}.png`: actual-size card crops.
- `before-hero-{1440,1024,768,390}-{dark,light}.png` and matching `after-*`: actual-size header crops.

Checks reject invalid/out-of-source rectangles, distortion, edge-bound essential content and a stale export; they decode the actual output and verify opaque, nonblank pixels. Tests also demonstrate that the old full-frame scene and same-ratio resizing do not solve the header crop. The raw panel capture cannot overwrite this separate output.

## Visual and publication gates

Inspect both the full PNG and actual-size before/after fixtures. The title, cabinet banks, short benefit and signature should remain identifiable; small ancillary eyebrow text is not the primary message. These fixtures reproduce image-frame geometry, **not** the whole live page. Automated bounds and a successful render do not replace visual review.

Before publication, substitute the candidate locally in an isolated copy of the actual public card and detail page. Retain an image handle before changing a selector-defining `src`, wait for decoding, and inspect 1440/1024/768/390px in light and dark. Measure both the image content box and browser viewport; report mobile overflow separately. Check the unchanged imported README too. Regeneration resets visual approval to pending.

Publication requires separate approval, a commit containing the new asset, and a reviewed catalog pin/image-URL update. This local generator does none of those actions. After publication, reopen the actual public listing and verify its served URL and crop; local substitution is not proof of deployment.

## Provenance

`cm5-inspired-study.png` was generated with OpenAI's image tool through ChatGPT OAuth. It is illustrative CM-5-inspired artwork, not a historical photograph or a plugin screenshot. The new catalog image deterministically recomposes that source and the existing approved hero. No new image generation is required.

Header and spectrum typography use Oxanium and Departure Mono (SIL Open Font License); the catalog reuses their existing raster lettering and does not redistribute font files. ProDyn branding is used with the owner's approval; the project license does not grant rights to impersonate the brand.

Panel captures and the GIF use the real plugin in an isolated browser host, an aggregate system-counter sample and an idle agent. No agent activity was injected. The CM-5 is the visual inspiration, not an affiliation with Thinking Machines Corporation. [Reference](https://people.csail.mit.edu/bradley/cm5/).
