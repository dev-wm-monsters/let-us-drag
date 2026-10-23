// E2E-CHARACTER: the Settings "Character" picker drives which character the overlay draws.
// Every character is set through window.lud.setSettings (the Settings window's API), the overlay is
// armed and must report it (data-character on the overlay root, the drawn art inside it); then a
// real PNG → JPG conversion runs with a non-default character.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CHARACTER_IDS } from '../../src/shared/characters'
import { T, expect, expectUncleState, hook, test, waitForPage, waitForTerminalEvent } from './support/app'
import { imageInfo, makePng } from './support/fixtures'
import { armOverlay, expectOverlayHidesItself, outputsOf } from './support/flows'
import { expectedOutputPath } from './support/naming'
import { changeSettings } from './support/p2'

test.describe('character picker', () => {
  test('E2E-CHAR-01 every character can be chosen and appears in the overlay', async ({ lud }) => {
    const app = await lud.launchReady()
    for (const id of CHARACTER_IDS) {
      await changeSettings(app, { character: id })
      await hook(app, 'arm')
      await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)
      const overlay = await waitForPage(app, 'overlay')
      await expect(overlay.getByTestId('overlay-root'), id).toHaveAttribute('data-character', id)
      const art = overlay.locator('[data-testid="uncle"] [data-character-art]')
      if (id === 'uncle') await expect(art, 'the Uncle uses his own rig').toHaveCount(0)
      else await expect(art, id).toHaveAttribute('data-character-art', id)
      await hook(app, 'disarm')
      await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.hide }).toBe(false)
    }
    // The picker in the Settings window reflects the last choice.
    const settings = await waitForPage(app, 'settings')
    const last = CHARACTER_IDS[CHARACTER_IDS.length - 1]!
    await expect(settings.getByTestId('setting-character')).toHaveAttribute('data-value', last)
    await expect(settings.getByTestId(`character-${last}`)).toHaveAttribute('aria-checked', 'true')
  })

  test('E2E-CHAR-02 picking in Settings + a PNG → JPG conversion with a non-default character', async ({ lud }, testInfo) => {
    const app = await lud.launchReady()
    await changeSettings(app, { character: 'uncle' })
    const settings = await waitForPage(app, 'settings')
    await settings.getByTestId('character-sumo-san').click()
    await expect(settings.getByTestId('setting-character')).toHaveAttribute('data-value', 'sumo-san')
    // An unknown id is refused by main and changes nothing.
    const refused = await settings.evaluate(async () => {
      try {
        await (globalThis as unknown as { lud: { setSettings(p: unknown): Promise<unknown> } }).lud.setSettings({ character: 'captain-chomp' })
        return false
      } catch {
        return true
      }
    })
    expect(refused, 'unknown character id must be rejected').toBe(true)

    const input = await makePng(join(lud.workDir, 'sumo.png'))
    const armed = await armOverlay(app, testInfo, 'character-sumo')
    try {
      await expect(armed.overlay.getByTestId('overlay-root')).toHaveAttribute('data-character', 'sumo-san')
      await hook(app, 'dropFiles', [input], 'to-jpg')
      const event = await waitForTerminalEvent(app, armed.eventsBefore)
      expect(event.type, JSON.stringify(event)).toBe('done')
      const out = outputsOf(event)
      expect(out).toEqual([expectedOutputPath(input, 'jpg')])
      expect(existsSync(out[0]!)).toBe(true)
      expect((await imageInfo(out[0]!)).format).toBe('jpeg')
      await expectUncleState(armed.overlay, 'spit')
      await expect(armed.overlay.getByTestId('output-card')).toBeVisible()
      await expect(armed.overlay.getByTestId('overlay-root')).toHaveAttribute('data-character', 'sumo-san')
      await expect(armed.overlay.locator('[data-character-art="sumo-san"]')).toHaveCount(1)
    } finally {
      await armed.stopScreens()
    }
    await expectOverlayHidesItself(app)
  })

  test('E2E-CHAR-03 a drawn character does not drift over repeated gestures', async ({ lud }) => {
    const app = await lud.launchReady()
    await changeSettings(app, { character: 'great-uncle-nickels' })
    const input = await makePng(join(lud.workDir, 'drift.png'))
    // The rig rebinds on every gesture; it must compose with the drawing's own transform, not with
    // what it wrote last time (that stacked a head turn per gesture until the face fell apart).
    const headTransforms: string[] = []
    let rigRuns: string | null = null
    for (let i = 0; i < 3; i++) {
      await hook(app, 'arm')
      await expect.poll(() => hook(app, 'overlayVisible'), { timeout: T.state }).toBe(true)
      const overlay = await waitForPage(app, 'overlay')
      await hook(app, 'dropFiles', [input], null)
      await expectUncleState(overlay, 'feedMe')
      await overlay.waitForTimeout(400)
      for (const pose of ['idle', 'eat']) {
        const t = await overlay.locator(`[data-pose="${pose}"] [data-part="head"]`).getAttribute('transform')
        headTransforms.push(`${pose}:${(t ?? '').split('rotate(').length - 1}`)
      }
      // Hovering an option re-renders the stage; the rig must keep running (no fresh brain = no jump).
      await overlay.getByTestId('option-to-jpg').hover()
      await overlay.waitForTimeout(300)
      rigRuns = await overlay.locator('[data-character-art]').getAttribute('data-rig-runs')
      await overlay.keyboard.press('Escape')
      await expectOverlayHidesItself(app)
    }
    expect(rigRuns, 'the rig restarts once per gesture').toBe('3')
    expect(headTransforms, headTransforms.join(' ')).toEqual([...headTransforms.slice(0, 2), ...headTransforms.slice(0, 2), ...headTransforms.slice(0, 2)])
  })
})
