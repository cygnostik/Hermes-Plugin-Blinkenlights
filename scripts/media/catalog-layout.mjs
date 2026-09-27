import assert from 'node:assert/strict'

// Content boxes measured on the public catalog, not the image's border box.
// Recheck against the live renderer before publication; see docs/media/README.md.
export const surfaces = [
  { name: 'card', width: 368.65625, height: 183.328125, bottomBorder: 1 },
  { name: 'hero-1440', width: 1134, height: 359, bottomBorder: 1 },
  { name: 'hero-1024', width: 958, height: 359, bottomBorder: 1 },
  { name: 'hero-768', width: 734, height: 359, bottomBorder: 1 },
  // The deployed page separately overflows at 390px. This is the IMAGE box,
  // not a claim that the page or its whole image fits the browser viewport.
  { name: 'hero-390', width: 387.328125, height: 193.65625, bottomBorder: 1 },
]

export const catalogLayout = {
  size: [1200, 600],
  output: 'docs/media/blinkenbar-catalog-hero.png',
  margin: 18,
  sources: {
    art: { path: 'docs/media/cm5-inspired-study.png', size: [1774, 887] },
    lockup: { path: 'docs/media/blinkenbar-prodyn-hero.png', size: [1200, 600] },
  },
  // Source/destination rectangles are [x, y, width, height]. No font or logo
  // reconstruction: retain approved raster lettering and the actual brand mark.
  layers: [
    { name: 'cabinet scene', source: 'art', crop: [0, 0, 1774, 887], destination: [480, 140, 660, 330], treatment: 'feather', essential: true },
    { name: 'title', source: 'lockup', crop: [56, 207, 312, 73], destination: [60, 193, 390, 91.25], treatment: 'key', essential: true },
    { name: 'benefit', source: 'lockup', crop: [56, 307, 272, 55], destination: [60, 310, 380.8, 77], treatment: 'key', essential: true },
    { name: 'signature', source: 'lockup', crop: [58, 385, 137, 31], destination: [60, 405, 191.8, 43.4], treatment: 'key', essential: true },
  ],
}

export function coverRect([iw, ih], [width, height]) {
  assert.ok([iw, ih, width, height].every(v => Number.isFinite(v) && v > 0), 'cover dimensions must be positive')
  const scale = Math.max(width / iw, height / ih)
  return [(iw - width / scale) / 2, (ih - height / scale) / 2, (iw + width / scale) / 2, (ih + height / scale) / 2]
}

export function inside([x0, y0, x1, y1], [left, top, right, bottom], margin = 0) {
  return x0 >= left + margin && y0 >= top + margin && x1 <= right - margin && y1 <= bottom - margin
}

export function validateLayout(layout, frames = surfaces) {
  const crops = frames.map(frame => ({ name: frame.name, rect: coverRect(layout.size, [frame.width, frame.height]) }))
  const safe = [Math.max(...crops.map(c => c.rect[0])), Math.max(...crops.map(c => c.rect[1])), Math.min(...crops.map(c => c.rect[2])), Math.min(...crops.map(c => c.rect[3]))]
  assert.ok(frames.length > 0 && safe.every(Number.isFinite), 'surface intersection required')
  assert.ok(layout.margin >= 0, 'nonnegative breathing room required')
  const essential = []
  for (const layer of layout.layers) {
    const [x, y, w, h] = layer.destination
    const [sx, sy, sw, sh] = layer.crop
    assert.ok([x, y, w, h, sx, sy, sw, sh].every(Number.isFinite) && w > 0 && h > 0 && sw > 0 && sh > 0, `${layer.name}: invalid rectangles`)
    const [sourceWidth, sourceHeight] = layout.sources[layer.source].size
    assert.ok(inside([sx, sy, sx + sw, sy + sh], [0, 0, sourceWidth, sourceHeight]), `${layer.name}: outside source`)
    assert.ok(Math.abs(w / h - sw / sh) < 1e-8, `${layer.name}: do not distort approved art`)
    if (layer.essential) {
      const bounds = [x, y, x + w, y + h]
      assert.ok(inside(bounds, safe, layout.margin), `${layer.name}: not crop-safe with ${layout.margin}px breathing room`)
      essential.push({ name: layer.name, bounds })
    }
  }
  return { crops, safe, essential }
}
