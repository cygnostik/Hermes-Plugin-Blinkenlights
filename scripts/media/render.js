#!/usr/bin/env node
// Renders Blinkenbar README media by driving the REAL shipped renderer
// (renderer.generated.cjs) under node-canvas with a fully synthetic roster.
// Nothing here reads live gateway state.
'use strict'
const fs = require('fs')
const path = require('path')
const { createCanvas } = require('canvas')

let renderer
try {
  renderer = require('./renderer.generated.cjs')
} catch {
  console.error('run: node extract-renderer.js first')
  process.exit(1)
}
const { drawMatrixBank, modePalette } = renderer

// --- Synthetic dark theme (Hermes-style tokens) --------------------------
const THEME = {
  accent: [251, 146, 60], accent2: [56, 189, 248], bg: [9, 9, 11],
  blue: [59, 130, 246], card: [24, 24, 27], chrome: [14, 14, 16],
  cyan: [6, 182, 212], elevated: [28, 28, 32], green: [34, 197, 94],
  orange: [249, 115, 22], purple: [168, 85, 247], red: [239, 68, 68],
  stroke: [63, 63, 70], text: [228, 228, 231], text2: [161, 161, 170],
  text3: [113, 113, 122], yellow: [234, 179, 8]
}
const METRICS = {
  cpu: 46, memory: 63,
  io: { activity: 34, read_bps: 18 * 1048576, write_bps: 7 * 1048576 },
  gpu: { available: false }
}

const NOW = Date.now()
const entity = (id, props) => ({
  id, parentId: null, isMain: false, depth: 1, order: 0, sessionId: 'demo-session',
  status: 'active', activity: 'thinking', detail: '', name: 'AGENT',
  pulse: 1, pulseAt: NOW, lastSeen: NOW, goal: '', model: '', tool: '',
  ...props
})

// --- Storyboard (seconds) -------------------------------------------------
// quiet -> primary thinking -> delegation (browse+write) -> nested terminal
// -> waiting pulse -> resolution sweep -> settle.
function roster(t) {
  const at = s => NOW - (t - s) * 1000
  const entities = []
  entities.push(entity('main', {
    isMain: true, name: 'AGENT', order: 0, lastSeen: NOW,
    status: t < 1.2 ? 'idle' : t < 9.5 ? 'active' : t < 11.2 ? 'done' : 'idle',
    activity: t < 1.2 ? 'idle' : t < 3 ? 'thinking' : t < 9.5 ? 'working' : t < 11.2 ? 'done' : 'idle',
    detail: 'turn in progress', pulse: t >= 1.2 ? 1 : 0.3, pulseAt: at(1.2)
  }))
  if (t >= 3) {
    const aDone = t >= 11
    const aWait = t >= 6.5 && t < 8
    entities.push(entity('sub-a', {
      parentId: 'main', name: 'SUB·A4F21C', order: 1, lastSeen: at(3),
      status: aDone ? 'done' : aWait ? 'waiting' : 'active',
      activity: aDone ? 'done' : aWait ? 'waiting' : t < 8 ? 'browsing' : 'reading',
      detail: 'reconnaissance', pulse: aWait ? 1 : 0.9, pulseAt: at(aWait ? 6.5 : 3)
    }))
    entities.push(entity('sub-b', {
      parentId: 'main', name: 'SUB·9B3E07', order: 2, lastSeen: at(3),
      status: t >= 9.5 ? 'done' : 'active',
      activity: t >= 9.5 ? 'done' : 'writing',
      detail: 'interface build', pulse: 0.9, pulseAt: at(3)
    }))
  }
  if (t >= 5) {
    entities.push(entity('sub-c', {
      parentId: 'sub-b', name: 'SUB·C7D1A2', order: 3, depth: 2, lastSeen: at(5),
      status: t >= 8 ? 'done' : 'active',
      activity: t >= 8 ? 'done' : 'terminal',
      detail: 'nested verification', pulse: 0.9, pulseAt: at(5)
    }))
  }
  return entities
}

const color = (rgb, alpha = 1) =>
  `rgb(${Math.round(rgb[0])} ${Math.round(rgb[1])} ${Math.round(rgb[2])} / ${Math.max(0, Math.min(1, alpha))})`
