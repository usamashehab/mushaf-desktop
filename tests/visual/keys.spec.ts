import { expect, test, type Page } from '@playwright/test'

// ← turns to the next page and → back, as a Mushaf turns, wherever the focus is.
const shown = (page: Page) => page.locator('.mushaf-page').first().getAttribute('data-page')

test('the arrow keys turn pages the Mushaf way, from the page and from the slider', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mushaf.settings', JSON.stringify({ page: 50, spread: 'single' })))
  await page.goto('/')
  await expect(page.locator('.mushaf-page[data-page="50"]')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  expect(await shown(page)).toBe('51')
  await page.keyboard.press('ArrowRight')
  expect(await shown(page)).toBe('50')
  await page.locator('.page-slider input').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.mushaf-page[data-page="51"]')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.mushaf-page[data-page="49"]')).toBeVisible()
})

test('search marks whole words, so Arabic letters stay joined', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/')
  await expect(page.locator('.mushaf-page').first()).toBeVisible()
  await page.locator('.search-field input').fill('استغف')
  const first = page.locator('.search-item-ayah').first()
  await expect(first.locator('mark')).toHaveText('وَاسْتَغْفِرُوا')
  await expect(page.locator('.search-results')).toHaveScreenshot('search-arabic.png')
})
