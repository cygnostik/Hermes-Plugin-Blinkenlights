import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace('export default {', 'const pluginDefault = {')
const atom = initial => {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set: next => { value = next; listeners.forEach(fn => fn(next)) },
    listen: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    listeners
  }
}
function setup({ focused = true, request, storage = {} } = {}) {
  let now = 1000
  const state = { activeSessionId: atom('focus'), profile: atom('default'), model: atom('test-model'), gateway: atom('open'), connectionId: atom('local') }
  if (focused) Object.assign(state, { focusedSessionId: atom('focus'), focusedSessionProfile: atom('default'), focusedSessionOwner: atom({ connectionId: 'local', profile: 'default' }), focusedStoredSessionId: atom('stored-focus') })
  const intervals = new Set(), effects = [], slots = [], registrations = [], events = new Set(), documentListeners = new Map()
  let cursor = 0, queryOptions, queryResult = { data: undefined, error: null, refetch: async () => { retries++ } }, retries = 0, intersection
  const ctx = { storage: { get: (key, fallback) => storage[key] ?? fallback, set: (key, value) => { storage[key] = value } }, registerMany: rows => registrations.push(...rows), onDispose() {}, rest: async () => ({ ok: true }) }
  const context = {
    console, Date: class extends Date { static now() { return now } }, Math, Number, String, Set, Map, atom,
    host: { state, request, onEvent: (_type, fn) => { events.add(fn); return () => events.delete(fn) }, notify() {}, notifyError() {} },
    PALETTE_AREA: 'palette', STATUSBAR_AREAS: { right: 'statusbar' }, Tip: 'Tip', cn: (...values) => values.join(' '), haptic() {},
    jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }),
    setInterval: fn => { intervals.add(fn); return fn }, clearInterval: fn => intervals.delete(fn),
    useValue: store => store.get(), useRef: initial => { const index = cursor++; return slots[index] ||= { current: initial } },
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = next }] },
    useEffect: fn => { cursor++; effects.push(fn) },
    useQuery: options => { queryOptions = options; return queryResult },
    document: { visibilityState: 'visible', addEventListener: (type, fn) => documentListeners.set(type, fn), removeEventListener: type => documentListeners.delete(type) },
    IntersectionObserver: class { constructor(fn) { intersection = fn } observe() {} disconnect() {} }
  }
  vm.createContext(context)
  vm.runInContext(source + '\nglobalThis.api = { ingest, MAX_ENTITIES, $mesh, $identity, installBridge, configureIdentity, StatusChip, BlinkenPane, BlinkenCanvas, drawBankLabel, pluginDefault };', context)
  const api = context.api
  return {
    ...api, state, context, registrations, intervals, events, ctx,
    event: (type, session_id = 'focus', payload = {}, profile = 'default') => api.ingest({ type, session_id, payload, profile }),
    advance: ms => { now += ms; intervals.forEach(fn => fn()) },
    render: () => { cursor = 0; effects.length = 0; return api.BlinkenPane({ ctx }) },
    mount: tree => { tree.props.ref.current = {}; return effects.map(fn => fn()).filter(Boolean) },
    intersect: value => intersection([{ isIntersecting: value }]),
    visibility: value => { context.document.visibilityState = value; documentListeners.get('visibilitychange')?.() },
    query: () => queryOptions, result: value => { queryResult = { ...queryResult, ...value } }, retries: () => retries
  }
}
const entity = (app, id) => app.$mesh.get().entities.find(item => item.id === id)

test('roster stays bounded and protects only the focused profile/session', () => {
  const app = setup()
  app.event('message.start')
  for (let index = 0; index < app.MAX_ENTITIES * 3; index++) {
    app.event('message.start', `main-${index}`)
    app.event('message.start', 'focus', {}, `profile-${index}`)
    app.event('subagent.start', 'focus', { subagent_id: `sub-${index}` })
    assert.ok(app.$mesh.get().entities.length <= app.MAX_ENTITIES)
    assert.ok(entity(app, 'main:default:focus'))
  }
})

