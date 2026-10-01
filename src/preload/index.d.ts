import type { RlaApi } from './index'

declare global {
  interface Window {
    rla: RlaApi
  }
}

export {}
