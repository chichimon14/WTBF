const { contextBridge, ipcRenderer } = require('electron');

// 安全地在 main world 暴露 ipcRenderer 接口，供 React 页面进行原生系统交互
contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(event, ...args)),
  removeListener: (channel, func) => {
    ipcRenderer.removeListener(channel, func);
  }
});