test('all mains use configured names, never transfer identity with focus, and children stay SUB', async () => {
  const calls = []
  const app = setup({ request: async (method, params) => {
    calls.push([method, params])
    return { profiles: [
      { name: 'default', display_name: 'Kosmos' },
      { name: 'bot', display_name: 'Research Desk' },
      { name: 'plain-worker', display_name: '' },
      { name: 'titled', display_name: 'Core Name', ui_meta: { 'hermes-bots': { title: 'Bot Title' } } }
    ] }
  } })
  const bridge = app.installBridge()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(entity(app, 'main:default:focus').name, 'KOSMOS')
  assert.equal(JSON.stringify(calls), JSON.stringify([['profiles.list', { include_sessions: false }]]))
  app.event('message.start', 'other')
  app.event('message.start', 'worker', {}, 'plain-worker')
  app.event('message.start', 'titled', {}, 'titled')
  assert.equal(entity(app, 'main:plain-worker:worker').name, 'PLAIN-WORKER')
  assert.equal(entity(app, 'main:titled:titled').name, 'BOT TITLE')
  app.event('subagent.start', 'focus', { subagent_id: 'child' })
  assert.equal(entity(app, 'sub:default:focus:child').name, 'SUB·CHILD')
  app.state.focusedSessionId.set('other')
  assert.equal(entity(app, 'main:default:focus').name, 'KOSMOS')
  assert.equal(entity(app, 'main:default:other').name, 'KOSMOS')
  app.state.focusedSessionProfile.set('bot')
  app.state.focusedSessionOwner.set({ connectionId: 'local', profile: 'bot' })
  assert.equal(entity(app, 'main:default:other').name, 'KOSMOS')
  assert.equal(entity(app, 'main:bot:other').name, 'RESEARCH DESK')
  app.context.prompt = () => 'renamed'
  app.configureIdentity(app.ctx)
  assert.equal(entity(app, 'main:bot:other').name, 'RENAMED')
  assert.equal(entity(app, 'main:default:other').name, 'KOSMOS')
  app.state.focusedSessionId.set(null)
  assert.equal(entity(app, 'main:bot:other').name, 'RENAMED')
  assert.equal(entity(app, 'main:bot:draft').name, 'RENAMED')
  app.context.prompt = () => ''
  app.configureIdentity(app.ctx)
  assert.equal(entity(app, 'main:bot:other').name, 'RESEARCH DESK')
  app.advance(3600000)
  assert.equal(calls.length, 1, 'focus, events and maintenance never poll metadata')
  bridge.dispose()
  assert.equal(app.events.size, 0)
  assert.equal(app.intervals.size, 0)
  for (const store of Object.values(app.state)) assert.equal(store.listeners.size, 0)
})

test('legacy SDK follows active session and profile', () => {
  const app = setup({ focused: false })
  delete app.state.connectionId
  const bridge = app.installBridge()
  app.state.activeSessionId.set('other')
  assert.equal(entity(app, 'main:default:focus').name, 'HERMES')
  assert.equal(entity(app, 'main:default:other').name, 'HERMES')
  app.state.profile.set('bot')
  assert.equal(entity(app, 'main:default:other').name, 'HERMES')
  assert.equal(entity(app, 'main:bot:other').name, 'BOT')
  bridge.dispose()
})

test('unresolved or foreign focused owners never borrow the active identity', () => {
  const app = setup()
  const bridge = app.installBridge()
  app.context.prompt = () => 'custom'
  app.configureIdentity(app.ctx)
  app.state.focusedSessionOwner.set(null)
  assert.equal(entity(app, 'main:default:focus').name, 'CUSTOM')
  app.context.prompt = () => { assert.fail('Unresolved/foreign focus must not prompt for a label') }
  app.configureIdentity(app.ctx)
  app.state.focusedSessionOwner.set({ connectionId: 'remote', profile: 'default' })
  app.configureIdentity(app.ctx)
  app.state.connectionId.set('remote')
  assert.equal(entity(app, 'main:default:focus').name, 'HERMES')
  assert.equal(app.$mesh.get().eventCount, 0, 'source changes discard the old event stream')
  bridge.dispose()
})

