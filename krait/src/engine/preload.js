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

  createSession: name => ipcRenderer.invoke('krait:sessions-create', name),
  appendSession: (id, m) => ipcRenderer.invoke('krait:sessions-append', id, m),
  loadSession: id => ipcRenderer.invoke('krait:sessions-load', id),
  listSessions: () => ipcRenderer.invoke('krait:sessions-list'),
  deleteSession: id => ipcRenderer.invoke('krait:sessions-delete', id),
  projectMemory: () => ipcRenderer.invoke('krait:project-memory'),
  gitDiff: () => ipcRenderer.invoke('krait:git-diff'),

  runTerminal: c => ipcRenderer.invoke('krait:terminal', c),

  minimize: () => ipcRenderer.invoke('krait:minimize'),
  maximize: () => ipcRenderer.invoke('krait:maximize'),
  close: () => ipcRenderer.invoke('krait:close'),
});
