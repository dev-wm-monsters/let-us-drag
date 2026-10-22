/** Types for art-paths.mjs (plain Node script helper, used by capture.mjs and its unit test). */
export declare function artOutputPaths(
  env: Record<string, string | undefined>,
  repoRoot: string
): { outDir: string; heroGif: string; loopGif: string }
