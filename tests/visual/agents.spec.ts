import { expect, test, type Page } from '@playwright/test'

// The agents' part of the reader, from the demo bridge (`?agents=demo`): the chip
// while Claude works, the banners when it finishes or waits, and the settings tab.

async function open(page: Page, settings: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.addInitScript(stored => localStorage.setItem('mushaf.settings', JSON.stringify(stored)), { page: 50, ...settings })
  await page.goto('/?agents=demo')
  await expect(page.locator('.mushaf-page .mushaf-line').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const demo = (page: Page, alert: Record<string, unknown>) =>
  page.evaluate(a => (window as unknown as { mushafDemo: { alert(a: unknown): void } }).mushafDemo.alert(a), alert)

test('the chip shows while an agent works, the banners when it is done', async ({ page }) => {
  await open(page)
  await expect(page.locator('.agent-chip')).toContainText('Claude')
  await demo(page, { kind: 'attention', agent: 'codex', project: 'mushaf', workedMs: null })
  await demo(page, { kind: 'finished' })
  await expect(page.locator('.agent-alert')).toHaveCount(2)
  await expect(page.locator('.agent-chip')).toHaveCount(0)
  await expect(page.locator('.agent-alert.is-finished')).toContainText('أنهى Claude عمله')
  await expect(page.locator('.reader')).toHaveScreenshot('agents-banner.png')
  await page.locator('.agent-alert.is-finished button').click()
  await expect(page.locator('.agent-alert')).toHaveCount(1)
})

for (const [language, theme] of [
  ['ar', 'day'],
  ['en', 'night'],
] as const) {
  test(`the settings tab (${language}, ${theme})`, async ({ page }) => {
    await open(page, { language, theme })
    await page.locator('.top-bar-end .icon-button').last().click()
    await expect(page.locator('.agent-row')).toHaveCount(2)
    await page.locator('.agent-row.is-off .switch').click()
    await expect(page.locator('.agent-row.is-on')).toHaveCount(2)
    await expect(page.locator('.agent-row-note')).toHaveCount(1)
    await expect(page.locator('.side-panel')).toHaveScreenshot(`agents-settings-${language}-${theme}.png`)
  })
}
