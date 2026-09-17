// Test-only host boundary. The emitted plugin, React and Query run unchanged.
import { atom } from 'nanostores'
import { useStore } from '@nanostores/react'
export { atom }
export { useQuery } from '@tanstack/react-query'
export const useValue = useStore
export const cn = (...values) => values.filter(Boolean).join(' ')
export const haptic = () => {}
export const Tip = ({ children }) => children
export const PALETTE_AREA = 'palette'
export const STATUSBAR_AREAS = { right: 'statusBar.right' }
const listeners = new Set()
const events = []
export const host = {
  state: {
    activeSessionId: atom('qa-session-a'), focusedSessionId: atom('qa-session-a'),
    focusedSessionProfile: atom('default'), focusedUsage: atom(null),
    profile: atom('default'), model: atom(''), gateway: atom('open'), connectionId: atom('local'),
    busy: atom(false), awaitingResponse: atom(false), busyBySession: atom({})
  },
  onEvent: (_type, fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  notify: event => events.push(event), notifyError: error => events.push(String(error)),
  restartGateway: () => { throw new Error('Gateway restart forbidden in QA') }
}
export const fixture = { host, events, emit: event => listeners.forEach(fn => fn(event)), listenerCount: () => listeners.size }
