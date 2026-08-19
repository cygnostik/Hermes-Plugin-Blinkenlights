import {
  PALETTE_AREA,
  STATUSBAR_AREAS,
  Tip,
  atom,
  cn,
  haptic,
  host,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'blinkenbar'
const MAX_ENTITIES = 18
const MAX_METADATA_CHARS = 48
const RETAIN_DONE_MS = 45000
const $mesh = atom({ entities: [], eventCount: 0, lastEventAt: 0 })
const $identity = atom({ label: 'AGENT' })

const safe = (value, limit = 72) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
const safeMetadata = value => safe(value, MAX_METADATA_CHARS)
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0))
const shortId = value => safe(value, 20).slice(-6).toUpperCase() || 'LOCAL'

function classifyTool(name) {
  const value = safe(name).toLowerCase()
  if (/^(read|search|list|get|recall|reflect|skill_view|session_search)/.test(value)) return 'reading'
  if (/^(write|patch|edit|create|update|delete|retain|skill_manage|memory)/.test(value)) return 'writing'
  if (/^(web|browser|maps)/.test(value)) return 'browsing'
  if (/^(terminal|process|execute|run)/.test(value)) return 'terminal'
  if (/^(image|video|vision|audio|text_to_speech)/.test(value)) return 'studio'
  if (/^(delegate|cron|todo)/.test(value)) return 'planning'
  if (/clarify|approval|sudo|secret/.test(value)) return 'waiting'
  return 'working'
}

function mutate(mutator) {
  const current = $mesh.get()
  const next = {
    entities: current.entities.map(entity => ({ ...entity })),
    eventCount: current.eventCount,
    lastEventAt: current.lastEventAt
  }
  mutator(next)
  $mesh.set(next)
}

function displayName({ isMain, profile, sessionId, subId, index }) {
  if (isMain) {
    const active = host.state.activeSessionId.get()
    if (!sessionId || sessionId === 'draft' || sessionId === active) return $identity.get().label
    return `AGENT·${shortId(sessionId)}`
  }
  return `SUB·${shortId(subId || String(index + 1))}`
}

function configureIdentity(ctx) {
  const current = $identity.get().label
  const requested = globalThis.prompt?.('Blinkenbar agent label', current)
  if (requested == null) return
  const label = safe(requested, 20).toUpperCase() || 'AGENT'
  ctx.storage.set('agentLabel', label)
  $identity.set({ label })
  mutate(state => {
    const active = host.state.activeSessionId.get()
    state.entities.forEach(entity => {
      if (entity.isMain && (entity.sessionId === active || (!active && entity.sessionId === 'draft'))) entity.name = label
    })
  })
  host.notify({ kind: 'success', message: `Blinkenbar agent label set to ${label}.` })
}

function boundEntities(state, retainedId = '') {
  const activeSession = safe(host.state.activeSessionId.get())
  const activeProfile = safe(host.state.profile.get()) || 'default'
  while (state.entities.length > MAX_ENTITIES) {
    const candidates = state.entities
      .filter(entity => entity.id !== retainedId && !(entity.isMain && entity.sessionId === activeSession && entity.profile === activeProfile))
      .sort((a, b) => {
        const aLive = a.status === 'active' || a.status === 'waiting' ? 1 : 0
        const bLive = b.status === 'active' || b.status === 'waiting' ? 1 : 0
        return aLive - bLive || a.lastSeen - b.lastSeen || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      })
    if (!candidates.length) break
    state.entities = state.entities.filter(entity => entity.id !== candidates[0].id)
  }
}

function redactEntityMetadata(entity) {
  entity.goal = ''
  entity.tool = ''
}

function ensureEntity(state, id, options = {}) {
  let entity = state.entities.find(item => item.id === id)
  if (entity) return entity
  const index = state.entities.length
  entity = {
    id,
    parentId: options.parentId || '',
    depth: Number(options.depth || 0),
    isMain: Boolean(options.isMain),
    profile: options.profile || '',
    sessionId: options.sessionId || '',
    childSessionId: options.childSessionId || '',
    subId: options.subId || '',
    name: displayName({ ...options, index }),
    model: safe(options.model),
    goal: safeMetadata(options.goal),
    detail: '',
    tool: '',
    activity: options.isMain ? 'idle' : 'planning',
    status: options.isMain ? 'idle' : 'queued',
    lastSeen: Date.now(),
    pulseAt: Date.now(),
    pulse: options.isMain ? 0.12 : 0.55,
    expiresAt: 0,
    order: index
  }
  state.entities.push(entity)
  boundEntities(state, id)
  return entity
}

function ensureMain(sessionId, profile = '', model = '') {
  const sid = sessionId || 'draft'
  mutate(state => {
    if (sid !== 'draft') {
      state.entities = state.entities.filter(entity => !(entity.isMain && entity.profile === profile && entity.sessionId === 'draft'))
    }
    const id = `main:${profile || 'default'}:${sid}`
    const entity = ensureEntity(state, id, { isMain: true, model, profile, sessionId: sid })
    entity.name = displayName({ isMain: true, profile, sessionId: sid, index: entity.order })
    entity.model = safe(model) || entity.model
    entity.lastSeen = Date.now()
  })
}

