/** Types for character-svg.mjs (sanitiser + Vite plugin, used by the configs, the sync script and tests). */
export declare const DEFAULT_DROP_PARTS: string[]
export declare function sanitizeCharacterSvg(src: string, opts?: { dropParts?: string[] }): string
export declare function svgProblems(svg: string): string[]
export declare function splitSvg(svg: string): { viewBox: string; inner: string }
export declare function characterSvgPlugin(): {
  name: string
  enforce: 'pre'
  load(this: { addWatchFile?(file: string): void }, id: string): string | null
}
