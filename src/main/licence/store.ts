// Local licence storage (TPM D26). No electron import: the encryptor (Electron safeStorage) is
// injected, so this is unit tested with a fake one.
//
// - Encryption available (macOS Keychain, Windows DPAPI, Linux secret service): `licence.dat`,
//   the JSON record encrypted with safeStorage, file mode 0600. A plain `licence.json` is then
//   ignored (and removed on the next save), so a hand-written file cannot unlock the app there.
// - Not available (Linux without a keyring, CI): `licence.json`, plain JSON with mode 0600. Logged
//   once. This is casual-sharing protection only (docs/security/THREAT_MODEL.md).
// - Anything unreadable, undecryptable or invalid reads as "no licence": never a crash.
// - The anonymous install ID is a random UUID v4 in `install-id` (never derived from the hardware,
//   the computer name or the user).

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { renameWithRetry } from '../settings-store'
import { isInstallId } from './logic'

export const LICENCE_FILE_ENCRYPTED = 'licence.dat'
export const LICENCE_FILE_PLAIN = 'licence.json'
export const INSTALL_ID_FILE = 'install-id'

export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export const storedLicenceSchema = z
  .object({
    v: z.literal(1),
    licenseKey: z.string().min(1).max(200),
    instanceId: z.string().min(1).max(200),
    environment: z.enum(['test', 'live']),
    activatedAt: z.string().max(40),
    lastCheckedAt: z.string().max(40).nullable(),
    lastResult: z.enum(['activated', 'valid', 'invalid', 'instance-missing']),
    status: z.enum(['active', 'disabled', 'reactivate'])
  })
  .strict()

export type StoredLicence = z.infer<typeof storedLicenceSchema>

export function parseStoredLicence(raw: unknown): StoredLicence | null {
  const r = storedLicenceSchema.safeParse(raw)
  return r.success ? r.data : null
}

export interface LicenceStoreOptions {
  dir: string
  encryptor: Encryptor
  log?: (message: string) => void
}

async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  const tmp = `${path}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`
  try {
    await writeFile(tmp, data, { mode: 0o600 })
    await renameWithRetry(tmp, path)
    // rename keeps the temp file's mode; chmod again in case the file existed with a wider one.
    await chmod(path, 0o600).catch(() => undefined)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export class LicenceStore {
  private warnedPlain = false

  constructor(private readonly opts: LicenceStoreOptions) {}

  get encryptedPath(): string {
    return join(this.opts.dir, LICENCE_FILE_ENCRYPTED)
  }

  get plainPath(): string {
    return join(this.opts.dir, LICENCE_FILE_PLAIN)
  }

  private encryptionAvailable(): boolean {
    try {
      return this.opts.encryptor.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /** The stored licence, or null (missing, corrupt, other machine's keychain…). Never throws. */
  async load(): Promise<StoredLicence | null> {
    if (this.encryptionAvailable()) {
      let buf: Buffer
      try {
        buf = await readFile(this.encryptedPath)
      } catch {
        return null
      }
      try {
        return parseStoredLicence(JSON.parse(this.opts.encryptor.decryptString(buf)))
      } catch (err) {
        this.opts.log?.(`licence: stored licence could not be decrypted (${err instanceof Error ? err.name : 'error'}); treating as unlicensed`)
        return null
      }
    }
    try {
      return parseStoredLicence(JSON.parse(await readFile(this.plainPath, 'utf8')))
    } catch {
      return null
    }
  }

  async save(rec: StoredLicence): Promise<void> {
    const json = JSON.stringify(rec)
    await mkdir(this.opts.dir, { recursive: true })
    if (this.encryptionAvailable()) {
      await writeAtomic(this.encryptedPath, this.opts.encryptor.encryptString(json))
      await rm(this.plainPath, { force: true }).catch(() => undefined)
      return
    }
    if (!this.warnedPlain) {
      this.warnedPlain = true
      this.opts.log?.('licence: OS encryption (safeStorage) is not available; storing the licence in a 0600 file instead')
    }
    await writeAtomic(this.plainPath, json)
  }

  async clear(): Promise<void> {
    await rm(this.encryptedPath, { force: true }).catch(() => undefined)
    await rm(this.plainPath, { force: true }).catch(() => undefined)
  }
}

/** Read the anonymous install ID, creating it (random UUID v4) on first use. Never throws. */
export async function loadInstallId(dir: string, log?: (message: string) => void, makeId: () => string = randomUUID): Promise<string> {
  const path = join(dir, INSTALL_ID_FILE)
  try {
    const v = (await readFile(path, 'utf8')).trim()
    if (isInstallId(v)) return v
  } catch {
    // missing: create below
  }
  const id = makeId()
  try {
    await mkdir(dir, { recursive: true })
    await writeAtomic(path, `${id}\n`)
  } catch (err) {
    log?.(`licence: could not save the install ID (${String(err)}); using a temporary one`)
  }
  return id
}
