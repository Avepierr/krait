'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('krait', {
  hasKey: p => ipcRenderer.invoke('krait:has-key', p),
  saveKey: (p, k) => ipcRenderer.invoke('krait:save-key', p, k),
  deleteKey: p => ipcRenderer.invoke('krait:delete-key', p),
  getMaskedKeys: () => ipcRenderer.invoke('krait:get-masked-keys'),

  chat: (model, messages, opts) => ipcRenderer.invoke('krait:chat', model, messages, opts),
  abortChat: () => ipcRenderer.invoke('krait:abort'),
  onDelta: cb => ipcRenderer.on('krait:delta', (_, d) => cb(d)),

  runTerminal: c => ipcRenderer.invoke('krait:terminal', c),

  minimize: () => ipcRenderer.invoke('krait:minimize'),
  maximize: () => ipcRenderer.invoke('krait:maximize'),
  close: () => ipcRenderer.invoke('krait:close'),
});
