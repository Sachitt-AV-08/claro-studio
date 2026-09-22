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
}

declare global {
  interface Window {
    electronAPI?: ClaroElectronApi;
  }
  interface CSSStyleDeclaration {
    WebkitAppRegion: string;
  }
}