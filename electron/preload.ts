import { contextBridge } from 'electron'

// Expose a minimal, typed API to the renderer process.
// Keep this surface area small — only expose what the renderer actually needs.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform as NodeJS.Platform,
  isElectron: true,
})
