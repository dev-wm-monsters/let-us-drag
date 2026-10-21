import { _electron as electron, expect, test } from '@playwright/test'

test('app boots and shows a window', async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, LUD_E2E: '1' } })
  const win = await app.firstWindow()
  await expect(win.locator('#root')).toBeVisible()
  await app.close()
})
