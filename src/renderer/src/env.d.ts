/// <reference types="vite/client" />
import type { ElectronAPI } from '../../shared/api'

declare global {
  interface Window {
    api: ElectronAPI
  }
}
