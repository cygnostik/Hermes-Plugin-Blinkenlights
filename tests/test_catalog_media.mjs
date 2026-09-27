import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { catalogLayout, coverRect, inside, validateLayout } from '../scripts/media/catalog-layout.mjs'

const root = new URL('../', import.meta.url)

test('centered cover derives the wide hero crop from its CONTENT box', () => {
  const crop = coverRect([1200, 600], [1134, 359])
  assert.equal(crop[0], 0)
  assert.equal(crop[2], 1200)
  assert.ok(Math.abs(crop[1] - 110.05291005291) < 1e-8)
  assert.ok(Math.abs(crop[3] - 489.94708994709) < 1e-8)
  assert.deepEqual(coverRect([1200, 600], [360, 180]), [0, 0, 1200, 600])
})

test('all catalog layers keep essential bounds plus margin in the card/hero intersection', () => {
  const result = validateLayout(catalogLayout)
  assert.ok(result.essential.length >= 4, 'title, benefit, mark and cabinet composition required')
  for (const item of result.essential) assert.ok(inside(item.bounds, result.safe, catalogLayout.margin), item.name)
})

test('reject edge-bound titles and artwork, not just incorrect export dimensions', () => {
  for (const name of ['title', 'signature', 'cabinet scene']) {
    const broken = structuredClone(catalogLayout)
    const layer = broken.layers.find(item => item.name === name)
    layer.destination[1] = 25
    assert.throws(() => validateLayout(broken), /crop-safe/, name)
  }
  assert.throws(() => coverRect([1200, 600], [1134, 0]), /positive/)
})

test('legacy full-frame cabinet composition loses scene context in the wide header', () => {
  const { safe } = validateLayout(catalogLayout)
  assert.equal(inside([0, 0, 1200, 600], safe), false)
  // Scaling the same composition to 1440×720 still loses the same fraction.
  const larger = coverRect([1440, 720], [1134, 359])
  assert.ok(Math.abs(larger[1] / 720 - safe[1] / 600) < 1e-10)
})

test('committed candidate is distinct 1200×600 PNG; approved art and runtime captures remain sources', async () => {
  const candidate = await fs.readFile(new URL('docs/media/blinkenbar-catalog-hero.png', root))
  const approved = await fs.readFile(new URL('docs/media/blinkenbar-prodyn-hero.png', root))
  assert.deepEqual([...candidate.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(candidate.readUInt32BE(16), 1200)
  assert.equal(candidate.readUInt32BE(20), 600)
  assert.ok(!candidate.equals(approved), 'same-ratio copying/resizing is not recomposition')
  assert.equal(catalogLayout.sources.lockup.path, 'docs/media/blinkenbar-prodyn-hero.png')
  assert.equal(catalogLayout.sources.art.path, 'docs/media/cm5-inspired-study.png')
  const qa = await fs.readFile(new URL('scripts/qa/run.mjs', root), 'utf8')
  assert.ok(!qa.includes('blinkenbar-catalog-hero.png'), 'runtime capture must not overwrite the catalog composite')
})