function eventSession(event, payload) {
  return safe(event?.session_id) || safe(payload?.session_id) || safe(host.state.activeSessionId.get()) || 'draft'
}

function ingest(event) {
  if (!event || typeof event.type !== 'string') return
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
  const type = event.type
  const now = Date.now()
  const profile = safe(event.profile) || safe(host.state.profile.get()) || 'default'
  const sid = eventSession(event, payload)
  const isChild = type.startsWith('subagent.')
  const subId = safe(payload.subagent_id) || safe(payload.child_session_id) || `task-${payload.task_index ?? 0}`
  const parentSubId = safe(payload.parent_id)
  const id = isChild ? `sub:${sid}:${subId}` : `main:${profile}:${sid}`
  const parentId = isChild
    ? parentSubId && parentSubId !== sid
      ? `sub:${sid}:${parentSubId}`
      : `main:${profile}:${sid}`
    : ''

  mutate(state => {
    state.eventCount += 1
    state.lastEventAt = now
    const entity = ensureEntity(state, id, {
      childSessionId: safe(payload.child_session_id),
      depth: isChild ? Number(payload.depth || 1) : 0,
      goal: safeMetadata(payload.goal),
      isMain: !isChild,
      model: safe(payload.model) || safe(host.state.model.get()),
      parentId,
      profile,
      sessionId: sid,
      subId
    })
    entity.lastSeen = now
    entity.expiresAt = 0
    entity.parentId = parentId || entity.parentId
    entity.depth = isChild ? Math.max(1, Number(payload.depth || entity.depth || 1)) : 0
    entity.model = safe(payload.model) || entity.model
    entity.goal = safeMetadata(payload.goal) || entity.goal
    entity.childSessionId = safe(payload.child_session_id) || entity.childSessionId
    entity.pulseAt = now
    entity.pulse = Math.min(1, entity.pulse + 0.46)

    if (type === 'message.start') {
      entity.status = 'active'; entity.activity = 'thinking'; entity.detail = 'turn started'; entity.pulse = 1
    } else if (/^(reasoning|thinking)\./.test(type)) {
      entity.status = 'active'; entity.activity = 'thinking'; entity.detail = 'reasoning'
    } else if (type === 'tool.generating' || type === 'tool.start' || type === 'tool.progress') {
      entity.status = 'active'; entity.tool = safe(payload.name) || entity.tool || 'tool'
      entity.activity = classifyTool(entity.tool); entity.detail = entity.tool; entity.pulse = 1
    } else if (type === 'tool.complete') {
      entity.status = 'active'; entity.activity = 'thinking'; entity.detail = `${safe(payload.name) || entity.tool || 'tool'} complete`; entity.tool = ''
    } else if (type === 'message.complete') {
      const failed = /error|fail/.test(safe(payload.status).toLowerCase())
      entity.status = failed ? 'error' : 'done'; entity.activity = failed ? 'waiting' : 'done'
      entity.detail = failed ? 'turn failed' : 'turn complete'; entity.pulse = 1
      redactEntityMetadata(entity)
    } else if (type === 'error') {
      entity.status = 'error'; entity.activity = 'waiting'; entity.detail = 'attention required'; entity.pulse = 1
      redactEntityMetadata(entity)
    } else if (/^(clarify|approval|sudo|secret)\.request$/.test(type)) {
      entity.status = 'waiting'; entity.activity = 'waiting'; entity.detail = 'operator input'; entity.pulse = 1
    } else if (type === 'subagent.spawn_requested') {
      entity.status = 'queued'; entity.activity = 'planning'; entity.detail = 'queued'; entity.pulse = 0.72
    } else if (type === 'subagent.start') {
      entity.status = 'active'; entity.activity = 'thinking'; entity.detail = 'delegated mission'; entity.pulse = 1
    } else if (type === 'subagent.thinking') {
      entity.status = 'active'; entity.activity = 'thinking'; entity.detail = 'reasoning'
    } else if (type === 'subagent.tool') {
      entity.status = 'active'; entity.tool = safe(payload.tool_name) || safe(payload.name) || 'tool'
      entity.activity = classifyTool(entity.tool); entity.detail = entity.tool; entity.pulse = 1
    } else if (type === 'subagent.progress' || type === 'subagent.text') {
      entity.status = 'active'; entity.detail = safeMetadata(payload.preview) || 'in progress'
    } else if (type === 'subagent.complete') {
      const failed = /error|fail/.test(safe(payload.status).toLowerCase())
      entity.status = failed ? 'error' : 'done'; entity.activity = failed ? 'waiting' : 'done'
      entity.detail = failed ? 'mission failed' : 'mission complete'; entity.pulse = 1
      entity.expiresAt = entity.id.includes(':demo-') ? 0 : now + RETAIN_DONE_MS
      redactEntityMetadata(entity)
    }
    boundEntities(state)
  })
}

