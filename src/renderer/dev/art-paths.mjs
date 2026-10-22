// Output paths of the visual QA capture (src/renderer/dev/capture.mjs). Pure, unit tested.
import { join, resolve } from 'node:path'

/**
 * Where capture.mjs writes screenshots and GIFs. With LUD_SCREENS_DIR set, everything goes there
 * (docs/art is never touched, QA3-12); LUD_HERO_PATH / LUD_GIF_PATH still win for the GIFs.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} repoRoot
 * @returns {{ outDir: string, heroGif: string, loopGif: string }}
 */
export function artOutputPaths(env, repoRoot) {
  const custom = env.LUD_SCREENS_DIR ? resolve(env.LUD_SCREENS_DIR) : null
  const outDir = custom ?? resolve(join(repoRoot, 'docs/art/screens'))
  const gifDir = custom ?? resolve(join(repoRoot, 'docs/art'))
  return {
    outDir,
    heroGif: resolve(env.LUD_HERO_PATH || join(gifDir, 'hero.gif')),
    loopGif: resolve(env.LUD_GIF_PATH || join(gifDir, 'uncle-eat-chew-spit.gif'))
  }
}
