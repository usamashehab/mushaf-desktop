import { expect, test, type Page } from '@playwright/test'

// Pages that cover every kind of line: the framed opening pages, a surah header at
// the foot of a page (76) with its basmala atop the next (77), headers mid-page,
// At-Tawbah without a basmala (187), centred short lines (255, 528, 602–604), and
// every page a patch in tools/build-data/src/patches.json touches (27, 177, 400, 443, 589).
const SAMPLE = [1, 2, 27, 42, 50, 76, 77, 177, 187, 255, 400, 443, 528, 589, 602, 603, 604]

async function open(page: Page, number: number, theme = 'day') {
  await page.addInitScript(
    settings => localStorage.setItem('mushaf.settings', JSON.stringify(settings)),
    { page: number, spread: 'single', theme },
  )
  await page.goto('/')
  await expect(page.locator(`.mushaf-page[data-page="${number}"] .mushaf-line`).first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

for (const number of SAMPLE) {
  test(`page ${number} looks as it did`, async ({ page }) => {
    await open(page, number)
    await expect(page.locator('.mushaf-page')).toHaveScreenshot(`p${String(number).padStart(3, '0')}.png`)
  })
}

test('night theme', async ({ page }) => {
  await open(page, 50, 'night')
  await expect(page.locator('.mushaf-page')).toHaveScreenshot('p050-night.png')
})

// Every page, not a sample: no line may draw wider than the page's text block, and
// every line must hold something. A word on the wrong line shows up here first.
test('no line on any of the 604 pages overflows', async ({ page }) => {
  test.setTimeout(600_000)
  // No leaves turning: their 3D transforms would bend the boxes measured here.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, 1)
  const problems: string[] = []
  for (let number = 1; number <= 604; number++) {
    const lines = page.locator(`.mushaf-page[data-page="${number}"] .mushaf-line`)
    await expect(lines.first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const found = await page.evaluate(n => {
      const block = document.querySelector<HTMLElement>('.mushaf-lines')
      const width = block?.getBoundingClientRect().width ?? 0
      return [...document.querySelectorAll<HTMLElement>('.mushaf-line')].flatMap((line, i) => {
        const words = [...line.children].map(child => child.getBoundingClientRect())
        if (words.length === 0) {
          return [`page ${n} line ${i + 1} is empty`]
        }
        const drawn = Math.max(...words.map(r => r.right)) - Math.min(...words.map(r => r.left))
        return drawn > width + 1 ? [`page ${n} line ${i + 1} draws ${drawn.toFixed(0)}px in ${width.toFixed(0)}px`] : []
      })
    }, number)
    problems.push(...found)
    await page.keyboard.press('ArrowLeft')
  }
  expect(problems).toEqual([])
})