const font = (ctx, size = 9, tone = '') => {
  ctx.font = `${tone} ${size}px Menlo, "SF Mono", Consolas, monospace`
  ctx.textBaseline = 'middle'
}
const text = (ctx, value, x, y, rgb, alpha = 1, align = 'left') => {
  ctx.textAlign = align
  ctx.fillStyle = color(rgb, alpha)
  ctx.fillText(value, x, y)
}

const HEADER_H = 34
const FOOTER_H = 19

function paintFrame(canvas, { t, mode = 'EMBER', pattern = 'CROSSWASH', eventCount = 128 }) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const bankH = canvas.height - HEADER_H - FOOTER_H
  const theme = THEME
  const colors = modePalette(theme, mode)
  ctx.fillStyle = 'rgb(0 0 0 / 1)'
  ctx.fillRect(0, 0, W, canvas.height)

  // Header (mirrors BlinkenPane DOM chrome)
  font(ctx, 9, 'bold')
  text(ctx, 'B L I N K E N B A R', 8, 12, theme.text, 0.92)
  font(ctx, 7, '500')
  text(ctx, 'LIVE MESH · PASSIVE TELEMETRY', 8, 24, theme.text3, 0.62)
  ctx.fillStyle = color(theme.stroke, 0.5)
  ctx.fillRect(0, HEADER_H - 1, W, 1)

  // Bank
  ctx.save()
  ctx.translate(0, HEADER_H)
  const state = { entities: roster(t), eventCount, lastEventAt: NOW }
  drawMatrixBank(ctx, W, bankH, state, METRICS, theme, colors, pattern, t * 1000, {})
  ctx.restore()

  // Footer (mirrors BlinkenCanvas chrome)
  const footY = canvas.height - 10
  ctx.fillStyle = 'rgb(0 0 0 / 0.96)'
  ctx.fillRect(0, canvas.height - FOOTER_H, W, FOOTER_H)
  ctx.fillStyle = color(theme.stroke, 0.35)
  ctx.fillRect(5, canvas.height - FOOTER_H, W - 10, 1)
  font(ctx, 7, '500')
  text(ctx, `${eventCount} EVT`, 8, footY, theme.text3, 0.5)
  text(ctx, '8HZ · PASSIVE', W - 8, footY, theme.text3, 0.5, 'right')
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }) }

// --- CLI -------------------------------------------------------------------
// shot <out.png> <mode> <pattern> <tSeconds> [WxH]
// frames <outDir> <fps> <seconds> [mode] [pattern] [WxH]
const [, , cmd, ...args] = process.argv
if (cmd === 'shot') {
  const [out, mode = 'EMBER', pattern = 'CROSSWASH', t = 4, size = '360x480'] = args
  const [w, h] = size.split('x').map(Number)
  const canvas = createCanvas(w, h)
  paintFrame(canvas, { t: Number(t), mode, pattern })
  ensureDir(path.dirname(path.resolve(out)))
  fs.writeFileSync(out, canvas.toBuffer('image/png'))
  console.log('wrote', out)
} else if (cmd === 'frames') {
  const [outDir, fps = 8, seconds = 12, mode = 'EMBER', pattern = 'CROSSWASH', size = '360x480'] = args
  const [w, h] = size.split('x').map(Number)
  const canvas = createCanvas(w, h)
  ensureDir(outDir)
  const frames = Math.round(Number(fps) * Number(seconds))
  for (let i = 0; i < frames; i++) {
    const t = (i / Number(fps)) % Number(seconds)
    paintFrame(canvas, { t, mode, pattern, eventCount: 96 + i * 3 })
    fs.writeFileSync(path.join(outDir, `frame_${String(i).padStart(3, '0')}.png`), canvas.toBuffer('image/png'))
  }
  console.log('wrote', frames, 'frames to', outDir)
} else {
  console.error('usage: render.js shot <out> [mode] [pattern] [t] [WxH] | frames <dir> <fps> <sec> [mode] [pattern] [WxH]')
  process.exit(1)
}
