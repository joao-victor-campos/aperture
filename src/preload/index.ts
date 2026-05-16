import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/api'

const api: ElectronAPI = {
  invoke: (channel, request?) => ipcRenderer.invoke(channel, request),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback as never)
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('platform', process.platform)
