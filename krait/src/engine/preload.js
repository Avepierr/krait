'use strict';
/**
 * krait preload script — exposes safe IPC bridge to renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('krait', {
  hasKey: (provider) => ipcRenderer.invoke('krait:has-key', provider),
  saveKey: (provider, key) => ipcRenderer.invoke('krait:save-key', { provider, key }),
  deleteKey: (provider) => ipcRenderer.invoke('krait:delete-key', provider),
  getMaskedKeys: () => ipcRenderer.invoke('krait:get-masked-keys'),
  minimize: () => ipcRenderer.invoke('krait:window-minimize'),
  maximize: () => ipcRenderer.invoke('krait:window-maximize'),
  close: () => ipcRenderer.invoke('krait:window-close'),
});