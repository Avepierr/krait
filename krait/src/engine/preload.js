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
  onThinking: cb => ipcRenderer.on('krait:thinking', (_, d) => cb(d)),

  createSession: name => ipcRenderer.invoke('krait:sessions-create', name),
  appendSession: (id, m) => ipcRenderer.invoke('krait:sessions-append', id, m),
  loadSession: id => ipcRenderer.invoke('krait:sessions-load', id),
  listSessions: () => ipcRenderer.invoke('krait:sessions-list'),
  deleteSession: id => ipcRenderer.invoke('krait:sessions-delete', id),
  projectMemory: () => ipcRenderer.invoke('krait:project-memory'),
  gitDiff: () => ipcRenderer.invoke('krait:git-diff'),

  getUsage: () => ipcRenderer.invoke('krait:get-usage'),
  resetUsage: () => ipcRenderer.invoke('krait:reset-usage'),
  onTool: cb => ipcRenderer.on('krait:tool', (_, info) => cb(info)),

  projectsGet: () => ipcRenderer.invoke('krait:projects-get'),
  projectsAdd: (n, d) => ipcRenderer.invoke('krait:projects-add', n, d),
  projectsSetActive: id => ipcRenderer.invoke('krait:projects-set-active', id),
  projectsDelete: id => ipcRenderer.invoke('krait:projects-delete', id),
  pickFolder: () => ipcRenderer.invoke('krait:pick-folder'),

  mcpGet: () => ipcRenderer.invoke('krait:mcp-get'),
  mcpSave: cfg => ipcRenderer.invoke('krait:mcp-save', cfg),
  mcpTest: server => ipcRenderer.invoke('krait:mcp-test', server),

  downloadFile: p => ipcRenderer.invoke('krait:download-file', p),
  openFile: p => ipcRenderer.invoke('krait:open-file', p),

  runTerminal: c => ipcRenderer.invoke('krait:terminal', c),

  minimize: () => ipcRenderer.invoke('krait:minimize'),
  maximize: () => ipcRenderer.invoke('krait:maximize'),
  close: () => ipcRenderer.invoke('krait:close'),
});
