import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import './app.css'

import { StrictMode, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { PackLayout, QuranMeta, SearchText } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'
import { Reader, type Platform, type ReaderData } from '@mushaf/reader'

import { ErrorBoundary } from './ErrorBoundary.tsx'
import { FontSetup } from './FontSetup.tsx'
import { fontFiles, type FontFile } from './fonts.ts'
import { isTauri, missingFonts, tauriPlatform } from './platform-tauri.ts'
import { webPlatform } from './platform-web.ts'

const json = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`)
  }

  return (await response.json()) as T
}

function App({ data, platform, settings, missing }: { data: ReaderData; platform: Platform; settings: unknown; missing: FontFile[] }) {
  const [isReady, setIsReady] = useState(missing.length === 0)
  const ready = useCallback(() => setIsReady(true), [])

  return isReady ? <Reader data={data} platform={platform} settings={settings} /> : <FontSetup files={missing} onReady={ready} />
}

async function start() {
  const root = createRoot(document.getElementById('root') as HTMLElement)
  try {
    const pack = 'qcf-v2'
    const platform = isTauri() ? tauriPlatform : webPlatform
    const [meta, manifest, layout, searchText, settings] = await Promise.all([
      json<QuranMeta>('/quran-meta.json'),
      json<PackManifest>(`/packs/${pack}/manifest.json`),
      json<PackLayout>(`/packs/${pack}/layout.json`),
      json<SearchText>('/search-text.json'),
      platform.loadSettings(),
    ])
    const files = fontFiles(manifest)
    const missingNames = isTauri() ? new Set(await missingFonts(files)) : new Set<string>()
    const missing = files.filter(file => missingNames.has(file.name))
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App data={{ meta, manifest, layout, searchText }} platform={platform} settings={settings} missing={missing} />
        </ErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    root.render(<pre className="boot-error">{String(error)}</pre>)
  }
}

void start()