function orderedEntities(state) {
  const entities = state.entities
  const activeSession = host.state.activeSessionId.get()
  const roots = entities
    .filter(entity => entity.isMain)
    .sort((a, b) => Number(b.sessionId === activeSession) - Number(a.sessionId === activeSession) || b.lastSeen - a.lastSeen)
  const output = []
  const seen = new Set()
  const appendTree = root => {
    if (!root || seen.has(root.id)) return
    seen.add(root.id); output.push(root)
    entities
      .filter(entity => entity.parentId === root.id)
      .sort((a, b) => a.order - b.order)
      .forEach(appendTree)
  }
  roots.forEach(appendTree)
  entities.filter(entity => !seen.has(entity.id)).sort((a, b) => a.order - b.order).forEach(appendTree)
  return output
}

function runSignalTest() {
  const sid = host.state.activeSessionId.get() || 'demo'
  const profile = host.state.profile.get() || 'default'
  ingest({ type: 'message.start', session_id: sid, profile, payload: {} })
  const activities = ['web_search', 'write_file', 'terminal', 'image_generate']
  activities.forEach((tool, index) => {
    const subagent_id = `demo-${index}`
    ingest({ type: 'subagent.start', session_id: sid, profile, payload: { depth: 1, goal: ['Reconnaissance', 'Interface build', 'System verification', 'Visual synthesis'][index], subagent_id } })
    ingest({ type: 'subagent.tool', session_id: sid, profile, payload: { depth: 1, subagent_id, tool_name: tool } })
  })
  ingest({ type: 'subagent.start', session_id: sid, profile, payload: { depth: 2, goal: 'Nested verification', parent_id: 'demo-2', subagent_id: 'demo-nested' } })
  ingest({ type: 'subagent.tool', session_id: sid, profile, payload: { depth: 2, parent_id: 'demo-2', subagent_id: 'demo-nested', tool_name: 'read_file' } })
  haptic('tap')
  host.notify({ kind: 'info', message: 'Blinkenbar signal test is live. Real gateway events use the same reducer.' })
}

