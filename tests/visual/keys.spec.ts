import { expect, test, type Page } from '@playwright/test'

// ← turns to the next page and → back, as a Mushaf turns, wherever the focus is.
const shown = (page: Page) => page.locator('.book-slot .mushaf-page').first().getAttribute('data-page')
// Each turn is a leaf turning over; wait for it to lie down.
const press = async (page: Page, key: string) => {
  await page.keyboard.press(key)
  await expect(page.locator('.book-leaf')).toHaveCount(0)
}

test('the arrow keys turn pages the Mushaf way, from the page and from the slider', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mushaf.settings', JSON.stringify({ page: 50, spread: 'single' })))
  await page.goto('/')
  await expect(page.locator('.mushaf-page[data-page="50"]')).toBeVisible()
  await press(page, 'ArrowLeft')
  expect(await shown(page)).toBe('51')
  await press(page, 'ArrowRight')
  expect(await shown(page)).toBe('50')
  await page.locator('.page-slider input').focus()
  await press(page, 'ArrowLeft')
  await expect(page.locator('.mushaf-page[data-page="51"]')).toBeVisible()
  await press(page, 'ArrowRight')
  await press(page, 'ArrowRight')
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

test('turning a page turns a leaf over the spine; jumping does not', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.addInitScript(() => localStorage.setItem('mushaf.settings', JSON.stringify({ page: 50, spread: 'double' })))
  await page.goto('/')
  await expect(page.locator('.mushaf-page[data-page="50"]')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.book-leaf.is-next')).toHaveCount(1)
  await expect(page.locator('.book-leaf')).toHaveCount(0)
  expect(await page.locator('.book-slot .mushaf-page').evaluateAll(pages => pages.map(p => p.getAttribute('data-page')))).toEqual(['51', '52'])
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.book-leaf.is-prev')).toHaveCount(1)
  await expect(page.locator('.book-leaf')).toHaveCount(0)
  await page.keyboard.press('End')
  await expect(page.locator('.mushaf-page[data-page="604"]')).toBeVisible()
  await expect(page.locator('.book-leaf')).toHaveCount(0)
})
