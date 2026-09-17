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
const RETAIN_DONE_MS = 45000
const $mesh = atom({ entities: [], eventCount: 0, lastEventAt: 0 })
const $identity = atom({ names: new Map(), overrides: {} })
const $telemetryEpoch = atom(Date.now())
// Bounded terminal identities outlive the visible roster, without task content.
const terminalChildren = new Set()

const safe = (value, limit = 72) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''

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

// A null registry id is the SDK's local-primary path; absent atoms are legacy.
const currentConnection = () => host.state.connectionId?.get() || (host.state.connectionId ? 'local' : '')
const identityKey = (connectionId, profile) => JSON.stringify([connectionId, profile || 'default'])
const identityLabel = value => safe(value, 20).toUpperCase()

function focusedContext() {
  const state = host.state
  const owner = state.focusedSessionOwner?.get()
  const connectionId = currentConnection()
  return {
    connectionId,
    sessionId: safe((state.focusedSessionId || state.activeSessionId).get()) || 'draft',
    profile: safe(owner?.profile) || safe((state.focusedSessionProfile || state.profile).get()) || 'default',
    resolved: !state.focusedSessionOwner || Boolean(owner && owner.connectionId === connectionId)
  }
}

function isFocused(entity) {
  const focus = focusedContext()
  return focus.resolved && entity.isMain && entity.connectionId === focus.connectionId && entity.sessionId === focus.sessionId && (entity.profile || 'default') === focus.profile
}

function relabelMains(state) {
  state.entities.forEach(entity => {
    if (entity.isMain) entity.name = displayName(entity)
  })
}

function displayName({ isMain, profile, connectionId = currentConnection(), subId, index }) {
  if (isMain) {
    const key = identityKey(connectionId, profile)
    const identity = $identity.get()
    return identityLabel(identity.overrides[key]) || identity.names.get(key)
      || identityLabel(!profile || profile === 'default' ? 'Hermes' : profile)
  }
  return `SUB·${shortId(subId || String(index + 1))}`
}

function configureIdentity(ctx) {
  const focus = focusedContext()
  if (!focus.resolved || !focus.connectionId) {
    host.notify({ kind: 'info', message: 'Focus an agent on the selected connection to override its label.' })
    return
  }
  const key = identityKey(focus.connectionId, focus.profile)
  const current = $identity.get()
  const requested = globalThis.prompt?.(`Blinkenbar label for ${focus.profile} (blank restores automatic)`, current.overrides[key] || '')
  if (requested == null) return
  const label = identityLabel(requested)
  const overrides = { ...current.overrides }
  if (label) overrides[key] = label
  else delete overrides[key]
  ctx.storage.set('agentLabelsV2', overrides)
  $identity.set({ ...current, overrides })
  mutate(relabelMains)
  host.notify({ kind: 'success', message: label ? `Blinkenbar label for ${focus.profile} set to ${label}.` : `Blinkenbar automatic label restored for ${focus.profile}.` })
}

