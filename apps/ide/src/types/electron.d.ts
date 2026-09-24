export {};

interface ClaroElectronApi {
  quit: () => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
  claroReadSkills: () => Promise<string[]>;
  claroReadText: (path: string) => Promise<string>;
  claroSkillsList: () => Promise<Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    category: string;
    installed: boolean;
  }>>;
  claroSkillsInstall: (id: string) => Promise<{ ok: boolean; error?: string }>;
  claroFileOpen: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; name?: string; content?: string; error?: string }>;
  claroFileSave: (opts: { path?: string; name: string; content: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
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
  claroGitBranch: (cwd?: string) => Promise<string>;
  claroDebugEvaluate: (expr: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string; error?: string }>;
  claroSettingsGet: (name: string) => Promise<Record<string, unknown>>;
  claroSettingsSet: (name: string, value: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ClaroElectronApi;
  }
  interface CSSStyleDeclaration {
    WebkitAppRegion: string;
  }
}