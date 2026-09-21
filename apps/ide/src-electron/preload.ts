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
    };
  }
}