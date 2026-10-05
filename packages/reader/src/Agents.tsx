import { useCallback, useEffect, useState } from 'react'

import { agentSettings, parseGoTo, type OpenStyle, type Settings } from '@mushaf/core'
import { BellRing, CheckCircle2, ChevronDown, CirclePause, Hand, Play, X } from 'lucide-react'

import { useReader } from './context.tsx'
import type { AgentAlert, AgentSession, AgentsBridge, Integration } from './platform.ts'

/** An alert stays this long unless dismissed. */
const ALERT_MS = 2 * 60 * 1000
const MINUTE_CHOICES = [0, 1, 2, 3, 5, 10, 15, 30]

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  agy: 'Antigravity',
  deepseek: 'DeepSeek',
}

export const agentName = (id: string) => AGENT_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

/** Agents that read their hooks only when they start. */
const READ_AT_START = ['opencode', 'deepseek']

export interface ShownAlert extends AgentAlert {
  id: number
}

/** A soft two-note chime, made on the spot: no sound files to ship. */
function chime() {
  try {
    const audio = new AudioContext()
    const notes: [number, number][] = [
      [660, 0],
      [880, 0.16],
    ]
    for (const [frequency, start] of notes) {
      const tone = audio.createOscillator()
      const gain = audio.createGain()
      tone.type = 'sine'
      tone.frequency.value = frequency
      const at = audio.currentTime + start
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)
      tone.connect(gain).connect(audio.destination)
      tone.start(at)
      tone.stop(at + 0.55)
    }
    setTimeout(() => void audio.close(), 1000)
  } catch {
    // No audio: the banner is enough.
  }
}

/** What the agents are up to, from the platform's bridge. */
export function useAgents(bridge: AgentsBridge | undefined, onOpenPlace: (place: string) => void) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [alerts, setAlerts] = useState<ShownAlert[]>([])
  const [pausedUntil, setPausedUntil] = useState<number | null>(null)

  const dismiss = useCallback((id: number) => setAlerts(current => current.filter(alert => alert.id !== id)), [])

  useEffect(() => {
    if (!bridge) {
      return
    }
    let live = true
    void bridge.state().then(state => {
      if (live) {
        setSessions(state.sessions)
        setPausedUntil(state.pausedUntil)
      }
    })
    void bridge.takeOpenPlace().then(place => {
      if (live && place) {
        onOpenPlace(place)
      }
    })
    const stops = [
      bridge.onSessions(setSessions),
      bridge.onPause(setPausedUntil),
      bridge.onOpenPlace(place => {
        void bridge.takeOpenPlace()
        onOpenPlace(place)
      }),
      bridge.onAlert(alert => {
        const id = alert.at + Math.random()
        setAlerts(current => [...current.filter(one => one.agent !== alert.agent || one.project !== alert.project).slice(-2), { ...alert, id }])
        setTimeout(() => dismiss(id), ALERT_MS)
        if (alert.sound) {
          chime()
        }
      }),
    ]

    return () => {
      live = false
      for (const stop of stops) {
        stop()
      }
    }
  }, [bridge, onOpenPlace, dismiss])

  return { sessions, alerts, dismiss, pausedUntil, setPausedUntil }
}

/** Opens what `mushaf open` was given, the way the search box would. */
export function useOpenPlace(open: (page: number, ayah?: { surah: number; ayah: number }) => void, meta: Parameters<typeof parseGoTo>[1]) {
  return useCallback(
    (place: string) => {
      const goTo = parseGoTo(place, meta)
      if (goTo.ok) {
        open(goTo.to.page, goTo.to.kind === 'ayah' ? { surah: goTo.to.surah, ayah: goTo.to.ayah } : undefined)
      }
    },
    [open, meta],
  )
}

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)

    return () => clearInterval(timer)
  }, [every])

  return now
}

/** "3 min", in the interface's digits. Parts are joined with "—", not "·": beside Arabic digits a dot reads as a zero (٠). */
function useDuration() {
  const { t, n } = useReader()

  return (ms: number) => t.short(n(Math.max(1, Math.floor(ms / 60_000))))
}