function parseColor(value) {
  const raw = String(value || '').trim()
  const values = raw.match(/-?[\d.]+/g)
  if (!values || values.length < 3) return [128, 128, 128]
  const channels = values.slice(0, 3).map(Number)
  const normalized = /^color\(\s*(?:srgb|display-p3)\b/i.test(raw)
  return channels.map(channel => clamp(normalized ? channel * 255 : channel, 0, 255))
}

const mix = (a, b, t) => a.map((value, index) => value * (1 - t) + b[index] * t)
const color = (rgb, alpha = 1) => `rgb(${Math.round(rgb[0])} ${Math.round(rgb[1])} ${Math.round(rgb[2])} / ${clamp(alpha)})`

function resolveTheme() {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;pointer-events:none;opacity:0;color:var(--ui-text-primary)'
  document.body.appendChild(probe)
  const read = name => {
    probe.style.color = `var(${name})`
    return parseColor(getComputedStyle(probe).color)
  }
  const theme = {
    accent: read('--ui-accent'), accent2: read('--ui-accent-secondary'), bg: read('--ui-bg-editor'),
    blue: read('--ui-blue'), card: read('--ui-bg-card'), chrome: read('--ui-bg-chrome'),
    cyan: read('--ui-cyan'), elevated: read('--ui-bg-elevated'), green: read('--ui-green'),
    orange: read('--ui-orange'), purple: read('--ui-purple'), red: read('--ui-red'),
    stroke: read('--ui-stroke-secondary'), text: read('--ui-text-primary'),
    text2: read('--ui-text-secondary'), text3: read('--ui-text-tertiary'), yellow: read('--ui-yellow')
  }
  probe.remove()
  return theme
}

const MODES = ['EMBER', 'ION', 'VIOLET', 'MATRIX', 'THEME']
const PATTERNS = ['CROSSWASH', 'STOCHASTIC', 'SHIFT', 'QUIET']
const PIXEL_SCALE = 1.5
const PIXEL_GAP = 2
const BLACK = [0, 0, 0]

function modePalette(theme, mode) {
  if (mode === 'ION') return { primary: theme.cyan, secondary: theme.blue, hot: theme.text, wait: theme.yellow }
  if (mode === 'VIOLET') return { primary: theme.purple, secondary: theme.cyan, hot: theme.text, wait: theme.yellow }
  if (mode === 'MATRIX') return { primary: theme.green, secondary: mix(theme.green, theme.cyan, 0.28), hot: theme.text, wait: theme.yellow }
  if (mode === 'THEME') return { primary: theme.accent, secondary: theme.accent2, hot: theme.text, wait: theme.yellow }
  return { primary: theme.red, secondary: theme.orange, hot: theme.yellow, wait: theme.yellow }
}

function hash32(a, b = 0, c = 0) {
  let value = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  value = (value ^ (value >>> 13)) * 1274126177
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

function ambient(pattern, cell, count, row, time) {
  if (pattern === 'QUIET') return 0.035 + 0.035 * Math.sin(time * 0.00045 + cell * 0.42 + row)
  if (pattern === 'STOCHASTIC') {
    const frame = Math.floor(time / 120)
    return hash32(row + 1, cell + 7, frame) > 0.75 ? 0.34 + hash32(cell, frame, row) * 0.26 : 0.025
  }
  if (pattern === 'SHIFT') {
    const head = ((time * 0.009 + row * 3.7) % (count + 12)) - 6
    const distance = Math.abs(cell - head)
    const second = Math.abs(cell - (((time * 0.005 + row * 8.3 + count * 0.55) % (count + 16)) - 8))
    return Math.max(0.025, 0.48 * Math.exp(-distance * 0.72), 0.28 * Math.exp(-second * 0.55))
  }
  // Two packet trains cross with asymmetric fading tails.
  const cycle = count + 14
  const leftHead = ((time * (0.006 + (row % 3) * 0.00055) + row * 5.2) % cycle) - 7
  const rightHead = count - 1 - (((time * (0.0054 + (row % 4) * 0.00042) + row * 8.1) % cycle) - 7)
  const left = 0.5 * Math.exp(-Math.abs(cell - leftHead) * (cell <= leftHead ? 0.42 : 0.9))
  const right = 0.46 * Math.exp(-Math.abs(cell - rightHead) * (cell >= rightHead ? 0.42 : 0.9))
  const sparkle = hash32(row, cell, Math.floor(time / 480)) > 0.91 ? 0.16 : 0
  return Math.max(0.022, left, right, sparkle)
}

function activitySignal(entity, cell, count, row, time) {
  const age = Math.max(0, Date.now() - entity.pulseAt)
  const pulse = entity.pulse * Math.exp(-age / 1550)
  if (entity.status === 'waiting' || entity.status === 'error') {
    return 0.28 + 0.68 * Math.pow((Math.sin(time * 0.005) + 1) / 2, 2)
  }
  if (entity.activity === 'done') {
    const head = ((time * 0.016 + row * 2) % (count + 8)) - 4
    return Math.max(0.08, 0.92 * Math.exp(-Math.abs(cell - head) * 0.55) * pulse)
  }
  if (entity.status !== 'active' && entity.status !== 'queued') return 0
  const speed = entity.activity === 'thinking' ? 0.008 : entity.activity === 'terminal' ? 0.014 : 0.011
  const head = ((time * speed + row * 4.7) % (count + 10)) - 5
  const reverse = count - 1 - (((time * speed * 0.63 + row * 7.9) % (count + 14)) - 7)
  const packet = Math.max(Math.exp(-Math.abs(cell - head) * 0.72), 0.65 * Math.exp(-Math.abs(cell - reverse) * 0.9))
  const bits = hash32(row + 13, cell, Math.floor(time / (entity.activity === 'terminal' ? 90 : 220)))
  const density = entity.activity === 'thinking' ? 0.54 : entity.activity === 'browsing' ? 0.68 : 0.6
  return Math.max(packet * (0.42 + pulse * 0.58), bits > density ? 0.25 + 0.5 * pulse : 0.055)
}

function lamp(ctx, x, y, width, height, rgb, intensity, dark, edge) {
  const value = clamp(intensity)
  ctx.fillStyle = color(mix(dark, edge, 0.15), 0.98)
  ctx.fillRect(x, y, width, height)
  ctx.fillStyle = color(mix(dark, rgb, 0.22 + value * 0.38), 0.48 + value * 0.45)
  ctx.fillRect(x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2))
  if (value > 0.08) {
    ctx.fillStyle = color(rgb, value * 0.18)
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2)
    ctx.fillStyle = color(mix(rgb, [255, 255, 255], value * 0.28), 0.22 + value * 0.78)
    ctx.fillRect(x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2))
    if (value > 0.66) {
      ctx.fillStyle = color(mix(rgb, [255, 255, 255], 0.62), value * 0.82)
      ctx.fillRect(x + 2, y + 1, Math.max(1, width - 4), 1)
    }
  }
}

function font(ctx, size = 9, tone = '') {
  ctx.font = `${tone} ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`
  ctx.textBaseline = 'middle'
}

function text(ctx, value, x, y, rgb, alpha = 1, align = 'left') {
  ctx.textAlign = align
  ctx.fillStyle = color(rgb, alpha)
  ctx.fillText(value, x, y)
}

function entityColor(entity, theme, colors) {
  if (entity.status === 'error') return theme.red
  if (entity.status === 'waiting') return colors.wait
  if (entity.activity === 'writing') return colors.secondary
  if (entity.activity === 'studio') return theme.purple
  if (entity.activity === 'browsing') return theme.cyan
  if (entity.activity === 'terminal') return theme.orange
  return colors.primary
}

