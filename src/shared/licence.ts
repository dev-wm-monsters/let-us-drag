// Licence contract shared by main, preload and renderers (TPM D26). Pure: no electron, no DOM.
// The renderer only ever sees a LicenceView (state + masked key); the key itself, the activation
// instance ID and every network call stay in main.

/** One-time price shown in the UI (the checkout decides what is really charged). */
export const LICENCE_PRICE = '$9.50'
export const LICENCE_SEATS = 2
export const SUPPORT_EMAIL = 'support@wakeupmonster.com'
export const WEBSITE_URL = 'https://letsdrag.wakeupmonster.com'

/**
 * - unlicensed: no key on this computer (or it was deactivated).
 * - active: activated here; conversions are allowed. Only a definite answer from Dodo changes it.
 * - disabled: Dodo said the key is not valid (refunded / disabled). Conversions locked.
 * - reactivate: the key is still valid but this computer's activation is gone (e.g. removed in the
 *   dashboard). Conversions locked until "Activate again".
 */
export type LicenceStatus = 'unlicensed' | 'active' | 'disabled' | 'reactivate'

export type DodoEnvironment = 'test' | 'live'

/** What renderers may know about the licence. */
export interface LicenceView {
  status: LicenceStatus
  /** e.g. "ABCD-…-1A2B"; null when no key is stored. */
  maskedKey: string | null
  /** ISO time of the activation on this computer. */
  activatedAt: string | null
  /** ISO time of the last definite answer from Dodo. */
  lastCheckedAt: string | null
  environment: DodoEnvironment
  /** A test-mode build (Dodo test environment): Settings shows a small "Test mode" tag. */
  testMode: boolean
}

export function isUnlocked(view: Pick<LicenceView, 'status'> | null | undefined): boolean {
  return view?.status === 'active'
}

export type LicenceErrorCode =
  | 'NETWORK' // offline, DNS, timeout, TLS, captive portal
  | 'NOT_FOUND' // 404
  | 'NOT_ACTIVE' // 403 on activate (disabled / refunded)
  | 'LIMIT_REACHED' // 422 on activate (already on 2 computers)
  | 'WRONG_PRODUCT' // the key belongs to another Dodo product
  | 'EMPTY_KEY' // nothing pasted
  | 'NO_LICENCE' // deactivate without a stored licence
  | 'ALREADY_ACTIVE' // activate while this computer is already activated
  | 'BUSY' // another licence action is still running
  | 'UNKNOWN' // anything else (5xx, unexpected body…)

export type LicenceActionResult =
  | { ok: true; view: LicenceView; message: string }
  | { ok: false; code: LicenceErrorCode; message: string; view: LicenceView }

/** Links the renderer may ask main to open in the default browser (never a URL from the page). */
export type LicenceLink = 'checkout' | 'pricing' | 'terms' | 'refund' | 'privacy'
export const LICENCE_LINKS: readonly LicenceLink[] = ['checkout', 'pricing', 'terms', 'refund', 'privacy']

/** Result of `startJob`: main refuses conversions without an active licence (D26). */
export type StartJobResult = { started: true } | { started: false; reason: 'LICENCE_REQUIRED' }

export const LICENCE_MESSAGES = {
  activated: `Activated on this computer. Your licence works on ${LICENCE_SEATS} computers.`,
  deactivated: 'Deactivated. This computer no longer uses a seat.',
  network: 'Activating needs the internet once. Check your connection and try again.',
  notFound: "We couldn't find that key. Check it against your email from Dodo Payments.",
  notActive: `This key isn't active (it may have been refunded). Write to ${SUPPORT_EMAIL}.`,
  limit: `This key is already active on ${LICENCE_SEATS} computers. On one of them, go to Settings → Deactivate this computer, then try again. If that computer is lost or broken, write to ${SUPPORT_EMAIL} and we'll free the seat.`,
  wrongProduct: `That key is for a different product. Check it against your email from Dodo Payments, or write to ${SUPPORT_EMAIL}.`,
  emptyKey: 'Paste your licence key first.',
  generic: `Something went wrong while talking to Dodo Payments. Please try again, or write to ${SUPPORT_EMAIL}.`,
  deactivateOffline: 'Deactivating needs the internet so the seat is freed. Try again when you\'re online.',
  deactivateGeneric: `We couldn't deactivate this computer. Please try again, or write to ${SUPPORT_EMAIL}.`,
  noLicence: 'There is no licence on this computer.',
  alreadyActive: 'This computer is already activated. Deactivate it first to use another key.',
  busy: 'One moment, still talking to Dodo Payments.',
  disabled: `This licence key was disabled (for example after a refund). Buy a new licence, or write to ${SUPPORT_EMAIL} if this is a mistake.`,
  reactivate: "This computer's activation was removed, but your key is still valid: activate it again in Settings → Activate.",
  lostKey: `Can't find your key? Search your email for "Dodo Payments", or write to ${SUPPORT_EMAIL}.`,
  unlicensed: `Feed me a licence first! One-time, works on ${LICENCE_SEATS} computers.`
} as const

/** Title of the unlock bubble: buying is the answer, except when only this computer's activation is gone. */
export function unlockTitle(status: LicenceStatus): string {
  return status === 'reactivate' ? 'Activate me again' : `Unlock for ${LICENCE_PRICE}`
}

/** Short explanation for the unlock screen (overlay, Feed Window, Settings) for each locked state. */
export function lockedExplanation(status: LicenceStatus): string {
  switch (status) {
    case 'disabled':
      return LICENCE_MESSAGES.disabled
    case 'reactivate':
      return LICENCE_MESSAGES.reactivate
    default:
      return LICENCE_MESSAGES.unlicensed
  }
}

/**
 * Mask a licence key for display: first 4 and last 4 characters ("ABCD-…-1A2B"). Short keys show
 * only the last 4. Never returns more than 8 characters of the key.
 */
export function maskLicenceKey(key: string | null | undefined): string | null {
  if (typeof key !== 'string') return null
  const k = key.trim()
  if (k.length === 0) return null
  if (k.length <= 8) return `…${k.slice(-Math.min(4, Math.floor(k.length / 2)))}`
  return `${k.slice(0, 4)}-…-${k.slice(-4)}`
}

/** Trim spaces, tabs and line breaks around a pasted key (and zero-width characters anywhere). */
export function normaliseLicenceKey(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[​-‍﻿]/g, '').trim()
}

/** Upper bound for a key sent over IPC (Dodo keys are far shorter). */
export const MAX_LICENCE_KEY_LENGTH = 200
