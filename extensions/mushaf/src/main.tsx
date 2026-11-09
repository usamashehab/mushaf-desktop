// The Mushaf as an extension: the reader, drawn inside another app's sandboxed
// frame. Its data is built in; its fonts, its saved settings and every page it
// reaches go through the app (src/bridge.ts).
import '@fontsource/amiri/arabic-400.css'
import '@fontsource/amiri/arabic-700.css'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import './extension.css'

import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { parseGoTo, type AyahRef, type PackLayout, type QuranMeta, type SearchText } from '@mushaf/core'
import { extraFontPath, pageFontPath, type PackManifest } from '@mushaf/packs'
import { Reader, type Platform, type ReaderData } from '@mushaf/reader'

import layout from '../../../data/packs/qcf-v2/layout.json' with { type: 'json' }
import manifest from '../../../data/packs/qcf-v2/manifest.json' with { type: 'json' }
import meta from '../../../data/quran-meta.json' with { type: 'json' }
import searchText from '../../../data/search-text.json' with { type: 'json' }

import { quranComLibrary } from '../../../apps/desktop/src/library.ts'
import { connect, type Bridge } from './bridge.ts'
import { startingSettings } from './settings.ts'

const data: ReaderData = {
  meta: meta as QuranMeta,
  manifest: manifest as PackManifest,
  layout: layout as PackLayout,
  searchText: searchText as SearchText,
}

/** `fetch` for the Quran.com client, through the app: a failure is a 502 reply. */
function throughApp(bridge: Bridge): typeof fetch {
  return async input => {
    const url = input instanceof Request ? input.url : String(input)
    const body = await bridge.fetch(url).catch(() => null)

    return body === null ? new Response(null, { status: 502 }) : new Response(body, { headers: { 'Content-Type': 'application/json' } })
  }
}

function App({ bridge }: { bridge: Bridge }) {
  const settings = useMemo(() => startingSettings(bridge), [bridge])
  const [openAt, setOpenAt] = useState<{ page: number; ayah?: AyahRef }>()
  const platform = useMemo<Platform>(
    () => ({
      pageFont: (pack, page) => () => bridge.asset(`fonts/${pageFontPath(pack, page)}`),
      extraFont: (pack, which) => () => bridge.asset(`fonts/${extraFontPath(pack, which)}`),
      loadSettings: async () => settings,
      saveSettings: async next => bridge.send({ type: 'state', data: next }),
      // Tafsir and recitation, where the app fetches for the frame (it has no network of its own).
      ...(bridge.init.fetch ? { library: quranComLibrary(throughApp(bridge)) } : {}),
    }),
    [bridge, settings],
  )

  useEffect(() => {
    bridge.onOpen(place => {
      const goTo = parseGoTo(place, data.meta)
      if (goTo.ok) {
        setOpenAt({ page: goTo.to.page, ...(goTo.to.kind === 'ayah' ? { ayah: { surah: goTo.to.surah, ayah: goTo.to.ayah } } : {}) })
      }
    })
    bridge.send({ type: 'ready' })
  }, [bridge])

  return (
    <Reader
      data={data}
      platform={platform}
      settings={settings}
      openAt={openAt}
      onNavigate={(page, kind) => bridge.send({ type: 'page', page, kind })}
    />
  )
}

void connect(window).then(bridge => {
  document.documentElement.lang = bridge.init.language
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App bridge={bridge} />
    </StrictMode>,
  )
})
