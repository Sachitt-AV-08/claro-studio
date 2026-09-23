export {};

interface ClaroElectronApi {
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
  // ---- Phase B1 terminal bridge (ConPTY via claro:term:* IPC) ----
  claroTermSpawn: (opts: { cwd?: string; cmd?: string[] }) => Promise<{ ok: boolean; id?: string; cwd?: string; error?: string }>;
  claroTermWrite: (id: string, data: string) => Promise<{ ok: boolean; error?: string }>;
  claroTermKill: (id: string) => Promise<{ ok: boolean }>;
  claroTermOnData: (cb: (p: { id: string; data: string }) => void) => () => void;
  claroTermOnExit: (cb: (p: { id: string; code: number | null; error?: string }) => void) => () => void;
  claroSysStats: () => Promise<{ time: string; battery: number | null }>;
}

declare global {
  interface Window {
    electronAPI?: ClaroElectronApi;
  }
  interface CSSStyleDeclaration {
    WebkitAppRegion: string;
  }
}