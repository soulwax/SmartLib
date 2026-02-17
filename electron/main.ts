import { app, BrowserWindow, shell } from 'electron'
import { ChildProcess, spawn } from 'child_process'
import * as http from 'http'
import * as path from 'path'

const isDev = process.env.NODE_ENV !== 'production'
const PORT = Number(process.env.PORT ?? 3000)
const DEV_URL = `http://localhost:${PORT}`

let serverProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

function waitForServer(url: string, maxAttempts = 60): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0

    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode !== undefined && res.statusCode < 500) {
            resolve()
          } else {
            retry()
          }
        })
        .on('error', retry)
    }

    const retry = () => {
      attempts++
      if (attempts >= maxAttempts) {
        reject(new Error(`Server at ${url} failed to become ready after ${maxAttempts} attempts`))
      } else {
        setTimeout(check, 1000)
      }
    }

    check()
  })
}

function startProductionServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    // The standalone server is placed in resources/server/ by electron-builder
    const serverScript = path.join(process.resourcesPath, 'server', 'server.js')
    const serverCwd = path.join(process.resourcesPath, 'server')

    serverProcess = spawn(process.execPath, [serverScript], {
      cwd: serverCwd,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        // Point to static assets alongside the server
        NEXT_PUBLIC_BASE_URL: `http://localhost:${PORT}`,
      },
      stdio: 'pipe',
    })

    serverProcess.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data)
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data)
    })

    serverProcess.on('error', reject)
    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Server exited with code ${code}`))
      }
    })

    const url = `http://localhost:${PORT}`
    waitForServer(url).then(() => resolve(url)).catch(reject)
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    title: 'bluesix Library',
    show: false,
    backgroundColor: '#09090b', // matches zinc-950 theme background
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in the system browser rather than Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    const isLocalhost = parsedUrl.hostname === 'localhost' && parsedUrl.port === String(PORT)
    if (!isLocalhost) {
      event.preventDefault()
      shell.openExternal(navigationUrl)
    }
  })

  let appUrl: string

  if (isDev) {
    console.log('Development mode: connecting to Next.js dev server...')
    await waitForServer(DEV_URL)
    appUrl = DEV_URL
    mainWindow.webContents.openDevTools()
  } else {
    console.log('Production mode: starting standalone Next.js server...')
    appUrl = await startProductionServer()
  }

  mainWindow.loadURL(appUrl)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})

// Security: prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
})
