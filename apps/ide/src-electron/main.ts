import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { join, extname, basename } from 'path';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
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

// ---- BHASM Ollama bridge: renderer calls go through the main process ----
// The packaged renderer runs on the opaque app:// origin ("null"), which
// Ollama's CORS allowlist rejects with 403. Main-process fetch has no origin,
// so proxying the Ollama API here keeps local-first AI working in production.
ipcMain.handle(
  'claro:ai:fetch',
  async (_e, req: { path: string; method?: string; body?: unknown }) => {
    const url = `http://localhost:11434${req.path}`;
    try {
      const res = await fetch(url, {
        method: req.method ?? 'GET',
        headers: req.body !== undefined ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });
      return { status: res.status, ok: res.ok, text: await res.text() };
    } catch (e) {
      return { status: 0, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

// ---- Term: real interactive ConPTY-style shell inside the IDE ----
// Same child-process discipline as package-runner.cjs (pipe the stream, never
// block the main loop). `cmd /d /k` deliberately — offline-first Windows app,
// so shell is always the OS-cmd; node-pty is the documented fallback if we
// need a true PTY, but spawn+pipe gives command.com a real stdin/stdout and
// every build/run/bhasm command works with zero native-rebuild risk.
interface TermState {
  child: import('child_process').ChildProcessWithoutNullStreams;
  cwd: string;
  echo: { onData: (_: unknown, d: Buffer) => void; onExit: (_: unknown, code: number | null) => void };
}
const terms = new Map<string, TermState>();
let termSeq = 0;

ipcMain.handle('claro:term:spawn', (_e, opts: { cwd?: string; cmd?: string[] }) => {
  const id = `term-${++termSeq}`;
  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : app.getAppPath();
  const argv = opts.cmd && opts.cmd.length ? opts.cmd : ['/d', '/k', 'chcp 65001>nul & cd /d "' + cwd + '"'];
  const child = spawn(opts.cmd && opts.cmd.length ? opts.cmd[0] : process.env.ComSpec || 'cmd.exe', argv, {
    cwd,
    env: { ...process.env, CLARO_TERM: id },
    windowsHide: true,
  });
  const echo: TermState['echo'] = {
    onData: (_e, d: Buffer) => sendToRenderer('claro:term:data', { id, data: d.toString('utf8') }),
    onExit: (_e, code) => {
      child.stdout?.off('data', echo.onData);
      child.stderr?.off('data', echo.onData);
      sendToRenderer('claro:term:exit', { id, code });
      terms.delete(id);
    },
  };
  child.stdout?.on('data', echo.onData);
  child.stderr?.on('data', echo.onData);
  child.on('exit', echo.onExit);
  terms.set(id, { child, cwd, echo });
  // prompt banner: single line so the renderer can split header vs stream
  child.stdin?.write(`\u001b[34mclaro:term\u001b[0m \u00bb \u001b[2m${cwd}\u001b[0m\r\n`);
  return { ok: true, id, cwd };
});

ipcMain.handle('claro:term:write', (_e, p: { id: string; data: string }) => {
  const t = terms.get(p.id);
  if (!t) return { ok: false, error: 'term gone' };
  try { t.child.stdin?.write(p.data); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('claro:term:resize', (_e, p: { id: string; cols: number; rows: number }) => {
  const t = terms.get(p.id);
  if (!t || t.child.stdout?.setEncoding) return { ok: true }; // cmd ignores resize; no-op is honest
  return { ok: true };
});

ipcMain.handle('claro:term:kill', (_e, p: { id: string }) => {
  const t = terms.get(p.id);
  if (!t) return { ok: false };
  try { t.child.stdin?.end(); t.child.kill(); } catch { /* already dead */ }
  terms.delete(p.id);
  sendToRenderer('claro:term:exit', { id: p.id, code: null });
  return { ok: true };
});

// ---- App packaging: turn any exported project into a native EXE installer ----
// The renderer exports a self-contained HTML artifact (Claro UI + embedded
// logic.py / screen.kt sources). We scaffold a minimal Electron app around it
// in a temp dir, then drive electron-builder (a runtime dependency) to emit a
// NSIS x64 installer (and optionally a portable exe).
interface PkgBuildOpts {
  name: string;
  version: string;
  description?: string;
  outDir: string;
  html: string;
  pyCode?: string;
  ktCode?: string;
  targets: string[];
}

interface PkgLogEvent { id: string; line: string }
interface PkgDoneEvent { id: string; artifacts: string[]; canceled: boolean }
interface PkgErrorEvent { id: string; error: string }

let activeBuild: { id: string; canceled: boolean } | null = null;
let activeChild: ReturnType<typeof spawn> | null = null;
let buildSeq = 0;

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function packageRunnerPath(): string {
  return join(app.getAppPath(), 'vendor', 'package-runner.cjs');
}

function packageRunnerAvailable(): boolean {
  return existsSync(packageRunnerPath());
}

function appIconPath(): string {
  const candidates = isDev()
    ? [join(app.getAppPath(), 'public', 'icon.png')]
    : [join(app.getAppPath(), 'dist', 'icon.png'), join(app.getAppPath(), 'assets', 'icon.png')];
  for (const p of candidates) if (existsSync(p)) return p;
  return '';
}

// The IDE ships inside a full Electron distribution:
//   dev:      apps/ide/node_modules/electron/dist/electron.exe
//   packaged: <exe-dir>/release/win-unpacked/electron.exe
// We reuse that dist for built apps so packaging works fully offline.
function resolveElectronDist(): string {
  const candidates = isDev()
    ? [join(app.getAppPath(), 'node_modules', 'electron', 'dist')]
    : [join(process.resourcesPath, '..'), join(app.getAppPath(), '..', '..')];
  for (const p of candidates) {
    if (existsSync(join(p, 'electron.exe'))) return p;
  }
  return '';
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'claro-app';
}

const MAIN_RUNTIME_SRC = `const { app, BrowserWindow } = require('electron');
const { join } = require('path');

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#15131c', symbolColor: '#e8e6f0', height: 38 },
    backgroundColor: '#15131c',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win && win.show());
  win.on('closed', () => { win = null; });
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`;

async function buildAppPackage(id: string, opts: PkgBuildOpts): Promise<void> {
  const log = (line: string) => sendToRenderer('claro:pkg:log', { id, line } as PkgLogEvent);
  const fail = (error: string) => sendToRenderer('claro:pkg:error', { id, error } as PkgErrorEvent);

  try {
    const runner = packageRunnerPath();
    if (!packageRunnerAvailable()) {
      fail('The app-packaging builder is missing from this install. Rebuild CLARO Workbench with "npm install" and try again.');
      return;
    }

    const outDir = opts.outDir && opts.outDir.trim() ? opts.outDir.trim() : join(os.homedir(), 'claro-builds');
    const genName = slugify(opts.name);
    const genDir = join(outDir, '.claro-build', `${genName}-${opts.version}`);
    mkdirSync(genDir, { recursive: true });

    writeFileSync(
      join(genDir, 'package.json'),
      JSON.stringify(
        {
          name: genName,
          version: opts.version,
          main: 'main.js',
          description: opts.description || 'Built with CLARO Workbench',
          author: 'CLARO Workbench',
          license: 'MIT',
        },
        null,
        2,
      ),
    );
    writeFileSync(join(genDir, 'main.js'), MAIN_RUNTIME_SRC);
    writeFileSync(join(genDir, 'index.html'), opts.html);
    const icon = appIconPath();
    if (icon) writeFileSync(join(genDir, 'icon.png'), readFileSync(icon));

    log(`Preparing sources for "${opts.name}" v${opts.version}…`);
    log(`Output folder: ${outDir}`);

    const electronDist = resolveElectronDist();
    if (electronDist) log('Using the bundled Electron runtime (fully offline).');
    else log(`Electron ${(process.versions as Record<string, string>).electron} needed — first build downloads it to the electron-builder cache (one-time).`);

    if (activeBuild?.canceled) {
      log('Cancelled before packaging.');
      return;
    }

    const arch = 'x64';
    const targets: Record<string, unknown>[] = [];
    if (opts.targets.includes('nsis')) targets.push({ target: 'nsis', arch });
    if (opts.targets.includes('portable')) targets.push({ target: 'portable', arch });

    log('Packaging app…');

    const configPath = join(genDir, 'build-config.json');
    const resultPath = join(genDir, 'build-result.json');
    const config = {
      projectDir: genDir,
      config: {
        appId: `com.claro.app.${genName}`,
        productName: opts.name,
        directories: { output: outDir, buildResources: genDir },
        files: ['**/*', '!icon.png'],
        electronVersion: (process.versions as Record<string, string>).electron,
        electronDist: electronDist || undefined,
        win: { icon: icon || undefined, target: targets },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
          shortcutName: opts.name,
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(config));

    const exitPromise = new Promise<void>((resolveExit) => {
      activeChild = spawn(process.execPath, [runner, configPath, resultPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      const feed = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) log(line);
      };
      activeChild.stdout?.on('data', feed);
      activeChild.stderr?.on('data', (chunk) => feed(chunk));
      activeChild.on('error', () => resolveExit());
      activeChild.on('close', () => resolveExit());
    });

    await exitPromise;

    let artifacts: string[] = [];
    if (!activeBuild?.canceled && existsSync(resultPath)) {
      try {
        const result = JSON.parse(readFileSync(resultPath, 'utf8')) as { ok?: boolean; artifacts?: string[] };
        if (!result.ok) throw new Error('builder did not produce a result');
        artifacts = result.artifacts ?? [];
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : 'The build finished without a valid result.');
      }
    }

    const canceled = activeBuild?.canceled ?? false;
    if (canceled) {
      log('Cancelled — remaining artifacts ignored.');
    } else {
      log(`Done — ${artifacts.length} artifact(s) written to ${outDir}.`);
    }
    sendToRenderer('claro:pkg:done', { id, artifacts, canceled } as PkgDoneEvent);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    activeChild = null;
    if (activeBuild?.id === id) activeBuild = null;
  }
}

ipcMain.handle('claro:pkg:host', () => ({
  defaultOutDir: join(os.homedir(), 'claro-builds'),
  electronVersion: (process.versions as Record<string, string>).electron || '',
  builderAvailable: packageRunnerAvailable(),
  isPackaged: app.isPackaged,
}));

ipcMain.handle('claro:pkg:build', (_e, opts: PkgBuildOpts) => {
  if (activeBuild) return { ok: false, error: 'A build is already running — wait for it to finish or cancel it.' };
  if (!opts || typeof opts.html !== 'string' || !opts.name) {
    return { ok: false, error: 'Missing project data — export the app before building.' };
  }
  const id = `pkg-${++buildSeq}`;
  const targets = Array.isArray(opts.targets) && opts.targets.length ? opts.targets : ['nsis'];
  activeBuild = { id, canceled: false };
  void buildAppPackage(id, { ...opts, targets });
  return { ok: true, id };
});

ipcMain.handle('claro:pkg:cancel', (_e, id?: string) => {
  if (!activeBuild || (id && activeBuild.id !== id)) return;
  activeBuild.canceled = true;
  const child = activeChild;
  if (child && child.pid) {
    // Kill the builder process tree (electron-builder spawns workers).
    child.kill();
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    } catch {
      // no-op: child may already be gone
    }
  }
  activeChild = null;
});

ipcMain.handle('claro:pkg:open-path', async (_e, p: string) => {
  if (!p) return { ok: false };
  const result = await shell.openPath(p);
  return { ok: result === '' };
});

ipcMain.handle('claro:pkg:pick-dir', async () => {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a folder for the built installer',
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});