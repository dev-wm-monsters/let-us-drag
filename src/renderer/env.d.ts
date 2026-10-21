import type { LudApi } from '../shared/api'

declare global {
  interface Window {
    lud: LudApi
  }
}
export {}