const flushNames = () => new Promise(resolve => setImmediate(resolve))
const namedProfiles = label => ({ profiles: [{ name: 'default', display_name: label }] })

test('same profile on two connections never shares metadata; stale A→B→A replies are fenced', async () => {
  const pending = []
  const app = setup({ request: () => new Promise(resolve => pending.push(resolve)) })
  const bridge = app.installBridge()
  app.state.connectionId.set('remote')
  app.state.focusedSessionOwner.set({ connectionId: 'remote', profile: 'default' })
  assert.equal(entity(app, 'main:default:focus').name, 'HERMES')
  pending[1](namedProfiles('Remote Name'))
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'REMOTE NAME')
  app.state.connectionId.set('local')
  app.state.focusedSessionOwner.set({ connectionId: 'local', profile: 'default' })
  assert.equal(entity(app, 'main:default:focus').name, 'HERMES')
  pending[2](namedProfiles('Current Local'))
  await flushNames()
  pending[0](namedProfiles('Stale Local'))
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'CURRENT LOCAL')
  assert.equal(entity(app, 'main:default:focus').connectionId, 'local')
  bridge.dispose()
})

test('offline startup, reconnect, route changes and disposal fence metadata without polling', async () => {
  const pending = []
  const app = setup({ request: () => new Promise(resolve => pending.push(resolve)) })
  app.state.gateway.set('closed')
  const bridge = app.installBridge()
  assert.equal(pending.length, 0)
  assert.equal(entity(app, 'main:default:focus').name, 'HERMES')
  app.state.gateway.set('open')
  app.state.gateway.set('open')
  assert.equal(pending.length, 1)
  app.state.gateway.set('closed')
  pending[0](namedProfiles('Disconnected Reply'))
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'HERMES')
  app.state.gateway.set('open')
  pending[1](namedProfiles('Verified Name'))
  await flushNames()
  app.state.gateway.set('closed')
  assert.equal(entity(app, 'main:default:focus').name, 'VERIFIED NAME', 'same-source cached name remains useful offline')
  app.state.gateway.set('open')
  app.state.profile.set('worker')
  pending[2](namedProfiles('Previous Route'))
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'VERIFIED NAME')
  bridge.dispose()
  const before = JSON.stringify(app.$mesh.get())
  pending[3](namedProfiles('Disposed Reply'))
  await flushNames()
  assert.equal(JSON.stringify(app.$mesh.get()), before)
  app.state.gateway.set('closed'); app.state.gateway.set('open'); app.state.profile.set('default')
  assert.equal(pending.length, 4, 'disposed subscriptions never refetch')
  assert.equal(app.events.size, 0)
  assert.equal(app.intervals.size, 0)
  for (const store of Object.values(app.state)) assert.equal(store.listeners.size, 0)
})

test('bridge replacement cannot accept the previous bridge metadata reply', async () => {
  const pending = []
  const app = setup({ request: () => new Promise(resolve => pending.push(resolve)) })
  app.installBridge()
  const replacement = app.installBridge()
  pending[1](namedProfiles('Replacement'))
  await flushNames()
  pending[0](namedProfiles('Old Bridge'))
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'REPLACEMENT')
  assert.equal(app.intervals.size, 1)
  assert.equal(app.events.size, 1)
  replacement.dispose()
})

test('unsupported RPC, malformed rows and empty metadata fall back without retry loops', async () => {
  for (const response of [
    () => { throw new Error('unknown method') },
    () => Promise.reject(new Error('offline')),
    async () => null,
    async () => ({ profiles: {} }),
    async () => ({ profiles: [null, {}, { name: 42 }, { name: 'default', display_name: {}, ui_meta: { 'hermes-bots': { title: 42 } } }] })
  ]) {
    let calls = 0
    const app = setup({ request: (...args) => { calls++; return response(...args) } })
    app.pluginDefault.register(app.ctx)
    const bridge = app.context.__blinkenbarBridge
    assert.equal(app.registrations.length, 3, 'optional naming failure must never prevent plugin registration')
    await flushNames()
    assert.equal(entity(app, 'main:default:focus').name, 'HERMES')
    app.event('message.start', 'worker-session', {}, 'worker')
    assert.equal(entity(app, 'main:worker:worker-session').name, 'WORKER')
    app.advance(3600000)
    assert.equal(calls, 1)
    bridge.dispose()
  }
})

