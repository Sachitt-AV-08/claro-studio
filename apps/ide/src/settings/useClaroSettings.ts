import { useCallback, useEffect, useState } from "react";

export interface ClaroSettings {
  "editor.fontSize": number;
  "editor.tabSize": number;
  "editor.wordWrap": "off" | "on" | "wordWrapColumn" | "bounded";
  "workbench.theme": string;
  "terminal.fontFamily": string;
}

export const DEFAULT_SETTINGS: ClaroSettings = {
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "off",
  "workbench.theme": "claro-dark",
  "terminal.fontFamily": "JetBrains Mono",
};

function readNumber(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function useClaroSettings(): ClaroSettings & { reload: () => void } {
  const [settings, setSettings] = useState<ClaroSettings>(DEFAULT_SETTINGS);

  const reload = useCallback(() => {
    void window.electronAPI?.claroSettingsGet?.("settings.json").then((saved) => {
      const s = (saved ?? {}) as Record<string, unknown>;
      setSettings({
        "editor.fontSize": readNumber(s["editor.fontSize"], DEFAULT_SETTINGS["editor.fontSize"], 8, 32),
        "editor.tabSize": readNumber(s["editor.tabSize"], DEFAULT_SETTINGS["editor.tabSize"], 1, 8),
        "editor.wordWrap": s["editor.wordWrap"] === "on" || s["editor.wordWrap"] === "bounded" || s["editor.wordWrap"] === "wordWrapColumn"
          ? (s["editor.wordWrap"] as ClaroSettings["editor.wordWrap"])
          : "off",
        "workbench.theme": typeof s["workbench.theme"] === "string" && s["workbench.theme"] ? s["workbench.theme"] : DEFAULT_SETTINGS["workbench.theme"],
        "terminal.fontFamily": typeof s["terminal.fontFamily"] === "string" && s["terminal.fontFamily"] ? s["terminal.fontFamily"] : DEFAULT_SETTINGS["terminal.fontFamily"],
      });
    });
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener("claro:settings-changed", reload);
    return () => window.removeEventListener("claro:settings-changed", reload);
  }, [reload]);

  return { ...settings, reload };
}

export default useClaroSettings;