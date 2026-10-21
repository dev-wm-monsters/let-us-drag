// Resolve installed package directories in both the bundled CommonJS engine worker and ESM tests.
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

function nodeRequire(): NodeJS.Require {
  // In the electron-vite CJS bundle `require` exists; under vitest (ESM) we create one.
  return typeof require === 'function' ? require : createRequire(import.meta.url)
}

/** Absolute directory of an installed package (must allow resolving "<name>/package.json"). */
export function packageDir(name: string): string {
  return dirname(nodeRequire().resolve(`${name}/package.json`))
}

/** Absolute path of a package's resolved entry file (works when "./package.json" is not exported). */
export function resolveEntry(name: string): string {
  return nodeRequire().resolve(name)
}
