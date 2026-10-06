// Writes dist/extension.json beside the built index.html: what an app needs to
// install the Mushaf extension. The page is published as a release file; the
// fonts are listed with the URLs they download from and their sha256, for the
// app to fetch and check.
//
//   node scripts/manifest.ts [release URL base]
// The base defaults to this version's GitHub release.

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { fontFiles, type PackManifest } from '@mushaf/packs'

import pack from '../../../data/packs/qcf-v2/manifest.json' with { type: 'json' }
import about from '../package.json' with { type: 'json' }
import { API } from '../src/protocol.ts'

const DIST = join(import.meta.dirname, '..', 'dist')
const PAGE = 'mushaf-extension.html'

const base = process.argv[2] ?? `https://github.com/usamashehab/mushaf-desktop/releases/download/v${about.version}`
const page = await readFile(join(DIST, 'index.html'))

const manifest = {
  id: 'mushaf',
  version: about.version,
  api: API,
  name: { ar: 'المصحف', en: 'The Mushaf' },
  description: {
    ar: 'مصحف المدينة النبوية، صفحة بصفحة كما طُبع.',
    en: 'The Madinah Mushaf, page for page as printed.',
  },
  unit: 'pages',
  pages: (pack as PackManifest).pages,
  entry: { path: 'index.html', url: `${base}/${PAGE}`, size: page.length, sha256: createHash('sha256').update(page).digest('hex') },
  assets: fontFiles(pack as PackManifest).map(file => ({ path: `fonts/${file.name}`, url: file.url, size: file.size, sha256: file.sha256 })),
}

await writeFile(join(DIST, 'extension.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(DIST, PAGE), page)
console.log(`dist/extension.json: ${manifest.assets.length} assets; dist/${PAGE}: ${(page.length / 1e6).toFixed(1)} MB`)