test('manual labels persist by connection/profile, ignore legacy global labels, and clear to automatic', async () => {
  const storage = { agentLabel: 'UNSCOPED LEGACY' }
  const app = setup({ storage, request: async () => namedProfiles('Automatic') })
  app.pluginDefault.register(app.ctx)
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'AUTOMATIC')
  app.context.prompt = () => 'local override'
  app.configureIdentity(app.ctx)
  assert.equal(storage.agentLabelsV2[JSON.stringify(['local', 'default'])], 'LOCAL OVERRIDE')
  app.state.connectionId.set('remote')
  app.state.focusedSessionOwner.set({ connectionId: 'remote', profile: 'default' })
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'AUTOMATIC')
  app.context.prompt = () => 'remote override'
  app.configureIdentity(app.ctx)
  assert.equal(entity(app, 'main:default:focus').name, 'REMOTE OVERRIDE')
  app.state.connectionId.set('local')
  app.state.focusedSessionOwner.set({ connectionId: 'local', profile: 'default' })
  await flushNames()
  assert.equal(entity(app, 'main:default:focus').name, 'LOCAL OVERRIDE')
  app.context.__blinkenbarBridge.dispose()
  const reloaded = setup({ storage, request: async () => namedProfiles('Automatic') })
  reloaded.pluginDefault.register(reloaded.ctx)
  await flushNames()
  assert.equal(entity(reloaded, 'main:default:focus').name, 'LOCAL OVERRIDE')
  reloaded.context.prompt = () => ''
  reloaded.configureIdentity(reloaded.ctx)
  assert.equal(entity(reloaded, 'main:default:focus').name, 'AUTOMATIC')
  assert.equal(storage.agentLabelsV2[JSON.stringify(['local', 'default'])], undefined)
  assert.equal(storage.agentLabelsV2[JSON.stringify(['remote', 'default'])], 'REMOTE OVERRIDE')
  reloaded.context.__blinkenbarBridge.dispose()
})

test('null local registry IDs reject foreign owners and missing source atoms disable persistent overrides', () => {
  const app = setup()
  app.state.connectionId.set(null)
  const bridge = app.installBridge()
  assert.equal(entity(app, 'main:default:focus').connectionId, 'local')
  app.ingest({ type: 'message.start', connectionId: 'remote', profile: 'default', session_id: 'foreign', payload: {} })
  assert.equal(entity(app, 'main:default:foreign'), undefined, 'null local registry must not accept tagged remote events')
  app.state.focusedSessionOwner.set({ connectionId: 'remote', profile: 'bot' })
  assert.equal(entity(app, 'main:bot:focus'), undefined)
  app.context.prompt = () => assert.fail('unknown or foreign source must not gain a persistent label')
  app.configureIdentity(app.ctx)
  bridge.dispose()
  const legacy = setup({ focused: false })
  delete legacy.state.connectionId
  const legacyBridge = legacy.installBridge()
  legacy.context.prompt = app.context.prompt
  legacy.configureIdentity(legacy.ctx)
  legacyBridge.dispose()
})

test('terminal children ignore late progress, expire normally, and explicit starts reopen', () => {
  const app = setup()
  const bridge = app.installBridge()
  for (const status of ['ok', 'error']) {
    const subagent_id = `demo-${status}`
    app.event('subagent.start', 'focus', { subagent_id })
    app.event('subagent.complete', 'focus', { subagent_id, status })
    const id = `sub:default:focus:${subagent_id}`
    const terminal = JSON.stringify(entity(app, id))
    for (const type of ['subagent.progress', 'subagent.text', 'subagent.thinking', 'subagent.tool', 'subagent.complete']) {
      app.event(type, 'focus', { subagent_id, preview: 'late', tool_name: 'terminal' })
      assert.equal(JSON.stringify(entity(app, id)), terminal, `${type} must not resurrect or extend terminal state`)
    }
    app.advance(46000)
    assert.equal(entity(app, id), undefined)
    app.event('subagent.progress', 'focus', { subagent_id })
    assert.equal(entity(app, id), undefined, 'late progress after expiry stays terminal')
    app.event('subagent.start', 'focus', { subagent_id })
    assert.equal(entity(app, id).status, 'active')
    app.event('subagent.complete', 'focus', { subagent_id })
    app.event('subagent.spawn_requested', 'focus', { subagent_id })
    assert.equal(entity(app, id).status, 'queued')
    assert.equal(entity(app, id).expiresAt, 0)
  }
  bridge.dispose()
})

