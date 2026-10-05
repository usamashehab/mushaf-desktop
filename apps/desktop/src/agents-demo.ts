import type { AgentAlert, AgentSession, AgentsBridge, Integration } from '@mushaf/reader'

type Listener<T> = (value: T) => void

/**
 * Agents with nothing behind them, for the browser build with `?agents=demo`: the
 * visual tests draw the banner, the chip and the settings from it, and
 * `window.mushafDemo` sends alerts by hand.
 */
export function demoAgents(): AgentsBridge {
  const now = Date.now()
  let sessions: AgentSession[] = [{ agent: 'claude', session: 'a', project: 'shop-api', started_at: now - 3 * 60_000, opened: true }]
  let integrations: Integration[] = [
    { id: 'claude', name: 'Claude Code', status: 'on', note: null, configPath: '~/.claude/settings.json', error: null },
    { id: 'codex', name: 'Codex', status: 'off', note: 'trust', configPath: '~/.codex/hooks.json', error: null },
  ]
  const listeners = { sessions: new Set<Listener<AgentSession[]>>(), alert: new Set<Listener<AgentAlert>>(), pause: new Set<Listener<number | null>>() }
  const add = <T>(set: Set<Listener<T>>, listener: Listener<T>) => {
    set.add(listener)

    return () => void set.delete(listener)
  }
  Object.assign(window, {
    mushafDemo: {
      alert: (alert: Partial<AgentAlert> = {}) => {
        const full: AgentAlert = { agent: 'claude', project: 'shop-api', kind: 'finished', at: Date.now(), workedMs: 4 * 60_000, sound: false, ...alert }
        if (full.kind === 'finished') {
          sessions = sessions.filter(one => one.agent !== full.agent)
          listeners.sessions.forEach(listener => listener(sessions))
        }
        listeners.alert.forEach(listener => listener(full))
      },
    },
  })

  return {
    state: async () => ({ sessions, pausedUntil: null }),
    onSessions: listener => add(listeners.sessions, listener),
    onAlert: listener => add(listeners.alert, listener),
    onPause: listener => add(listeners.pause, listener),
    onOpenPlace: () => () => {},
    takeOpenPlace: async () => null,
    pause: async until => listeners.pause.forEach(listener => listener(until)),
    integrations: async () => integrations,
    setIntegration: async (id, on) => {
      integrations = integrations.map(one => (one.id === id ? { ...one, status: on ? 'on' : 'off' } : one))

      return integrations.find(one => one.id === id) as Integration
    },
  }
}
