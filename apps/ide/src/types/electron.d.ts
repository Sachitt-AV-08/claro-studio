export {};

interface ClaroElectronApi {
  quit: () => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ClaroElectronApi;
  }
  interface CSSStyleDeclaration {
    WebkitAppRegion: string;
  }
}