/** The banners: an agent finished, or waits for you. */
export function AgentAlerts({ alerts, onDismiss }: { alerts: ShownAlert[]; onDismiss: (id: number) => void }) {
  const { t } = useReader()
  const duration = useDuration()
  if (alerts.length === 0) {
    return null
  }

  return (
    <div className="agent-alerts" role="status" aria-live="polite">
      {alerts.map(alert => {
        const name = agentName(alert.agent)
        const Icon = alert.kind === 'finished' ? CheckCircle2 : Hand

        return (
          <div key={alert.id} className={`agent-alert is-${alert.kind}`}>
            <span className="agent-alert-icon">
              <Icon size={20} />
            </span>
            <span className="agent-alert-text">
              <strong>{alert.kind === 'finished' ? t.finished(name) : t.waiting(name)}</strong>
              <span>
                {alert.project ?? ''}
                {alert.project && alert.workedMs ? ' — ' : ''}
                {alert.workedMs ? t.workedFor(duration(alert.workedMs)) : ''}
              </span>
            </span>
            <button type="button" className="icon-button is-small" onClick={() => onDismiss(alert.id)} aria-label={t.dismiss} title={t.dismiss}>
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** In the top bar while an agent works: who, and for how long. */
export function AgentChip({ sessions, pausedUntil, onClick }: { sessions: AgentSession[]; pausedUntil: number | null; onClick: () => void }) {
  const { t, n } = useReader()
  const now = useNow(15_000)
  const duration = useDuration()
  const paused = pausedUntil !== null && pausedUntil > now
  if (sessions.length === 0 && !paused) {
    return null
  }
  const first = sessions[0]
  const label =
    sessions.length === 0
      ? t.resume
      : sessions.length === 1 && first
        ? `${t.working(agentName(first.agent))} — ${duration(now - first.started_at)}`
        : t.agentsWorking(n(sessions.length))
  const title = [
    ...sessions.map(session => {
      const opens = session.opens_at && session.opens_at > now ? ` — ${t.opensIn(duration(session.opens_at - now))}` : ''

      return `${agentName(session.agent)}${session.project ? ` — ${session.project}` : ''} — ${duration(now - session.started_at)}${opens}`
    }),
    ...(paused ? [t.paused] : []),
  ].join('\n')

  return (
    <button type="button" className={`agent-chip${paused ? ' is-paused' : ''}`} onClick={onClick} title={title}>
      {paused ? <CirclePause size={14} /> : <span className="agent-chip-dot" />}
      <span className="agent-chip-label">{label}</span>
    </button>
  )
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

function AgentRow({ integration, onChange }: { integration: Integration; onChange: (next: Integration) => void }) {
  const { t, n, settings, update, platform, toast } = useReader()
  const [busy, setBusy] = useState(false)
  // One line per agent; its minutes and notes open on a click.
  const [open, setOpen] = useState(false)
  const prefs = agentSettings(settings, integration.id)
  const connected = integration.status === 'on'
  const state =
    integration.status === 'missing'
      ? t.agentMissing
      : integration.status === 'stale'
        ? t.agentStale
        : integration.status === 'error'
          ? t.agentError
          : connected
            ? t.connected
            : t.notConnected

  const connect = async (on: boolean) => {
    if (!platform.agents) {
      return
    }
    setBusy(true)
    try {
      onChange(await platform.agents.setIntegration(integration.id, on))
      // Just connected: show its minutes, and what to do once (trust, restart).
      setOpen(on)
    } catch (error) {
      toast(String(error))
    } finally {
      setBusy(false)
    }
  }
  const setMinutes = (minutes: number) =>
    update(current => ({ ...current, agents: { ...current.agents, [integration.id]: { ...agentSettings(current, integration.id), openAfterMinutes: minutes } } }))

  const minutes = (value: number) => (value === 0 ? t.never : t.minutes(value, n(value)))
  const expanded = connected && open

  return (
    <div className={`agent-row is-${integration.status}${expanded ? ' is-open' : ''}`}>
      <div className="agent-row-head">
        <button type="button" className="agent-row-name" disabled={!connected} aria-expanded={connected ? expanded : undefined} onClick={() => setOpen(!open)}>
          <strong>
            {integration.name}
            {connected ? <ChevronDown size={14} className="agent-row-chevron" aria-hidden="true" /> : null}
          </strong>
          <span className="agent-row-state">
            {state}
            {connected ? ` — ${prefs.openAfterMinutes === 0 ? t.opensNever : t.opensAfter(minutes(prefs.openAfterMinutes))}` : ''}
          </span>
        </button>
        {integration.status === 'stale' ? (
          <button type="button" className="agent-row-fix" disabled={busy} onClick={() => void connect(true)}>
            {t.reconnect}
          </button>
        ) : (
          <Switch on={connected} disabled={busy || integration.status === 'missing' || integration.status === 'error'} onChange={on => void connect(on)} label={`${t.connect} ${integration.name}`} />
        )}
      </div>
      {expanded ? (
        <>
          <label className="agent-row-field">
            <span>{t.openAfter}</span>
            <select value={prefs.openAfterMinutes} onChange={event => setMinutes(Number(event.target.value))}>
              {(MINUTE_CHOICES.includes(prefs.openAfterMinutes) ? MINUTE_CHOICES : [...MINUTE_CHOICES, prefs.openAfterMinutes].sort((a, b) => a - b)).map(value => (
                <option key={value} value={value}>
                  {minutes(value)}
                </option>
              ))}
            </select>
          </label>
          {integration.id === 'codex' ? <p className="agent-row-note">{t.codexTrust}</p> : null}
          {READ_AT_START.includes(integration.id) ? <p className="agent-row-note">{t.restartAgent(integration.name)}</p> : null}
        </>
      ) : null}
      {integration.error ? <p className="agent-row-note is-error">{integration.error}</p> : null}
    </div>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="setting-toggle">
      <span>{label}</span>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  )
}

/** The settings tab: the agents, the alerts, and the interface language. */
export function SettingsTab({ pausedUntil, onPause }: { pausedUntil: number | null; onPause: (until: number | null) => void }) {
  const { t, settings, update, platform } = useReader()
  const [integrations, setIntegrations] = useState<Integration[]>()
  const bridge = platform.agents
  const paused = pausedUntil !== null && pausedUntil > Date.now()

  useEffect(() => {
    let live = true
    void bridge?.integrations().then(list => live && setIntegrations(list))

    return () => {
      live = false
    }
  }, [bridge])

  type Flag = Exclude<keyof Settings['alerts'], 'openStyle'>
  const setAlert = (key: Flag) => (on: boolean) => update(current => ({ ...current, alerts: { ...current.alerts, [key]: on } }))
  const setOpenStyle = (openStyle: OpenStyle) => update(current => ({ ...current, alerts: { ...current.alerts, openStyle } }))
  const openStyles: [OpenStyle, string][] = [
    ['front', t.openFront],
    ['behind', t.openBehind],
    ['notify', t.openNotify],
  ]
  const tomorrow = () => {
    const at = new Date()
    at.setHours(24, 0, 0, 0)

    return at.getTime()
  }

  return (
    <div className="panel-list settings">
      <section className="settings-section">
        <h3>{t.general}</h3>
        <div className="setting-toggle">
          <span>{t.language}</span>
          <div className="segmented">
            {(['ar', 'en'] as const).map(language => (
              <button key={language} type="button" aria-pressed={settings.language === language} onClick={() => update(current => ({ ...current, language }))}>
                {language === 'ar' ? 'العربية' : 'English'}
              </button>
            ))}
          </div>
        </div>
      </section>
      {bridge ? (
        <>
          <section className="settings-section">
            <h3>{t.agentsTitle}</h3>
            <p className="settings-hint">{t.agentsHint}</p>
            {integrations?.map(integration => (
              <AgentRow
                key={integration.id}
                integration={integration}
                onChange={next => setIntegrations(current => current?.map(one => (one.id === next.id ? next : one)))}
              />
            ))}
          </section>
          <section className="settings-section">
            <h3>
              <BellRing size={15} aria-hidden="true" /> {t.alertsTitle}
            </h3>
            <div className="setting-toggle is-stacked">
              <span>{t.openStyle}</span>
              <div className="segmented">
                {openStyles.map(([style, label]) => (
                  <button key={style} type="button" aria-pressed={settings.alerts.openStyle === style} onClick={() => setOpenStyle(style)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Toggle label={t.onlyWhenIdle} on={settings.alerts.onlyWhenIdle} onChange={setAlert('onlyWhenIdle')} />
            <p className="settings-hint">{t.onlyWhenIdleHint}</p>
            <Toggle label={t.sound} on={settings.alerts.sound} onChange={setAlert('sound')} />
            <Toggle label={t.notify} on={settings.alerts.notify} onChange={setAlert('notify')} />
            <Toggle label={t.notifyWhenClosed} on={settings.alerts.notifyWhenClosed} onChange={setAlert('notifyWhenClosed')} />
            <button type="button" className="panel-action settings-pause" onClick={() => onPause(paused ? null : tomorrow())}>
              {paused ? <Play size={16} aria-hidden="true" /> : <CirclePause size={16} aria-hidden="true" />}
              {paused ? t.resume : t.pause}
            </button>
            {paused ? <p className="settings-hint">{t.paused}</p> : null}
          </section>
        </>
      ) : null}
    </div>
  )
}