function prepareBankBackdrop(cache, width, height, grid, theme) {
  const key = [
    Math.floor(width), Math.floor(height), grid.x, grid.cols, grid.rows,
    grid.lampW, grid.gapX, grid.gapY, PIXEL_SCALE, ...theme.stroke.map(Math.round)
  ].join(':')
  if (cache.key === key && cache.canvas) return cache.canvas

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width))
  canvas.height = Math.max(1, Math.floor(height))
  const backdrop = canvas.getContext('2d', { alpha: false })
  backdrop.fillStyle = color(BLACK, 1)
  backdrop.fillRect(0, 0, canvas.width, canvas.height)
  backdrop.fillStyle = color(mix(BLACK, theme.stroke, 0.01828125), 0.98)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      backdrop.fillRect(
        grid.x + col * grid.colStride,
        grid.y + row * grid.rowStride,
        grid.lampW,
        grid.lampH
      )
    }
  }
  cache.key = key
  cache.canvas = canvas
  cache.styles = new Map()
  return canvas
}

function paintBankLamp(ctx, x, y, width, height, rgb, intensity, theme, cache) {
  const level = Math.min(7, Math.floor(clamp(intensity) * 8))
  if (level < 1) return
  const rgbKey = `${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])}`
  const key = `${rgbKey}:${level}`
  let style = cache.styles.get(key)
  if (!style) {
    style = color(mix(BLACK, rgb, 0.25 + level * 0.095), 0.9)
    cache.styles.set(key, style)
  }
  // A fill halo avoids the cost and blur of canvas filters.
  if (level >= 4) {
    const haloKey = `${rgbKey}:halo:${level}`
    let halo = cache.styles.get(haloKey)
    if (!halo) {
      halo = color(rgb, 0.075 + level * 0.015)
      cache.styles.set(haloKey, halo)
    }
    ctx.fillStyle = halo
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2)
  }
  ctx.fillStyle = style
  ctx.fillRect(x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2))
  if (level >= 6) {
    const hotKey = `${rgbKey}:hot`
    let hot = cache.styles.get(hotKey)
    if (!hot) {
      hot = color(mix(rgb, [255, 255, 255], 0.48), 0.92)
      cache.styles.set(hotKey, hot)
    }
    ctx.fillStyle = hot
    ctx.fillRect(x + 2, y + 1, Math.max(1, width - 4), 1)
  }
}

function allocateBanks(entities, rowsAvailable, systemRows) {
  const banks = []
  let cursor = systemRows
  let remaining = Math.max(0, rowsAvailable - cursor)
  for (const entity of entities) {
    const preferred = entity.isMain ? 12 : entity.depth > 1 ? 3 : 5
    const minimum = entity.isMain ? 6 : entity.depth > 1 ? 2 : 3
    if (remaining < minimum) break
    const rows = Math.min(preferred, remaining)
    banks.push({ entity, start: cursor, rows })
    cursor += rows
    remaining -= rows
  }
  // Give unused rows to the lead bank when the roster is sparse.
  if (remaining > 3 && banks.length) {
    const lead = banks.find(bank => bank.entity.isMain) || banks[0]
    const extra = Math.min(6, remaining)
    lead.rows += extra
    for (const bank of banks) {
      if (bank === lead) continue
      bank.start += extra
    }
  }
  return { banks, usedRows: banks.reduce((max, bank) => Math.max(max, bank.start + bank.rows), systemRows) }
}

function drawBankLabel(ctx, bank, grid, theme, metrics) {
  const top = grid.y + bank.start * grid.rowStride
  const height = bank.rows * grid.rowStride - grid.gapY
  const depth = bank.entity?.depth || 0
  const inset = 5 + Math.min(18, depth * 6)
  const scrimWidth = Math.min(98, 70 + depth * 6)

  const fade = ctx.createLinearGradient(0, 0, scrimWidth, 0)
  fade.addColorStop(0, color(BLACK, 0.96))
  fade.addColorStop(0.62, color(BLACK, 0.8))
  fade.addColorStop(1, color(BLACK, 0))
  ctx.fillStyle = fade
  ctx.fillRect(0, top, scrimWidth, height)

  ctx.fillStyle = color(theme.stroke, 0.36)
  ctx.fillRect(inset, top + 2, 1, Math.max(2, height - 4))
  ctx.fillRect(inset, top + 2, 5, 1)
  ctx.fillRect(inset, top + height - 3, 5, 1)

  if (!bank.entity) {
    font(ctx, 8, '600')
    text(ctx, 'MACHINE', inset + 7, top + height * 0.38, theme.text, 0.56)
    font(ctx, 7, '500')
    const ioMbps = ((Number(metrics?.io?.read_bps || 0) + Number(metrics?.io?.write_bps || 0)) / 1048576).toFixed(0)
    const gpu = metrics?.gpu?.available === false ? '--' : String(Math.round(Number(metrics?.gpu?.util || 0))).padStart(2, '0')
    text(ctx, `C${String(Math.round(Number(metrics?.cpu || 0))).padStart(2, '0')} M${String(Math.round(Number(metrics?.memory || 0))).padStart(2, '0')}`, inset + 7, top + height * 0.57, theme.text2, 0.5)
    text(ctx, `I${String(ioMbps).padStart(2, '0')}M G${gpu}`, inset + 7, top + height * 0.72, theme.text3, 0.48)
    return
  }

  const entity = bank.entity
  const detail = entity.status === 'active' ? entity.activity : entity.status
  font(ctx, depth > 1 ? 7 : 8, '600')
  text(ctx, entity.name.toUpperCase(), inset + 7, top + height * 0.44, theme.text, entity.status === 'idle' ? 0.38 : 0.58)
  font(ctx, 7, '500')
  text(ctx, detail.toUpperCase(), inset + 7, top + height * 0.62, theme.text3, 0.42)
}

