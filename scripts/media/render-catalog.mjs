import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { catalogLayout as layout, surfaces, inside, validateLayout } from './catalog-layout.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
assert.ok(args.every(arg => arg === '--check'), 'Usage: node scripts/media/render-catalog.mjs [--check]')
const checkOnly = args.includes('--check')
// Reuse an existing installation; never install packages or bake in a machine path.
const dependencyRoot = process.env.BLINKENBAR_PLAYWRIGHT_ROOT || process.env.HERMES_DESKTOP_ROOT || root
const requireBrowser = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))
let chromium
try { ({ chromium } = requireBrowser('playwright')) } catch {
  throw new Error('Playwright missing: set BLINKENBAR_PLAYWRIGHT_ROOT to an existing project with Playwright installed')
}
const evidence = path.resolve(process.env.BLINKENBAR_MEDIA_EVIDENCE || path.join(root, '.qa/catalog-media'))
await fs.mkdir(evidence, { recursive: true })
const bounds = validateLayout(layout)
const images = Object.fromEntries(await Promise.all(Object.entries(layout.sources).map(async ([name, source]) => [name, `data:image/png;base64,${(await fs.readFile(path.join(root, source.path))).toString('base64')}`])))
const browser = await chromium.launch({ headless: true, ...(process.env.BLINKENBAR_BROWSER ? { executablePath: process.env.BLINKENBAR_BROWSER } : {}) })
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1, serviceWorkers: 'block' })
  await context.route('**/*', route => route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const rendered = await page.evaluate(async ({ layout, images }) => {
    const sources = {}
    for (const [name, url] of Object.entries(images)) {
      const image = new Image()
      image.src = url
      await image.decode()
      const [w, h] = layout.sources[name].size
      if (image.naturalWidth !== w || image.naturalHeight !== h) throw new Error(`${name}: source dimensions changed; recheck the composition`)
      sources[name] = image
    }
    const canvas = document.createElement('canvas')
    ;[canvas.width, canvas.height] = layout.size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#020609'
    ctx.fillRect(0, 0, ...layout.size)
    // Expendable outer atmosphere keeps the approved cabinet identity full bleed.
    // The independently scaled, complete scene below is the protected focal layer.
    ctx.globalAlpha = 0.025
    ctx.drawImage(sources.art, 0, 0, ...layout.size)
    ctx.globalAlpha = 1
    const ink = []
    for (const layer of layout.layers) {
      const [sx, sy, sw, sh] = layer.crop
      const tile = document.createElement('canvas')
      tile.width = sw
      tile.height = sh
      const tc = tile.getContext('2d', { willReadFrequently: true })
      tc.drawImage(sources[layer.source], sx, sy, sw, sh, 0, 0, sw, sh)
      const pixels = tc.getImageData(0, 0, sw, sh)
      let count = 0
      let minX = sw, minY = sh, maxX = -1, maxY = -1
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4
        const max = Math.max(...pixels.data.subarray(i, i + 3))
        if (layer.treatment === 'key') {
          // Remove only the dark scene behind the approved raster lettering.
          // Bright glyphs/mark retain their RGB, proportions and antialiasing.
          pixels.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (max - 32) / 32)))
        } else {
          const edge = Math.min(x / 140, (sw - 1 - x) / 140, y / 100, (sh - 1 - y) / 100, 1)
          pixels.data[i + 3] = Math.round(255 * Math.max(0, edge))
        }
        if (pixels.data[i + 3] > 0 && max > 64) {
          count++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        }
      }
      if (count < 80) throw new Error(`${layer.name}: missing visible content`)
      tc.putImageData(pixels, 0, 0)
      ctx.drawImage(tile, ...layer.destination)
      const [dx, dy, dw, dh] = layer.destination
      ink.push({ name: layer.name, visiblePixels: count, bounds: [dx + minX / sw * dw, dy + minY / sh * dh, dx + (maxX + 1) / sw * dw, dy + (maxY + 1) / sh * dh] })
    }
    const pixels = ctx.getImageData(0, 0, ...layout.size).data
    let min = 255, max = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] !== 255) throw new Error('Output must be opaque')
      min = Math.min(min, pixels[i], pixels[i + 1], pixels[i + 2])
      max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2])
    }
    if (max - min < 128) throw new Error('Blank/low-contrast output')
    return { url: canvas.toDataURL('image/png'), ink, range: [min, max] }
  }, { layout, images })
  assert.deepEqual(rendered.ink.map(item => item.name), layout.layers.map(item => item.name))
  for (const item of rendered.ink) assert.ok(inside(item.bounds, bounds.safe, layout.margin), `${item.name}: rendered pixels left the crop-safe area`)
  const generated = Buffer.from(rendered.url.split(',')[1], 'base64')
  const output = path.join(root, layout.output)
  if (checkOnly) {
    const committed = await fs.readFile(output)
    assert.ok(committed.equals(generated), 'Catalog export is stale for this browser; regenerate and visually review it')
  } else {
    await fs.writeFile(output, generated)
  }
  // Decode the exact on-disk artifact too, not just the in-memory composition.
  const actual = `data:image/png;base64,${(await fs.readFile(output)).toString('base64')}`
  const decoded = await page.evaluate(async url => {
    const image = new Image(); image.src = url; await image.decode()
    return [image.naturalWidth, image.naturalHeight]
  }, actual)
  assert.deepEqual(decoded, layout.size)
  const previews = []
  for (const theme of ['dark', 'light']) {
    for (const frame of surfaces) {
      for (const [label, url] of [['before', images.lockup], ['after', actual]]) {
        await page.setViewportSize({ width: Math.ceil(frame.width), height: Math.ceil(frame.height + frame.bottomBorder) })
        await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;background:${theme === 'dark' ? '#07070d' : '#fff'}}img{display:block;box-sizing:content-box;object-fit:cover;object-position:50% 50%;width:${frame.width}px;height:${frame.height}px;border-bottom:1px solid ${theme === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.08)'}}</style><img alt="Crop fixture, not the live website" src="${url}">`)
        await page.locator('img').evaluate(image => image.decode())
        const measured = await page.locator('img').evaluate(image => {
          const rect = image.getBoundingClientRect(), css = getComputedStyle(image)
          return { width: rect.width, height: rect.height, fit: css.objectFit, position: css.objectPosition, border: parseFloat(css.borderBottomWidth) }
        })
        assert.equal(measured.fit, 'cover')
        assert.equal(measured.position, '50% 50%')
        assert.equal(measured.width, frame.width)
        assert.equal(measured.height - measured.border, frame.height)
        const filename = `${label}-${frame.name}-${theme}.png`
        await page.locator('img').screenshot({ path: path.join(evidence, filename) })
        previews.push({ filename, measured })
      }
    }
  }
  assert.deepEqual(errors, [])
  const report = {
    mode: checkOnly ? 'check' : 'render', browser: browser.version(), output: layout.output,
    source: 'Approved raster artwork and lockup only; no runtime, gateway, system sample or network requests',
    dimensions: decoded, bytes: generated.length, opacity: 'all pixels opaque', range: rendered.range,
    ...bounds, ink: rendered.ink, previews,
    visualApproval: 'pending: inspect actual-size fixtures, then substitute on live card and detail page',
    mobilePageOverflow: 'Independent live-site issue: 390px viewport / 421px document; not fixed by this image', errors,
  }
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ mode: report.mode, browser: report.browser, output, dimensions: decoded, bytes: report.bytes, safe: bounds.safe, ink: rendered.ink, fixtures: previews.length, evidence, errors }, null, 2))
} finally {
  await browser.close()
}
