import { app, BrowserWindow, shell, nativeTheme, Menu } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'

// Set the app name early — in dev mode Electron defaults to "Electron"
app.setName('Aperture')

// Handle Windows squirrel install events
if (process.platform === 'win32') {
  app.setAppUserModelId('Aperture')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  nativeTheme.themeSource = 'dark'

  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    icon: join(__dirname, isMac ? '../../resources/icon.icns' : '../../resources/icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { vibrancy: 'sidebar' } : {}),
    backgroundColor: '#111827',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev mode
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  buildAppMenu()
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Aperture',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        ...(isMac ? [{ role: 'services' } as Electron.MenuItemConstructorOptions, { type: 'separator' } as Electron.MenuItemConstructorOptions] : []),
        ...(isMac ? [{ role: 'hide' } as Electron.MenuItemConstructorOptions, { role: 'hideOthers' } as Electron.MenuItemConstructorOptions, { role: 'unhide' } as Electron.MenuItemConstructorOptions, { type: 'separator' } as Electron.MenuItemConstructorOptions] : []),
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  // Set dock icon in dev mode — use .icns so macOS renders it correctly
  // (production uses the icon bundled in the .app by electron-builder)
  if (process.platform === 'darwin' && process.env['ELECTRON_RENDERER_URL']) {
    const { nativeImage } = require('electron')
    const icnsPath = join(__dirname, '../../resources/icon.icns')
    try {
      app.dock.setIcon(nativeImage.createFromPath(icnsPath))
    } catch {
      // ignore if dock API is unavailable
    }
  }

  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