function drawMatrixBank(ctx, width, height, state, metrics, theme, colors, pattern, time, cache) {
  const lampSize = Math.max(5, Math.round(5 * PIXEL_SCALE))
  const grid = {
    x: 0,
    y: 4,
    gapX: PIXEL_GAP,
    gapY: PIXEL_GAP,
    lampW: lampSize,
    lampH: lampSize,
    rowStride: lampSize + PIXEL_GAP
  }
  const availableWidth = Math.max(120, width - 10)
  grid.cols = Math.max(6, Math.floor((availableWidth + grid.gapX) / (lampSize + grid.gapX)))
  grid.colStride = grid.lampW + grid.gapX
  const usableWidth = grid.cols * grid.lampW + (grid.cols - 1) * grid.gapX
  // Left-align with the label brackets and footer rule; leftover pixels fall right.
  grid.x = 5
  grid.rows = Math.max(8, Math.floor((height - 21 - grid.y) / grid.rowStride))
  ctx.drawImage(prepareBankBackdrop(cache, width, height, grid, theme), 0, 0, width, height)

  const entities = orderedEntities(state)
  // Two full LED rows per resource (CPU, memory, I/O, GPU).
  const systemRows = Math.min(8, grid.rows)
  const allocation = allocateBanks(entities, grid.rows, systemRows)
  const system = { entity: null, start: 0, rows: systemRows }
  const allBanks = [system, ...allocation.banks]
  const bankByRow = new Array(grid.rows).fill(null)
  allBanks.forEach(bank => {
    for (let row = bank.start; row < Math.min(grid.rows, bank.start + bank.rows); row++) bankByRow[row] = bank
  })

  const values = [
    clamp(metrics?.cpu / 100),
    clamp(metrics?.memory / 100),
    clamp(metrics?.io?.activity / 100),
    clamp(metrics?.gpu?.util / 100)
  ]
  const systemColors = [colors.primary, colors.secondary, theme.orange, theme.purple]

  for (let row = 0; row < grid.rows; row++) {
    const bank = bankByRow[row]
    const localRow = bank ? row - bank.start : row
    const systemIndex = bank === system ? Math.min(3, Math.floor((localRow * 4) / Math.max(1, system.rows))) : -1
    const rowSeed = bank?.entity ? (hashText(bank.entity.id) + localRow * 31) % 10007 : row + 1901
    const baseColor = bank?.entity ? entityColor(bank.entity, theme, colors) : systemIndex >= 0 ? systemColors[systemIndex] : colors.primary
    for (let col = 0; col < grid.cols; col++) {
      const idle = ambient(pattern, col, grid.cols, rowSeed, time)
      let signal = 0
      if (systemIndex >= 0) {
        const position = col / Math.max(1, grid.cols - 1)
        signal = position <= values[systemIndex] ? 0.32 + values[systemIndex] * 0.68 : 0
      } else if (bank?.entity) {
        const grain = 0.72 + hash32(rowSeed, col, 17) * 0.28
        signal = activitySignal(bank.entity, col, grid.cols, rowSeed, time) * grain
      }
      const rgb = bank?.entity && hash32(rowSeed, col, 3) > 0.86 ? mix(baseColor, colors.secondary, 0.32) : baseColor
      paintBankLamp(
        ctx,
        grid.x + col * grid.colStride,
        grid.y + row * grid.rowStride,
        grid.lampW,
        grid.lampH,
        rgb,
        Math.max(idle * (bank ? 1 : 0.62), signal),
        theme,
        cache
      )
    }
  }

  ctx.fillStyle = color(theme.stroke, 0.26)
  allBanks.forEach(bank => {
    const y = grid.y + (bank.start + bank.rows) * grid.rowStride - 1
    ctx.fillRect(grid.x, y, usableWidth, 1)
  })
  allBanks.forEach(bank => drawBankLabel(ctx, bank, grid, theme, metrics))

  const hits = allocation.banks.map(bank => ({
    entity: bank.entity,
    x: 0,
    y: grid.y + bank.start * grid.rowStride,
    w: width,
    h: bank.rows * grid.rowStride
  }))
  return { hits, overflow: Math.max(0, entities.length - allocation.banks.length), visible: allocation.banks.length }
}

