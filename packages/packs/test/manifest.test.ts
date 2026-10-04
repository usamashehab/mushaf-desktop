import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

import { checkManifest, type PackManifest } from '../src/index.ts'

const manifest = JSON.parse(
  readFileSync(new URL('../../../data/packs/qcf-v2/manifest.json', import.meta.url), 'utf8'),
) as PackManifest

test('the QCF V2 manifest is whole: 604 page fonts, each with a size and sha256', () => {
  expect(checkManifest(manifest)).toEqual([])
  expect(manifest.fonts.files[49]?.url).toBe('https://verses.quran.foundation/fonts/quran/hafs/v2/woff2/p50.woff2')
})

test('a broken manifest says what is wrong', () => {
  const broken: PackManifest = {
    ...manifest,
    id: 'Bad Id',
    fonts: { ...manifest.fonts, files: manifest.fonts.files.slice(1) },
  }
  const problems = checkManifest(broken)
  expect(problems).toContain('bad id "Bad Id"')
  expect(problems).toContain('603 page fonts, not 604')
  expect(problems.some(problem => problem.startsWith('totalSize'))).toBe(true)
})
