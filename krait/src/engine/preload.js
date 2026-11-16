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

  createSession: (name, project) => ipcRenderer.invoke('krait:sessions-create', name, project),
  appendSession: (id, m) => ipcRenderer.invoke('krait:sessions-append', id, m),
  loadSession: id => ipcRenderer.invoke('krait:sessions-load', id),
  listSessions: () => ipcRenderer.invoke('krait:sessions-list'),
  deleteSession: id => ipcRenderer.invoke('krait:sessions-delete', id),
  checkpointSave: () => ipcRenderer.invoke('krait:checkpoint-save'),
  checkpointRestore: id => ipcRenderer.invoke('krait:checkpoint-restore', id),
  renameSession: (id, name) => ipcRenderer.invoke('krait:sessions-rename', id, name),
  pinSession: (id, pin) => ipcRenderer.invoke('krait:sessions-pin', id, pin),
  projectMemory: () => ipcRenderer.invoke('krait:project-memory'),
  gitDiff: () => ipcRenderer.invoke('krait:git-diff'),

  getUsage: () => ipcRenderer.invoke('krait:get-usage'),
  resetUsage: () => ipcRenderer.invoke('krait:reset-usage'),
  onTool: cb => ipcRenderer.on('krait:tool', (_, info) => cb(info)),

  projectsGet: () => ipcRenderer.invoke('krait:projects-get'),
  projectsAdd: (n, d) => ipcRenderer.invoke('krait:projects-add', n, d),
  projectsSetActive: id => ipcRenderer.invoke('krait:projects-set-active', id),
  projectsDelete: id => ipcRenderer.invoke('krait:projects-delete', id),
  projectsRename: (id, name) => ipcRenderer.invoke('krait:projects-rename', id, name),
  pickFolder: () => ipcRenderer.invoke('krait:pick-folder'),

  mcpGet: () => ipcRenderer.invoke('krait:mcp-get'),
  mcpSave: cfg => ipcRenderer.invoke('krait:mcp-save', cfg),
  mcpTest: server => ipcRenderer.invoke('krait:mcp-test', server),

  providersGet: () => ipcRenderer.invoke('krait:providers-get'),
  providersAdd: (id, cfg) => ipcRenderer.invoke('krait:providers-add', id, cfg),
  providersDelete: id => ipcRenderer.invoke('krait:providers-delete', id),

  modelsGet: () => ipcRenderer.invoke('krait:models-get'),
  modelsRefresh: () => ipcRenderer.invoke('krait:models-refresh'),

  readFile: p => ipcRenderer.invoke('krait:read-file', p),
  saveText: (title, content) => ipcRenderer.invoke('krait:save-text', { title, content }),
  ollamaStatus: () => ipcRenderer.invoke('krait:ollama-status'),
  ollamaPull: model => ipcRenderer.invoke('krait:ollama-pull', model),

  onFallback: cb => ipcRenderer.on('krait:fallback', (_, info) => cb(info)),
  onAsk: cb => ipcRenderer.on('krait:ask', (_, q) => cb(q)),
  answer: (id, text) => ipcRenderer.send('krait:answer', { id, text }),

  onAskPermission: cb => ipcRenderer.on('krait:ask-permission', (_, req) => cb(req)),
  permissionResponse: (id, choice) => ipcRenderer.invoke('krait:permission-response', id, choice),

  downloadFile: p => ipcRenderer.invoke('krait:download-file', p),
  openFile: p => ipcRenderer.invoke('krait:open-file', p),

  runTerminal: c => ipcRenderer.invoke('krait:terminal', c),

  minimize: () => ipcRenderer.invoke('krait:minimize'),
  maximize: () => ipcRenderer.invoke('krait:maximize'),
  close: () => ipcRenderer.invoke('krait:close'),
});
