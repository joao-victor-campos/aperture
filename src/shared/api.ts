import type { IpcMap, IpcRequest, IpcResponse } from './ipc'

declare global {
  interface Window {
    platform: NodeJS.Platform
  }
}

export interface ElectronAPI {
  // invoke is only valid for request/response channels (keys of IpcMap).
  // Push-only channels like QUERY_LOG use window.api.on(), not invoke().
  invoke: <C extends keyof IpcMap>(channel: C, request?: IpcRequest<C>) => Promise<IpcResponse<C>>
  on: (channel: string, callback: (...args: unknown[]) => void) => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
}
