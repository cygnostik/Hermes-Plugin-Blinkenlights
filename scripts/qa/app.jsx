import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import plugin from '../../desktop/plugin.js'
import { fixture } from './sdk.mjs'
import './style.css'

const contributions = []
const disposers = []
const prefs = new Map()
const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 25 } } })
const metrics = { ok: true, degraded: false, errors: [], cpu: 46, memory: 63, io: { activity: 34, read_bps: 18874368, write_bps: 7340032 }, gpu: { available: false, util: 0, memory: 0 } }
const qa = Object.assign(fixture, { contributions, prefs, polls: 0, fail: false, metrics, queryClient })
plugin.register({
  storage: { get: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback, set: (key, value) => prefs.set(key, value) },
  onDispose: fn => disposers.push(fn),
  registerMany: items => contributions.push(...items),
  rest: async path => {
    if (path !== '/metrics') throw new Error(`Unexpected endpoint: ${path}`)
    qa.polls++
    if (qa.fail) throw new Error('Controlled QA metrics failure')
    return structuredClone(qa.metrics)
  }
})
const pane = contributions.find(item => item.area === 'panes')
const chip = contributions.find(item => item.area === 'statusBar.right')
const root = createRoot(document.getElementById('root'))
root.render(<QueryClientProvider client={queryClient}><div id="pane">{pane.render()}</div><footer id="chip">{chip.render()}</footer></QueryClientProvider>)
qa.unmount = () => { root.unmount(); disposers.forEach(fn => fn()); queryClient.clear() }
window.qa = qa