test('real events preserve hierarchy, classification and pulses without retaining task content', () => {
  const app = setup()
  app.event('message.start')
  app.event('subagent.start', 'focus', { subagent_id: 'parent', goal: 'SENSITIVE_GOAL' })
  app.event('subagent.tool', 'focus', { subagent_id: 'nested', parent_id: 'parent', depth: 2, tool_name: 'web_search' })
  const nested = entity(app, 'sub:default:focus:nested')
  assert.equal(nested.parentId, 'sub:default:focus:parent')
  assert.equal(nested.depth, 2)
  assert.equal(nested.activity, 'browsing')
  assert.equal(nested.pulse, 1)
  app.event('subagent.progress', 'focus', { subagent_id: 'parent', preview: 'SENSITIVE_PREVIEW' })
  assert.ok(!JSON.stringify(app.$mesh.get()).includes('SENSITIVE'))
  for (const [name, activity] of [['read_file', 'reading'], ['write_file', 'writing'], ['terminal', 'terminal'], ['image_generate', 'studio'], ['delegate_task', 'planning']]) {
    app.event('tool.start', 'focus', { name })
    assert.equal(entity(app, 'main:default:focus').activity, activity)
  }
})

test('status chip is passive and signal test is not registered', () => {
  const app = setup()
  app.pluginDefault.register(app.ctx)
  const chip = app.StatusChip().props.children
  assert.equal(chip.type, 'span')
  assert.equal(chip.props.onClick, undefined)
  assert.ok(!app.registrations.some(row => /signal-test|blinkenbar-test/.test(row.data?.id || row.id)))
  assert.ok(!source.includes('cursor-crosshair'))
})

test('metrics poll only in a visible intersecting pane and Retry is query-only', async () => {
  const app = setup()
  const bridge = app.installBridge()
  let tree = app.render()
  assert.equal(app.query().enabled, false)
  assert.equal(tree.props.children[1].props.metrics, null)
  assert.match(tree.props.children[0].props.children[0].props.children[1].props.children, /TELEMETRY PENDING/)
  const cleanups = app.mount(tree)
  app.intersect(true)
  app.render()
  assert.equal(app.query().enabled, true)
  app.visibility('hidden'); app.render()
  assert.equal(app.query().enabled, false)
  app.visibility('visible'); app.intersect(false); app.render()
  assert.equal(app.query().enabled, false)
  app.intersect(true)
  app.result({ error: new Error('offline'), data: { cpu: 88 } })
  tree = app.render()
  const retry = tree.props.children[0].props.children.find(child => child?.props?.label === 'RETRY')
  assert.ok(retry)
  await retry.props.onClick()
  assert.equal(app.retries(), 1)
  assert.equal(tree.props.children[1].props.metrics, null, 'error must not paint cached healthy measurements')
  const key = JSON.stringify(app.query().queryKey)
  app.state.connectionId.set('remote')
  app.render()
  assert.notEqual(JSON.stringify(app.query().queryKey), key)
  const remoteKey = JSON.stringify(app.query().queryKey)
  app.state.gateway.set('connecting'); app.render()
  assert.equal(app.query().enabled, false)
  app.state.gateway.set('open'); app.render()
  assert.notEqual(JSON.stringify(app.query().queryKey), remoteKey, 'reconnect gets a fresh metrics cache scope')
  const reconnectedKey = JSON.stringify(app.query().queryKey)
  app.state.profile.set('bot'); app.render()
  assert.notEqual(JSON.stringify(app.query().queryKey), reconnectedKey, 'gateway profile changes isolate telemetry too')
  assert.equal(app.query().queryKey[2], 'remote')
  assert.equal(app.query().queryKey[3], 'bot')
  app.result({ error: null, isPending: true, data: { cpu: 88 } })
  tree = app.render()
  assert.equal(tree.props.children[1].props.metrics, null)
  cleanups.forEach(fn => fn()); bridge.dispose()
})

