import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import { join, extname, basename } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';
import { isDev } from './util.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function registerAppProtocol(): void {
  const distPath = join(__dirname, '..', 'dist');

  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    if (filePath === '/' || filePath === '') {
      filePath = '/index.html';
    }

    const fullPath = join(distPath, filePath.replace(/^\//, ''));

    try {
      const data = readFileSync(fullPath);
      return new Response(data, {
        headers: { 'Content-Type': getMimeType(fullPath) },
      });
    } catch {
      if (filePath !== '/index.html') {
        try {
          const indexData = readFileSync(join(distPath, 'index.html'));
          return new Response(indexData, {
            headers: { 'Content-Type': 'text/html' },
          });
        } catch {
          return new Response('Not Found', { status: 404 });
        }
      }
      return new Response('Not Found', { status: 404 });
    }
  });
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: isDev()
      ? join(__dirname, '..', 'public', 'icon.png')
      : join(__dirname, '..', 'dist', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a24',
      symbolColor: '#e0e0e0',
      height: 36,
    },
    backgroundColor: '#14141a',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL('app://./');
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:minimize', () => mainWindow?.minimize());
ipcMain.handle('app:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('app:isMaximized', () => mainWindow?.isMaximized() ?? false);

// ---- BHASM skills bridge: read opencode-style SKILL.md files from disk ----
// User skills live in <exeDir>/skills/ so window.close()/app.asar stays small
// and packaged users can drop new .md packs in without rebuilding.
const SKILLS_DIR = join(app.getAppPath(), 'skills');

ipcMain.handle('claro:read-skills', () => {
  try {
    if (!statSync(SKILLS_DIR).isDirectory()) return [];
    const files = readdirSync(SKILLS_DIR, { recursive: true })
      .map((f) => f.toString())
      .filter((f) => f.endsWith('.md'));
    return files.map((f) => join(SKILLS_DIR, f));
  } catch {
    return [];
  }
});

ipcMain.handle('claro:read-text', (_e, path: string) => {
  try {
    const resolved = join(SKILLS_DIR, basename(path));
    if (!statSync(resolved).isFile() || !basename(path).endsWith('.md')) return '';
    return readFileSync(resolved, 'utf8');
  } catch {
    return '';
  }
});