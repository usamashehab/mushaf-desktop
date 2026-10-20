import { PAGE_COUNT, RECITERS, type Reading, type ReciterId, type Settings, type ThemeChoice } from '@mushaf/core'
import { RotateCcw } from 'lucide-react'

import { useReader } from './context.tsx'
import { Toggle } from './controls.tsx'

const THEME_CHOICES: ThemeChoice[] = ['day', 'sepia', 'night', 'auto']
/** Pages a day; 20 is a juz. */
const GOALS = [0, 1, 2, 4, 10, 20]

function Range({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="setting-range">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={event => onChange(Number(event.target.value))} />
    </label>
  )
}

/** The settings for reading: the theme, focus mode, the paper's tone, the wird and the khatma; and the reciter. */
export function ReadingSettings() {
  const { t, n, settings, update, toast, platform } = useReader()
  const { reading } = settings
  const setReading = (change: Partial<Reading>) => update(current => ({ ...current, reading: { ...current.reading, ...change } }))
  const setPaper = (change: Partial<Settings['paper']>) => update(current => ({ ...current, paper: { ...current.paper, ...change } }))
  const startOver = () => {
    const read = reading.khatma
    setReading({ khatma: [] })
    toast(t.khatmaCleared, { label: t.undo, run: () => setReading({ khatma: read }) })
  }

  return (
    <>
      <section className="settings-section">
        <h3>{t.reading}</h3>
        <div className="setting-toggle is-stacked">
          <span>{t.theme}</span>
          <div className="segmented">
            {THEME_CHOICES.map(theme => (
              <button key={theme} type="button" aria-pressed={settings.theme === theme} onClick={() => update(current => ({ ...current, theme }))}>
                {t.themes[theme]}
              </button>
            ))}
          </div>
        </div>
        <Toggle label={t.focusMode} on={settings.focusMode} onChange={focusMode => update(current => ({ ...current, focusMode }))} />
        <p className="settings-hint">{t.focusHint}</p>
        <Toggle label={t.pageSound} on={settings.pageSound} onChange={pageSound => update(current => ({ ...current, pageSound }))} />
        <Range label={t.warmth} value={settings.paper.warmth} onChange={warmth => setPaper({ warmth })} />
        <Range label={t.dim} value={settings.paper.dim} onChange={dim => setPaper({ dim })} />
        <div className="setting-toggle is-stacked">
          <span>{t.dailyGoal}</span>
          <div className="segmented">
            {GOALS.map(goal => (
              <button key={goal} type="button" aria-pressed={reading.goal === goal} onClick={() => setReading({ goal })}>
                {goal === 0 ? t.goalOff : n(goal)}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-hint">{t.goalHint}</p>
        <div className="setting-toggle">
          <span>{t.khatma}</span>
          <span className="setting-value">{t.khatmaProgress(n(reading.khatma.length), n(PAGE_COUNT))}</span>
        </div>
        {reading.khatmas > 0 ? <p className="settings-hint">{t.khatmas(n(reading.khatmas))}</p> : null}
        {reading.khatma.length > 0 ? (
          <button type="button" className="panel-action" onClick={startOver}>
            <RotateCcw size={16} aria-hidden="true" />
            {t.startOver}
          </button>
        ) : null}
      </section>
      {platform.library ? (
        <section className="settings-section">
          <h3>{t.recitation}</h3>
          <label className="setting-select">
            <span>{t.reciter}</span>
            <select value={settings.reciter} onChange={event => update(current => ({ ...current, reciter: event.target.value as ReciterId }))}>
              {RECITERS.map(reciter => (
                <option key={reciter} value={reciter}>
                  {t.reciters[reciter]}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-hint">{t.recitationHint}</p>
        </section>
      ) : null}
    </>
  )
}
