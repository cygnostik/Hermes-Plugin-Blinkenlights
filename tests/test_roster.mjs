import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const pluginPath = new URL('../desktop/plugin.js', import.meta.url)
let source = fs.readFileSync(pluginPath, 'utf8')
source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
source = source.replace('export default {', 'const pluginDefault = {')
source += '\nglobalThis.__blinkenbarTest = { ingest, MAX_ENTITIES, MAX_METADATA_CHARS, $mesh }\n'

let activeSession = 'focus'
const atom = initial => {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}
const value = current => ({ get: () => current })
const context = {
  console,
  Date,
  Math,
  Number,
  String,
  Set,
  Map,
  atom,
  host: {
    state: {
      activeSessionId: { get: () => activeSession },
      profile: value('default'),
      model: value('test-model')
    }
  },
  jsx: () => null,
  jsxs: () => null
}
vm.createContext(context)
vm.runInContext(source, context, { filename: 'desktop/plugin.js' })
const { ingest, MAX_ENTITIES, MAX_METADATA_CHARS, $mesh } = context.__blinkenbarTest

const event = (type, session_id, payload = {}, profile = 'default') => ingest({ type, session_id, profile, payload })
event('message.start', 'focus')
for (let index = 0; index < MAX_ENTITIES * 3; index += 1) event('message.start', `main-${index}`)
assert.ok($mesh.get().entities.length <= MAX_ENTITIES, 'main-session churn must remain bounded')
assert.ok($mesh.get().entities.some(item => item.id === 'main:default:focus'), 'focused main entity must not be evicted')

for (let index = 0; index < MAX_ENTITIES * 2; index += 1) event('message.start', 'focus', {}, `profile-${index}`)
assert.ok($mesh.get().entities.length <= MAX_ENTITIES, 'same-session profile churn must remain bounded')
assert.ok($mesh.get().entities.some(item => item.id === 'main:default:focus'), 'only the focused profile/session entity is protected')

for (let index = 0; index < MAX_ENTITIES * 3; index += 1) {
  event(index % 2 ? 'subagent.start' : 'clarify.request', 'focus', {
    subagent_id: `sub-${index}`,
    goal: `secret-goal-${index}`
  })
}
assert.ok($mesh.get().entities.length <= MAX_ENTITIES, 'active/waiting subagent churn must remain bounded')
assert.ok($mesh.get().entities.some(item => item.id === 'main:default:focus'), 'focused entity remains protected under subagent churn')

event('subagent.start', 'focus', { subagent_id: 'redact-me', goal: 'SENSITIVE_GOAL_VALUE'.repeat(20) })
event('subagent.progress', 'focus', { subagent_id: 'redact-me', preview: 'SENSITIVE_PREVIEW_VALUE'.repeat(20) })
let retained = $mesh.get().entities.find(item => item.id === 'sub:focus:redact-me')
assert.ok(retained.goal.length <= MAX_METADATA_CHARS)
assert.ok(retained.detail.length <= MAX_METADATA_CHARS)
event('subagent.complete', 'focus', { subagent_id: 'redact-me', status: 'ok' })
retained = $mesh.get().entities.find(item => item.id === 'sub:focus:redact-me')
assert.equal(retained.goal, '', 'completed entity must redact retained goal metadata')
assert.ok(!JSON.stringify(retained).includes('SENSITIVE_'), 'completed entity must not retain goal/preview metadata')

console.log('roster bounds and metadata retention: ok')