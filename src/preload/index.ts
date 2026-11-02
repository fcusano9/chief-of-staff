import { contextBridge, ipcRenderer } from 'electron'
import { API_CHANNELS, type AsyncApi } from '@shared/api'

// Exposes exactly the calls listed in shared/api.ts as `window.cos`; nothing else from Node or Electron.
const api = Object.fromEntries(
  API_CHANNELS.map((channel) => [channel, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)]),
) as AsyncApi

contextBridge.exposeInMainWorld('cos', api)
