const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'Word 智能格式填充系统',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 如果是在开发环境
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    // mainWindow.webContents.openDevTools(); // 可选开启开发者工具
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC 文件夹路径选择对话框
ipcMain.on('select-directory', (event, type) => {
  const result = dialog.showOpenDialogSync(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: type === 'template' ? '选择模板存放文件夹' : '选择生成 Word 输出文件夹'
  });

  if (result && result.length > 0) {
    event.reply('selected-directory', { type, path: result[0] });
  }
});

// IPC 写入生成的 Word 文件到本地绝对路径
ipcMain.on('write-output-files', (event, { files, outputDir }) => {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    files.forEach(file => {
      const filePath = path.join(outputDir, `[已填写]_${file.name}`);
      const buffer = Buffer.from(file.buffer);
      fs.writeFileSync(filePath, buffer);
    });

    event.reply('write-files-result', { success: true, count: files.length });
  } catch (err) {
    console.error('写入生成文档失败:', err);
    event.reply('write-files-result', { success: false, error: err.message });
  }
});