function BlinkenCanvas({ metrics, mode, pattern }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const state = useValue($mesh)
  const stateRef = useRef(state)
  const metricsRef = useRef(metrics)
  const modeRef = useRef(mode)
  const patternRef = useRef(pattern)
  const themeRef = useRef(null)
  const bankCacheRef = useRef({})
  const hitsRef = useRef([])

  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { metricsRef.current = metrics }, [metrics])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { patternRef.current = pattern }, [pattern])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return undefined
    const ctx = canvas.getContext('2d', { alpha: false })
    let cssWidth = 1
    let cssHeight = 1
    let dpr = 1
    let frame = 0
    let stopped = false
    let visible = true
    let lastPaint = 0

    const refreshTheme = () => { themeRef.current = resolveTheme() }
    refreshTheme()

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      cssWidth = Math.max(1, Math.floor(rect.width))
      cssHeight = Math.max(1, Math.floor(rect.height))
      // One internal pixel per CSS pixel keeps the dense bank cheap; Chromium
      // scales the canvas with nearest-neighbour rendering on high-DPI screens.
      dpr = 1
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(wrap)
    const themeObserver = new MutationObserver(refreshTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    const intersection = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting) })
    intersection.observe(wrap)
    resize()

    const render = time => {
      if (stopped) return
      frame = requestAnimationFrame(render)
      if (!visible || time - lastPaint < 120) return
      lastPaint = time
      const theme = themeRef.current || resolveTheme()
      const colors = modePalette(theme, modeRef.current)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const bank = drawMatrixBank(
        ctx,
        cssWidth,
        cssHeight,
        stateRef.current,
        metricsRef.current || {},
        theme,
        colors,
        patternRef.current,
        time,
        bankCacheRef.current
      )
      hitsRef.current = bank.hits

      const footerY = cssHeight - 10
      ctx.fillStyle = color(BLACK, 0.96)
      ctx.fillRect(0, cssHeight - 19, cssWidth, 19)
      ctx.fillStyle = color(theme.stroke, 0.35)
      ctx.fillRect(5, cssHeight - 19, cssWidth - 10, 1)
      font(ctx, 7, '500')
      text(ctx, `${stateRef.current.eventCount} EVT${bank.overflow ? ` · +${bank.overflow}` : ''}`, 8, footerY, theme.text3, 0.5)
      text(ctx, '8HZ · PASSIVE', cssWidth - 8, footerY, theme.text3, 0.5, 'right')
    }
    frame = requestAnimationFrame(render)

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      intersection.disconnect()
    }
  }, [])

  const inspect = event => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const hit = [...hitsRef.current].reverse().find(item => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h)
    if (!hit) return
    const entity = hit.entity
    haptic('tap')
    host.notify({
      kind: entity.status === 'error' ? 'error' : 'info',
      title: `${entity.name} · ${entity.status.toUpperCase()}`,
      message: entity.goal || entity.detail || `${entity.activity} · ${entity.model || shortId(entity.sessionId)}`
    })
  }

  return jsx('div', {
    ref: wrapRef,
    className: 'min-h-0 flex-1 overflow-hidden',
    children: jsx('canvas', {
      ref: canvasRef,
      onClick: inspect,
      className: 'block h-full w-full cursor-crosshair',
      style: { imageRendering: 'pixelated' }
    })
  })
}

function TinyControl({ label, title, onClick }) {
  return jsx('button', {
    type: 'button',
    title,
    onClick,
    className: cn(
      'h-5 rounded-sm border border-(--ui-stroke-secondary) px-1.5 font-mono text-[0.55rem] font-semibold tracking-[0.08em]',
      'text-(--ui-text-secondary) transition-colors hover:border-(--ui-accent) hover:bg-(--chrome-action-hover) hover:text-foreground'
    ),
    children: label
  })
}

function BlinkenPane({ ctx }) {
  const [mode, setMode] = useState(() => ctx.storage.get('mode', 'EMBER'))
  const [pattern, setPattern] = useState(() => ctx.storage.get('pattern', 'CROSSWASH'))
  const gateway = useValue(host.state.gateway)
  const metricsQuery = useQuery({
    queryKey: [ID, 'metrics'],
    queryFn: () => ctx.rest('/metrics', { timeoutMs: 1500 }),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: 1
  })

  const cycleMode = () => {
    const next = MODES[(Math.max(0, MODES.indexOf(mode)) + 1) % MODES.length]
    setMode(next); ctx.storage.set('mode', next); haptic('tap')
  }
  const cyclePattern = () => {
    const next = PATTERNS[(Math.max(0, PATTERNS.indexOf(pattern)) + 1) % PATTERNS.length]
    setPattern(next); ctx.storage.set('pattern', next); haptic('tap')
  }
  const relinkTelemetry = async () => {
    haptic('tap')
    try {
      const desktop = globalThis.window?.hermesDesktop
      if (desktop?.getConnectionConfig && desktop?.applyConnectionConfig) {
        const config = await desktop.getConnectionConfig()
        await desktop.applyConnectionConfig(config)
        host.notify({ kind: 'success', message: 'Hermes backend reconnected. Blinkenbar telemetry will resume automatically.' })
      } else {
        await host.restartGateway()
        host.notify({ kind: 'success', message: 'Gateway restarted. Blinkenbar telemetry will reconnect automatically.' })
      }
    } catch (error) {
      host.notifyError(error, 'Could not reconnect Blinkenbar telemetry')
    }
  }

  return jsxs('section', {
    className: 'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden',
    children: [
      jsxs('header', {
        className: 'flex shrink-0 items-center gap-1.5 border-b border-(--ui-stroke-secondary) px-2 py-1.5',
        children: [
          jsxs('div', {
            className: 'min-w-0 flex-1',
            children: [
              jsx('div', { className: 'truncate font-mono text-[0.65rem] font-bold tracking-[0.18em]', children: 'BLINKENBAR' }),
              jsx('div', {
                className: 'truncate font-mono text-[0.5rem] text-(--ui-text-quaternary)',
                children: `${gateway === 'open' ? 'LIVE MESH' : String(gateway).toUpperCase()} · ${metricsQuery.error ? 'TELEMETRY OFFLINE' : metricsQuery.data?.degraded ? 'TELEMETRY DEGRADED' : 'PASSIVE TELEMETRY'}`
              })
            ]
          }),
          metricsQuery.error ? jsx(TinyControl, { label: 'LINK', title: 'Restart gateway and load local telemetry backend', onClick: relinkTelemetry }) : null,
          jsx(TinyControl, { label: mode, title: 'Cycle color mode', onClick: cycleMode }),
          jsx(TinyControl, { label: pattern === 'STOCHASTIC' ? 'RANDOM' : pattern === 'CROSSWASH' ? 'CROSS' : pattern, title: 'Cycle idle fill pattern', onClick: cyclePattern })
        ]
      }),
      jsx(BlinkenCanvas, { metrics: metricsQuery.data || {}, mode, pattern })
    ]
  })
}