function boundEntities(state, retainedId = '') {
  while (state.entities.length > MAX_ENTITIES) {
    const candidates = state.entities
      .filter(entity => entity.id !== retainedId && !isFocused(entity))
      .sort((a, b) => {
        const aLive = a.status === 'active' || a.status === 'waiting' ? 1 : 0
        const bLive = b.status === 'active' || b.status === 'waiting' ? 1 : 0
        return aLive - bLive || a.lastSeen - b.lastSeen || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      })
    if (!candidates.length) break
    state.entities = state.entities.filter(entity => entity.id !== candidates[0].id)
  }
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
    connectionId: options.connectionId ?? currentConnection(),
    profile: options.profile || '',
    sessionId: options.sessionId || '',
    subId: options.subId || '',
    name: displayName({ ...options, index }),
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

function ensureMain(sessionId, profile = 'default') {
  const sid = sessionId || 'draft'
  mutate(state => {
    if (sid !== 'draft') {
      state.entities = state.entities.filter(entity => !(entity.isMain && entity.profile === profile && entity.sessionId === 'draft'))
    }
    const id = `main:${profile || 'default'}:${sid}`
    const entity = ensureEntity(state, id, { isMain: true, profile, sessionId: sid })
    relabelMains(state)
    entity.lastSeen = Date.now()
  })
}

function eventSession(event, payload) {
  return safe(event?.session_id) || safe(payload?.session_id) || safe(host.state.activeSessionId.get()) || 'draft'
}

// The wildcard stream includes housekeeping and secondary-connection traffic.
// Only evidence of work from the selected connection may mutate this roster.
const ACTIVITY_EVENTS = new Set([
  'message.start', 'message.delta', 'message.interim', 'message.complete', 'error',
  'reasoning.start', 'reasoning.delta', 'thinking.start', 'thinking.delta',
  'tool.generating', 'tool.start', 'tool.progress', 'tool.complete',
  'subagent.start', 'subagent.spawn_requested', 'subagent.progress', 'subagent.text',
  'subagent.thinking', 'subagent.tool', 'subagent.complete',
  'approval.request', 'approval.pending', 'sudo.request', 'clarify.request', 'secret.request'
])

function ingest(event) {
  if (!event || !ACTIVITY_EVENTS.has(event.type) || host.state.gateway.get() !== 'open') return
  const connectionId = currentConnection()
  if (event.connectionId && connectionId && event.connectionId !== connectionId) return
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
  const type = event.type
  const now = Date.now()
  const profile = safe(event.profile) || safe(host.state.profile.get()) || 'default'
  const sid = eventSession(event, payload)
  const isChild = type.startsWith('subagent.')
  const subId = safe(payload.subagent_id) || safe(payload.child_session_id) || `task-${payload.task_index ?? 0}`
  const parentSubId = safe(payload.parent_id)
  const id = isChild ? `sub:${profile}:${sid}:${subId}` : `main:${profile}:${sid}`
  const parentId = isChild
    ? parentSubId && parentSubId !== sid
      ? `sub:${profile}:${sid}:${parentSubId}`
      : `main:${profile}:${sid}`
    : ''

  mutate(state => {
    state.eventCount += 1
    state.lastEventAt = now
    const terminalKey = `${profile}:${id}`
    const existing = state.entities.find(item => item.id === id)
    if (isChild) {
      const starts = type === 'subagent.start' || type === 'subagent.spawn_requested'
      if (starts) terminalChildren.delete(terminalKey)
      else if (terminalChildren.has(terminalKey) || existing?.status === 'done' || existing?.status === 'error') return
    }
    const entity = ensureEntity(state, id, {
      depth: isChild ? Number(payload.depth || 1) : 0,
      isMain: !isChild,
      parentId,
      profile,
      sessionId: sid,
      subId
    })
    entity.lastSeen = now
    entity.expiresAt = 0
    entity.parentId = parentId || entity.parentId
    entity.depth = isChild ? Math.max(1, Number(payload.depth || entity.depth || 1)) : 0

    entity.pulseAt = now
    entity.pulse = Math.min(1, entity.pulse + 0.46)

    if (type === 'message.start') {
      entity.status = 'active'; entity.activity = 'thinking'; entity.pulse = 1
    } else if (type === 'message.delta' || type === 'message.interim') {
      entity.status = 'active'; entity.activity = 'working'
    } else if (/^(reasoning|thinking)\./.test(type)) {
      entity.status = 'active'; entity.activity = 'thinking'
    } else if (type === 'tool.generating' || type === 'tool.start' || type === 'tool.progress') {
      entity.status = 'active'; entity.tool = safe(payload.name) || entity.tool || 'tool'
      entity.activity = classifyTool(entity.tool); entity.pulse = 1
    } else if (type === 'tool.complete') {
      entity.status = 'active'; entity.activity = 'thinking'; entity.tool = ''
    } else if (type === 'message.complete') {
      const failed = /error|fail/.test(safe(payload.status).toLowerCase())
      entity.status = failed ? 'error' : 'done'; entity.activity = failed ? 'waiting' : 'done'
      entity.pulse = 1
      entity.tool = ''
    } else if (type === 'error') {
      entity.status = 'error'; entity.activity = 'waiting'; entity.pulse = 1
      entity.tool = ''
    } else if (/^(clarify|approval|sudo|secret)\.request$/.test(type) || type === 'approval.pending') {
      entity.status = 'waiting'; entity.activity = 'waiting'; entity.pulse = 1
    } else if (type === 'subagent.spawn_requested') {
      entity.status = 'queued'; entity.activity = 'planning'; entity.pulse = 0.72
    } else if (type === 'subagent.start') {
      entity.status = 'active'; entity.activity = 'thinking'; entity.pulse = 1
    } else if (type === 'subagent.thinking') {
      entity.status = 'active'; entity.activity = 'thinking'
    } else if (type === 'subagent.tool') {
      entity.status = 'active'; entity.tool = safe(payload.tool_name) || safe(payload.name) || 'tool'
      entity.activity = classifyTool(entity.tool); entity.pulse = 1
    } else if (type === 'subagent.progress' || type === 'subagent.text') {
      entity.status = 'active'
      if (entity.activity === 'idle') entity.activity = 'working'
    } else if (type === 'subagent.complete') {
      const failed = /error|fail/.test(safe(payload.status).toLowerCase())
      entity.status = failed ? 'error' : 'done'; entity.activity = failed ? 'waiting' : 'done'
      entity.pulse = 1
      entity.expiresAt = now + RETAIN_DONE_MS
      terminalChildren.add(terminalKey)
      if (terminalChildren.size > MAX_ENTITIES * 8) terminalChildren.delete(terminalChildren.values().next().value)
      entity.tool = ''
    }
    boundEntities(state)
  })
}

function orderedEntities(state) {
  const entities = state.entities
  const roots = entities
    .filter(entity => entity.isMain)
    .sort((a, b) => Number(isFocused(b)) - Number(isFocused(a)) || b.lastSeen - a.lastSeen)
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

function measurement(metrics, resource, value) {
  if (!metrics || metrics.errors?.includes(resource) || (metrics.ok === false && !metrics.degraded)) return null
  if (resource === 'gpu' && metrics.gpu?.available !== true) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

const meterText = value => value == null ? '--' : String(Math.round(value)).padStart(2, '0')

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
    const read = measurement(metrics, 'io', metrics?.io?.read_bps)
    const write = measurement(metrics, 'io', metrics?.io?.write_bps)
    const ioMbps = read == null || write == null ? null : (read + write) / 1048576
    text(ctx, `C${meterText(measurement(metrics, 'cpu', metrics?.cpu))} M${meterText(measurement(metrics, 'memory', metrics?.memory))}`, inset + 7, top + height * 0.57, theme.text2, 0.5)
    text(ctx, `I${meterText(ioMbps)}M G${meterText(measurement(metrics, 'gpu', metrics?.gpu?.util))}`, inset + 7, top + height * 0.72, theme.text3, 0.48)
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
  const availableWidth = Math.max(0, width - 10)
  grid.cols = Math.max(0, Math.floor((availableWidth + grid.gapX) / (lampSize + grid.gapX)))
  grid.colStride = grid.lampW + grid.gapX
  const usableWidth = grid.cols * grid.lampW + (grid.cols - 1) * grid.gapX
  // Left-align with the label brackets and footer rule; leftover pixels fall right.
  grid.x = 5
  grid.rows = Math.max(0, Math.floor((height - 21 - grid.y) / grid.rowStride))
  ctx.drawImage(prepareBankBackdrop(cache, width, height, grid, theme), 0, 0, width, height)

  const entities = orderedEntities(state)
  if (!grid.rows || !grid.cols) return { overflow: entities.length }
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
    measurement(metrics, 'cpu', metrics?.cpu),
    measurement(metrics, 'memory', metrics?.memory),
    measurement(metrics, 'io', metrics?.io?.activity),
    measurement(metrics, 'gpu', metrics?.gpu?.util)
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
        const value = values[systemIndex] == null ? 0 : clamp(values[systemIndex] / 100)
        signal = value > 0 && position <= value ? 0.32 + value * 0.68 : 0
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

  return { overflow: Math.max(0, entities.length - allocation.banks.length) }
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
      if (!visible || document.visibilityState !== 'visible' || time - lastPaint < 120) return
      lastPaint = time
      const theme = themeRef.current || resolveTheme()
      const colors = modePalette(theme, modeRef.current)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const bank = drawMatrixBank(
        ctx,
        cssWidth,
        cssHeight,
        stateRef.current,
        metricsRef.current,
        theme,
        colors,
        patternRef.current,
        time,
        bankCacheRef.current
      )

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

  return jsx('div', {
    ref: wrapRef,
    className: 'min-h-0 flex-1 overflow-hidden',
    children: jsx('canvas', {
      ref: canvasRef,
      className: 'block h-full w-full',
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
  const paneRef = useRef(null)
  const [intersecting, setIntersecting] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible')
  const [mode, setMode] = useState(() => ctx.storage.get('mode', 'EMBER'))
  const [pattern, setPattern] = useState(() => ctx.storage.get('pattern', 'CROSSWASH'))
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile)
  const epoch = useValue($telemetryEpoch)
  const connectionId = host.state.connectionId?.get() || 'legacy'
  const polling = intersecting && documentVisible && gateway === 'open'
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setIntersecting(entries.some(entry => entry.isIntersecting)))
    if (paneRef.current) observer.observe(paneRef.current)
    const updateVisibility = () => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', updateVisibility)
    updateVisibility()
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', updateVisibility) }
  }, [])
  const metricsQuery = useQuery({
    queryKey: [ID, 'metrics', connectionId, profile, epoch],
    queryFn: () => ctx.rest('/metrics', { timeoutMs: 1500 }),
    enabled: polling,
    refetchInterval: polling ? 2000 : false,
    refetchIntervalInBackground: false,
    retry: 1
  })
  const metrics = gateway === 'open' && !metricsQuery.error && !metricsQuery.isPending ? metricsQuery.data || null : null
  const telemetryStatus = gateway !== 'open' || metricsQuery.error ? 'TELEMETRY OFFLINE'
    : !metrics ? 'TELEMETRY PENDING'
      : metrics.degraded || metrics.ok === false ? 'TELEMETRY DEGRADED' : 'PASSIVE TELEMETRY'

  const cycleMode = () => {
    const next = MODES[(Math.max(0, MODES.indexOf(mode)) + 1) % MODES.length]
    setMode(next); ctx.storage.set('mode', next); haptic('tap')
  }
  const cyclePattern = () => {
    const next = PATTERNS[(Math.max(0, PATTERNS.indexOf(pattern)) + 1) % PATTERNS.length]
    setPattern(next); ctx.storage.set('pattern', next); haptic('tap')
  }
  const retryTelemetry = () => {
    haptic('tap')
    return metricsQuery.refetch()
  }

  return jsxs('section', {
    ref: paneRef,
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
                children: `${gateway === 'open' ? 'LIVE MESH' : String(gateway).toUpperCase()} · ${telemetryStatus}`
              })
            ]
          }),
          metricsQuery.error ? jsx(TinyControl, { label: 'RETRY', title: 'Retry telemetry query', onClick: retryTelemetry }) : null,
          jsx(TinyControl, { label: mode, title: 'Cycle color mode', onClick: cycleMode }),
          jsx(TinyControl, { label: pattern === 'STOCHASTIC' ? 'RANDOM' : pattern === 'CROSSWASH' ? 'CROSS' : pattern, title: 'Cycle idle fill pattern', onClick: cyclePattern })
        ]
      }),
      jsx(BlinkenCanvas, { metrics, mode, pattern })
    ]
  })
}

