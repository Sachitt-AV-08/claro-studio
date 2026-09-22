import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  quit: () => ipcRenderer.invoke('app:quit'),
  minimize: () => ipcRenderer.invoke('app:minimize'),
  maximize: () => ipcRenderer.invoke('app:maximize'),
  isMaximized: () => ipcRenderer.invoke('app:isMaximized'),
  onMaximizeChange: (callback: (maximized: boolean) => void) => {
    const listener = (_: unknown, maximized: boolean) => callback(maximized);
    ipcRenderer.on('app:maximize-change', listener);
    return () => ipcRenderer.off('app:maximize-change', listener);
  },
  claroReadSkills: () => ipcRenderer.invoke('claro:read-skills') as Promise<string[]>,
  claroReadText: (path: string) => ipcRenderer.invoke('claro:read-text', path) as Promise<string>,
  claroAiFetch: (path: string, method: string, body?: unknown) =>
    ipcRenderer.invoke('claro:ai:fetch', { path, method, body }) as Promise<{
      status: number;
      ok: boolean;
      text: string;
      error?: string;
    }>,
  claroPkgHost: () =>
    ipcRenderer.invoke('claro:pkg:host') as Promise<{
      defaultOutDir: string;
      electronVersion: string;
      builderAvailable: boolean;
      isPackaged: boolean;
    }>,
  claroPkgBuild: (opts: unknown) =>
    ipcRenderer.invoke('claro:pkg:build', opts) as Promise<{ ok: boolean; id?: string; error?: string }>,
  claroPkgCancel: (id?: string) => ipcRenderer.invoke('claro:pkg:cancel', id),
  claroPkgOpenPath: (p: string) =>
    ipcRenderer.invoke('claro:pkg:open-path', p) as Promise<{ ok: boolean }>,
  claroPkgPickDir: () =>
    ipcRenderer.invoke('claro:pkg:pick-dir') as Promise<string | null>,
  claroPkgOnLog: (cb: (p: { id: string; line: string }) => void) => {
    const listener = (_: unknown, p: { id: string; line: string }) => cb(p);
    ipcRenderer.on('claro:pkg:log', listener);
    return () => ipcRenderer.off('claro:pkg:log', listener);
  },
  claroPkgOnDone: (cb: (p: { id: string; artifacts: string[]; canceled: boolean }) => void) => {
    const listener = (_: unknown, p: { id: string; artifacts: string[]; canceled: boolean }) => cb(p);
    ipcRenderer.on('claro:pkg:done', listener);
    return () => ipcRenderer.off('claro:pkg:done', listener);
  },
  claroPkgOnError: (cb: (p: { id: string; error: string }) => void) => {
    const listener = (_: unknown, p: { id: string; error: string }) => cb(p);
    ipcRenderer.on('claro:pkg:error', listener);
    return () => ipcRenderer.off('claro:pkg:error', listener);
  },
});

declare global {
  interface Window {
    electronAPI: {
      quit: () => Promise<void>;
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
      claroReadSkills: () => Promise<string[]>;
      claroReadText: (path: string) => Promise<string>;
      claroAiFetch: (
        path: string,
        method: string,
        body?: unknown,
      ) => Promise<{ status: number; ok: boolean; text: string; error?: string }>;
      claroPkgHost: () => Promise<{
        defaultOutDir: string;
        electronVersion: string;
        builderAvailable: boolean;
        isPackaged: boolean;
      }>;
      claroPkgBuild: (opts: unknown) => Promise<{ ok: boolean; id?: string; error?: string }>;
      claroPkgCancel: (id?: string) => Promise<void>;
      claroPkgOpenPath: (p: string) => Promise<{ ok: boolean }>;
      claroPkgPickDir: () => Promise<string | null>;
      claroPkgOnLog: (cb: (p: { id: string; line: string }) => void) => () => void;
      claroPkgOnDone: (cb: (p: { id: string; artifacts: string[]; canceled: boolean }) => void) => () => void;
      claroPkgOnError: (cb: (p: { id: string; error: string }) => void) => () => void;
    };
  }
}