test('machine labels distinguish unavailable, valid zero, and per-resource errors', () => {
  const app = setup()
  const labels = []
  const ctx = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, fillText: value => labels.push(value) }
  const theme = { stroke: [1, 1, 1], text: [1, 1, 1], text2: [1, 1, 1], text3: [1, 1, 1] }
  const draw = metrics => { labels.length = 0; app.drawBankLabel(ctx, { entity: null, start: 0, rows: 8 }, { y: 4, rowStride: 10, gapY: 2 }, theme, metrics); return labels.join(' ') }
  assert.match(draw(null), /C-- M--.*I--M G--/)
  assert.match(draw({ ok: true, cpu: 0, memory: 0, io: { read_bps: 0, write_bps: 0 }, gpu: { available: false } }), /C00 M00.*I00M G--/)
  assert.match(draw({ ok: false, degraded: true, errors: ['cpu', 'io'], cpu: 0, memory: 42, io: { read_bps: 0, write_bps: 0 } }), /C-- M42.*I--M G--/)
})

test('housekeeping broadcasts neither create agents nor prolong completion', () => {
  const app = setup()
  const bridge = app.installBridge()
  app.event('message.start')
  app.event('message.complete')
  for (let index = 0; index < 30; index++) {
    app.advance(2000)
    app.ingest({ type: 'sessions.changed', profile: 'default', payload: {} })
    app.ingest({ type: 'sessions.changed', profile: 'bot', payload: {} })
  }
  assert.equal(entity(app, 'main:default:focus').status, 'idle')
  assert.equal(entity(app, 'main:bot:focus'), undefined)
  assert.equal(app.$mesh.get().eventCount, 2)
  bridge.dispose()
})

test('disconnect removes live activity claims until a fresh event arrives', () => {
  const app = setup()
  const bridge = app.installBridge()
  app.event('message.start')
  app.event('subagent.start', 'focus', { subagent_id: 'child' })
  app.state.gateway.set('closed')
  assert.ok(app.$mesh.get().entities.every(row => row.status === 'unknown'))
  assert.equal(app.StatusChip().props.children.props.children[1].props.children, 'BLINK 0')
  app.event('message.start')
  assert.equal(entity(app, 'main:default:focus').status, 'unknown', 'closed stream cannot verify work')
  app.advance(3600000)
  app.state.gateway.set('open')
  assert.equal(entity(app, 'main:default:focus').status, 'unknown', 'reconnect alone is not work evidence')
  app.event('message.delta')
  assert.equal(entity(app, 'main:default:focus').status, 'active')
  bridge.dispose()
})

test('only the selected connection contributes; child ownership includes profile', () => {
  const app = setup()
  const bridge = app.installBridge()
  app.state.connectionId.set('remote')
  const before = JSON.stringify(app.$mesh.get())
  app.ingest({ type: 'message.start', connectionId: 'local', session_id: 'foreign', profile: 'default', payload: {} })
  assert.equal(JSON.stringify(app.$mesh.get()), before)
  for (const profile of ['default', 'bot']) {
    app.ingest({ type: 'message.start', connectionId: 'remote', session_id: 'shared', profile, payload: {} })
    app.ingest({ type: 'subagent.start', connectionId: 'remote', session_id: 'shared', profile, payload: { subagent_id: 'child' } })
  }
  const children = app.$mesh.get().entities.filter(row => row.subId === 'child')
  assert.equal(children.length, 2)
  for (const child of children) assert.equal(child.parentId, `main:${child.profile}:shared`)
  app.ingest({ type: 'subagent.complete', connectionId: 'remote', session_id: 'shared', profile: 'default', payload: { subagent_id: 'child' } })
  assert.equal(app.$mesh.get().entities.find(row => row.subId === 'child' && row.profile === 'bot').status, 'active')
  bridge.dispose()
})
