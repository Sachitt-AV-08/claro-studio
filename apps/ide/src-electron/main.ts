import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { join, extname, basename } from 'path';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync, linkSync, copyFileSync, mkdtempSync } from 'fs';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { isDev } from './util.js';
import { GraphifyMcpClient } from './mcpClient.js';

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

app.on('before-quit', () => {
  graphifyMcp.close();
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

ipcMain.handle('claro:skills:list', () => {
  try {
    const registryPath = join(app.getAppPath(), 'skills', 'registry.json');
    const data = readFileSync(registryPath, 'utf8');
    const registry = JSON.parse(data);
    return registry.extensions;
  } catch {
    return [];
  }
});

ipcMain.handle('claro:skills:install', (_e, id: string) => {
  try {
    const registryPath = join(app.getAppPath(), 'skills', 'registry.json');
    const data = readFileSync(registryPath, 'utf8');
    const registry = JSON.parse(data) as {
      extensions: Array<{ id: string; installed: boolean }>;
    };
    const ext = registry.extensions.find((e: { id: string }) => e.id === id);
    if (!ext) return { ok: false, error: 'Extension not found' };
    if (ext.installed) return { ok: false, error: 'Already installed' };
    ext.installed = true;
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

// ---- File open/save for the multi-file workspace (toggle explorer + Ctrl+S) ----
const FILE_FILTERS = [
  { name: 'Claro & Text', extensions: ['cl', 'py', 'kt', 'ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'md', 'txt'] },
  { name: 'All Files', extensions: ['*'] },
];

ipcMain.handle('claro:file:open', async () => {
  const win = mainWindow ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, { filters: FILE_FILTERS, properties: ['openFile'] })
    : await dialog.showOpenDialog({ filters: FILE_FILTERS, properties: ['openFile'] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const p = result.filePaths[0];
    const content = readFileSync(p, 'utf8');
    return { ok: true, path: p, name: basename(p), content };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('claro:file:save', async (_e, opts: { path?: string; name: string; content: string }) => {
  const target = opts.path && opts.path.trim() ? opts.path.trim() : null;
  let savePath = target;
  if (!savePath) {
    const win = mainWindow ?? undefined;
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: opts.name, filters: FILE_FILTERS })
      : await dialog.showSaveDialog({ defaultPath: opts.name, filters: FILE_FILTERS });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    savePath = result.filePath;
  }
  try {
    writeFileSync(savePath, opts.content, 'utf8');
    return { ok: true, path: savePath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

// ---- Graphify MCP sidecar: BHASM gets a project graph to ground answers ----
// `graphify.serve` (Python) exposes query_graph / graph_stats / get_node over
// MCP stdio. The main process owns one GraphifyMcpClient (spawned on demand,
// long-running, hot-reloads graph.json itself) and the renderer reaches it via
// claro:mcp:*. The Python binary and graph path are caller-supplied; everything
// degrades to {ok:false} when python/graphify/graph.json is unavailable.
const graphifyMcp = new GraphifyMcpClient();

ipcMain.handle('claro:mcp:start', async (_e, opts: { graphJson: string; python?: string }) => {
  if (!opts || typeof opts.graphJson !== 'string' || !opts.graphJson.trim()) {
    return { ok: false, running: false, error: 'A graph.json path is required.' };
  }
  if (!existsSync(opts.graphJson)) {
    return { ok: false, running: false, error: `graph.json not found: ${opts.graphJson}` };
  }
  try {
    const status = await graphifyMcp.spawn({ graphJson: opts.graphJson, python: opts.python });
    return status;
  } catch (e) {
    return { ok: false, running: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('claro:mcp:status', () => graphifyMcp.status());

ipcMain.handle('claro:mcp:request', async (_e, payload: { method: string; params?: Record<string, unknown> }) => {
  if (!payload || typeof payload.method !== 'string') {
    return { ok: false, error: 'method required' };
  }
  if (!graphifyMcp.running) {
    return { ok: false, error: graphifyMcp.status().error ?? 'graphify serve is not running' };
  }
  try {
    const result = await graphifyMcp.request(payload.method, payload.params ?? {});
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('claro:mcp:call', async (_e, payload: { name: string; arguments?: Record<string, unknown> }) => {
  if (!payload || typeof payload.name !== 'string') {
    return { ok: false, error: 'tool name required' };
  }
  if (!graphifyMcp.running) {
    return { ok: false, error: graphifyMcp.status().error ?? 'graphify serve is not running' };
  }
  return graphifyMcp.callTool(payload.name, payload.arguments ?? {});
});

ipcMain.handle('claro:mcp:stop', () => {
  graphifyMcp.close();
  return { ok: true };
});

// Best-effort graph.json discovery near an opened file, so the sidecar can
// auto-start without any configuration. Returns the first existing candidate:
//   <dir>/graph.json, <dir>/graphify-out/graph.json, <dir>/.graphify/graph.json
ipcMain.handle('claro:mcp:discover', (_e, dir: string) => {
  if (typeof dir !== 'string' || !dir) return null;
  const candidates = ['graph.json', 'graphify-out/graph.json', '.graphify/graph.json'].map((p) => join(dir, p));
  return candidates.find((p) => existsSync(p)) ?? null;
});

// ---- Term: real interactive ConPTY-style shell inside the IDE ----
// Same child-process discipline as package-runner.cjs (pipe the stream, never
// block the main loop). `cmd /d /k` deliberately — offline-first Windows app,
// so shell is always the OS-cmd; node-pty is the documented fallback if we
// need a true PTY, but spawn+pipe gives command.com a real stdin/stdout and
// every build/run/bhasm command works with zero native-rebuild risk.
interface TermState {
  child: import('child_process').ChildProcessWithoutNullStreams;
  cwd: string;
  echo: { onData: (chunk: Buffer) => void; onExit: (code: number | null) => void };
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
  child.on('error', (e) => {
    sendToRenderer('claro:term:exit', { id, code: -1, error: e instanceof Error ? e.message : String(e) });
    terms.delete(id);
  });
  const echo: TermState['echo'] = {
    onData: (chunk: Buffer) => sendToRenderer('claro:term:data', { id, data: chunk.toString('utf8') }),
    onExit: (code) => {
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
  // cmd ignores resize; no-op is honest
  return terms.has(p.id) ? { ok: true } : { ok: false };
});

ipcMain.handle('claro:term:kill', (_e, p: { id: string }) => {
  const t = terms.get(p.id);
  if (!t) return { ok: false };
  try { t.child.stdin?.end(); t.child.kill(); } catch { /* already dead */ }
  terms.delete(p.id);
  sendToRenderer('claro:term:exit', { id: p.id, code: null });
  return { ok: true };
});

ipcMain.handle('claro:sys:stats', () => {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let battery: number | null = null;
  try {
    const out = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).EstimatedChargeRemaining'], {
      timeout: 4000,
      encoding: 'utf8',
      windowsHide: true,
    });
    const n = Number((out.stdout ?? '').trim().split('\n').pop());
    if (Number.isFinite(n)) battery = Math.round(n);
  } catch {
    battery = null;
  }
  return { time, battery };
});

ipcMain.handle('claro:git:branch', (_e, cwd?: string) => {
  const dir = cwd && existsSync(cwd) ? cwd : app.getAppPath();
  try {
    const out = spawnSync('git', ['branch', '--show-current'], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const branch = (out.stdout ?? '').trim();
    return branch || 'no-branch';
  } catch {
    return 'error';
  }
});

ipcMain.handle('claro:debug:evaluate', (_e, expr: string) => {
  try {
    const out = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `set /p "dummy=" <nul & ${String(expr).slice(0, 500)}`], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
    if (out.error) return { ok: false, error: out.error.message };
    return { ok: out.status === 0, stdout: (out.stdout ?? '').trim(), stderr: (out.stderr ?? '').trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

const SETTINGS_DIR = join(app.getAppPath(), 'settings');

function readSettingsJson(name: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const p = join(SETTINGS_DIR, name);
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function writeSettingsJson(name: string, value: Record<string, unknown>): { ok: boolean; error?: string } {
  try {
    mkdirSync(SETTINGS_DIR, { recursive: true });
    writeFileSync(join(SETTINGS_DIR, name), JSON.stringify(value, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

ipcMain.handle('claro:settings:get', (_e, name: string) =>
  readSettingsJson(name, {}));

ipcMain.handle('claro:settings:set', (_e, name: string, value: Record<string, unknown>) =>
  writeSettingsJson(name, value));

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
//   packaged: <exe-dir>/unpacked/electron.exe
// We reuse that dist for built apps so packaging works fully offline.
function resolveElectronDist(): string {
  const candidates = isDev()
    ? [join(app.getAppPath(), 'node_modules', 'electron', 'dist')]
    : [join(process.resourcesPath, '..'), join(app.getAppPath(), '..', '..')];
  for (const p of candidates) {
    if (existsSync(join(p, 'electron.exe'))) return p;
  }
  // Packaged installs renamed the binary to the product name. electron-builder
  // still wants a dir containing `electron.exe`, so synthesize one from the
  // running app's own files with NTFS hard links (near-zero cost, same volume).
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const exe = readdirSync(p).find((f) => /\.exe$/i.test(f));
    if (exe && existsSync(join(p, 'resources'))) {
      const tmp = mkdtempSync(join(os.tmpdir(), 'claro-eb-dist-'));
      try {
        hardlinkTree(p, tmp, exe);
        return tmp;
      } catch {
        continue;
      }
    }
  }
  return '';
}

// Recursively hard-link the app dir into a scratch dist, renaming the product
// exe back to electron.exe. Falls back to a byte copy if a link fails.
function hardlinkTree(src: string, dst: string, exeName: string): void {
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dst, entry === exeName ? 'electron.exe' : entry);
    const st = statSync(from);
    if (st.isDirectory()) {
      mkdirSync(to, { recursive: true });
      hardlinkTree(from, to, '');
    } else if (st.isFile()) {
      try {
        linkSync(from, to);
      } catch {
        copyFileSync(from, to);
      }
    }
  }
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