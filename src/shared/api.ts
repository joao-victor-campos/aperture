import type { Channel, IpcRequest, IpcResponse } from './ipc'

export interface ElectronAPI {
  invoke: <C extends Channel>(channel: C, request?: IpcRequest<C>) => Promise<IpcResponse<C>>
  on: (channel: string, callback: (...args: unknown[]) => void) => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
}