function StatusChip() {
  const state = useValue($mesh)
  const active = state.entities.filter(entity => entity.status === 'active' || entity.status === 'waiting').length
  const attention = state.entities.some(entity => entity.status === 'waiting' || entity.status === 'error')
  return jsx(Tip, {
    label: 'Blinkenbar live agent mesh',
    children: jsxs('span', {
      className: 'inline-flex h-full items-center gap-1.5 px-1.5 font-mono text-[0.62rem] text-(--ui-text-tertiary)',
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
  let disposed = false, nameRequest = 0
  let gatewayState = host.state.gateway.get()
  const clearNames = () => {
    $identity.set({ ...$identity.get(), names: new Map() })
    mutate(relabelMains)
  }
  // profiles.list is the supported read-only roster RPC. No session previews,
  // config reads, cross-plugin storage, per-agent calls, or metadata polling.
  const refreshNames = async () => {
    const generation = ++nameRequest
    const connectionId = currentConnection()
    const profile = host.state.profile.get()
    if (disposed || host.state.gateway.get() !== 'open' || typeof host.request !== 'function') return
    try {
      const result = await host.request('profiles.list', { include_sessions: false })
      if (disposed || generation !== nameRequest || connectionId !== currentConnection()
        || profile !== host.state.profile.get() || host.state.gateway.get() !== 'open') return
      if (!Array.isArray(result?.profiles)) return
      const names = new Map()
      for (const row of result.profiles) {
        if (!row || typeof row.name !== 'string' || !row.name.trim()) continue
        // Bot Mode's public server metadata has precedence over display_name.
        // Older hosts simply omit it; never read Bot Mode's local storage.
        const label = identityLabel(row.ui_meta?.['hermes-bots']?.title)
          || identityLabel(row.display_name)
          || identityLabel(row.name === 'default' ? 'Hermes' : row.name)
        names.set(identityKey(connectionId, row.name), label)
      }
      $identity.set({ ...$identity.get(), names })
      mutate(relabelMains)
    } catch {
      // Offline/old hosts keep same-source names or the profile-name fallback.
    }
  }
  clearNames()
  const offEvents = host.onEvent('*', ingest)
  const syncFocus = () => {
    const focus = focusedContext()
    if (focus.resolved) ensureMain(focus.sessionId, focus.profile)
    else mutate(relabelMains)
  }
  const focusAtoms = new Set([
    host.state.focusedSessionId || host.state.activeSessionId,
    host.state.focusedSessionProfile || host.state.profile,
    host.state.focusedSessionOwner,
    host.state.focusedStoredSessionId,
    host.state.profile
  ].filter(Boolean))
  const offs = [...focusAtoms].map(store => store.listen(syncFocus))
  const invalidateTelemetry = () => $telemetryEpoch.set($telemetryEpoch.get() + 1)
  offs.push(host.state.gateway.listen(() => {
    invalidateTelemetry()
    const next = host.state.gateway.get()
    if (next !== gatewayState) {
      gatewayState = next
      refreshNames() // Also fences in-flight replies when the stream closes.
    }
    if (host.state.gateway.get() !== 'open') mutate(state => {
      for (const entity of state.entities) {
        if (!['active', 'waiting', 'queued'].includes(entity.status)) continue
        entity.status = 'unknown'; entity.activity = 'idle'; entity.tool = ''; entity.pulse = 0
        if (!entity.isMain) entity.expiresAt = Date.now() + RETAIN_DONE_MS
      }
    })
  }))
  offs.push(host.state.profile.listen(() => {
    invalidateTelemetry()
    if (!host.state.connectionId) clearNames()
    refreshNames()
  }))
  if (host.state.connectionId) offs.push(host.state.connectionId.listen(() => {
    // The event stream/REST route changed; never mix the previous machine in.
    terminalChildren.clear()
    $mesh.set({ entities: [], eventCount: 0, lastEventAt: 0 })
    clearNames()
    invalidateTelemetry()
    syncFocus()
    refreshNames()
  }))
  invalidateTelemetry()
  const timer = setInterval(() => mutate(state => {
    const now = Date.now()
    state.entities = state.entities.filter(entity => !entity.expiresAt || entity.expiresAt > now)
    state.entities.forEach(entity => {
      entity.pulse = Math.max(0.08, entity.pulse * 0.78)
      if (entity.isMain && entity.status === 'done' && now - entity.lastSeen > 6000) {
        entity.status = 'idle'; entity.activity = 'idle'
      }
    })
  }), 4000)
  const bridge = {
    dispose() { disposed = true; nameRequest++; offEvents?.(); offs.forEach(off => off?.()); clearInterval(timer) }
  }
  globalThis[key] = bridge
  syncFocus()
  refreshNames()
  return bridge
}

export default {
  id: ID,
  name: 'Blinkenbar',
  description: 'A low-overhead blinkenlight rail for local telemetry and the live agent hierarchy.',
  defaultEnabled: false,
  register(ctx) {
    // Do not migrate the old global agentLabel: it has no trustworthy owner.
    const overrides = ctx.storage.get('agentLabelsV2', {})
    $identity.set({ names: new Map(), overrides: overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {} })
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
          label: 'Blinkenbar: Override focused profile label',
          keywords: ['agent', 'identity', 'label', 'name'],
          run: () => configureIdentity(ctx)
        }
      }
    ])
  }
}