function StatusChip() {
  const state = useValue($mesh)
  const active = state.entities.filter(entity => entity.status === 'active' || entity.status === 'waiting').length
  const attention = state.entities.some(entity => entity.status === 'waiting' || entity.status === 'error')
  return jsx(Tip, {
    label: 'Blinkenbar live agent mesh',
    children: jsxs('button', {
      type: 'button',
      onClick: runSignalTest,
      className: cn('inline-flex h-full items-center gap-1.5 px-1.5 font-mono text-[0.62rem] text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'),
      children: [
        jsx('span', { className: cn('inline-block size-1.5', attention ? 'bg-(--ui-yellow)' : active ? 'bg-(--ui-green)' : 'bg-(--ui-text-quaternary)') }),
        jsx('span', { children: `BLINK ${active}` })
      ]
    })
  })
}

function installBridge() {
  const key = '__blinkenbarBridge'
  globalThis[key]?.dispose?.()
  const offEvents = host.onEvent('*', ingest)
  const offSession = host.state.activeSessionId.listen(sessionId => ensureMain(sessionId || 'draft', host.state.profile.get(), host.state.model.get()))
  const timer = setInterval(() => mutate(state => {
    const now = Date.now()
    state.entities = state.entities.filter(entity => !entity.expiresAt || entity.expiresAt > now)
    state.entities.forEach(entity => {
      entity.pulse = Math.max(0.08, entity.pulse * 0.78)
      if (entity.isMain && entity.status === 'done' && now - entity.lastSeen > 6000) {
        entity.status = 'idle'; entity.activity = 'idle'; entity.detail = 'standing by'
      }
    })
  }), 4000)
  const bridge = {
    dispose() { offEvents?.(); offSession?.(); clearInterval(timer) }
  }
  globalThis[key] = bridge
  ensureMain(host.state.activeSessionId.get() || 'draft', host.state.profile.get(), host.state.model.get())
  return bridge
}

export default {
  id: ID,
  name: 'Blinkenbar',
  description: 'A low-overhead blinkenlight rail for local telemetry and the live agent hierarchy.',
  defaultEnabled: false,
  register(ctx) {
    $identity.set({ label: safe(ctx.storage.get('agentLabel', 'AGENT'), 20).toUpperCase() || 'AGENT' })
    const bridge = installBridge()
    ctx.onDispose(() => bridge.dispose())
    ctx.registerMany([
      {
        id: 'blinkenbar-pane',
        area: 'panes',
        title: 'Blinkenbar',
        data: { placement: 'right', dock: { pane: 'workspace', pos: 'right' }, width: '292px' },
        render: () => jsx(BlinkenPane, { ctx })
      },
      {
        id: 'blinkenbar-chip',
        area: STATUSBAR_AREAS.right,
        order: 107,
        render: () => jsx(StatusChip, {})
      },
      {
        id: 'blinkenbar-identity',
        area: PALETTE_AREA,
        data: {
          id: 'blinkenbar.configure-identity',
          label: 'Blinkenbar: Configure agent label',
          keywords: ['agent', 'identity', 'label', 'name'],
          run: () => configureIdentity(ctx)
        }
      },
      {
        id: 'blinkenbar-test',
        area: PALETTE_AREA,
        data: {
          id: 'blinkenbar.signal-test',
          label: 'Blinkenbar: Run live signal test',
          keywords: ['blinkenlights', 'agents', 'telemetry', 'lights', 'test'],
          run: runSignalTest
        }
      }
    ])
  }
}
