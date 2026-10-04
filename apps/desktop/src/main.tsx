import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import type { PackLayout, QuranMeta } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'
import { Reader, type ReaderData } from '@mushaf/reader'

import { webPlatform } from './platform-web.ts'

const json = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`)
  }

  return (await response.json()) as T
}

async function start() {
  const pack = 'qcf-v2'
  const [meta, manifest, layout, settings] = await Promise.all([
    json<QuranMeta>('/quran-meta.json'),
    json<PackManifest>(`/packs/${pack}/manifest.json`),
    json<PackLayout>(`/packs/${pack}/layout.json`),
    webPlatform.loadSettings(),
  ])
  const data: ReaderData = { meta, manifest, layout }
  const root = document.getElementById('root')
  if (!root) {
    throw new Error('no #root')
  }
  createRoot(root).render(
    <StrictMode>
      <Reader data={data} platform={webPlatform} settings={settings} />
    </StrictMode>,
  )
}

void start()
