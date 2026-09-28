import React, { useEffect, useState } from "react";
import { Icon } from "../components/Icon";

const DEFAULTS: Record<string, Record<string, unknown>> = {
  "settings.json": {
    "editor.fontSize": 14,
    "editor.tabSize": 2,
    "editor.wordWrap": "off",
    "workbench.theme": "claro-dark",
    "terminal.fontFamily": "JetBrains Mono",
  },
  "keybindings.json": {
    "formatDocument": "Ctrl+K",
    "toggleBreakpoint": "F9",
    "clearBreakpoints": "Shift+F5",
    "commandPalette": "Ctrl+Shift+P",
  },
  "bhasm.json": {
    "graphJson": "",
    "python": "",
    "autoStart": true,
    "graphAssist": true,
    "decision": {
      "model": "qwen2.5:3b",
      "embedModel": "nomic-embed-text",
      "gateMargin": 0.05,
      "act": 0.9,
      "ask": 0.6,
    },
  },
};

export const SettingsView: React.FC = () => {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string>("settings.json");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadAll = async () => {
      const next: Record<string, string> = {};
      for (const name of Object.keys(DEFAULTS)) {
        const saved = await window.electronAPI?.claroSettingsGet?.(name);
        next[name] = JSON.stringify(saved && Object.keys(saved).length ? saved : DEFAULTS[name], null, 2);
      }
      setFiles(next);
      setStatus("Loaded from disk");
    };
    loadAll();
  }, []);

  const save = async () => {
    const name = active;
    try {
      const parsed = JSON.parse(files[name]) as Record<string, unknown>;
      const result = await window.electronAPI?.claroSettingsSet?.(name, parsed);
      if (result?.ok === false) setStatus(`Save failed: ${result.error}`);
      else {
        setDirty((d) => ({ ...d, [name]: false }));
        setStatus(`Saved ${name}`);
        if (name === "settings.json" || name === "bhasm.json") window.dispatchEvent(new Event("claro:settings-changed"));
      }
    } catch (e) {
      setStatus(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const reset = async () => {
    const name = active;
    setFiles((f) => ({ ...f, [name]: JSON.stringify(DEFAULTS[name], null, 2) }));
    setDirty((d) => ({ ...d, [name]: true }));
  };

  return (
    <div className="settings">
      <div className="pane__header">
        <span>Settings</span>
        <span className="pane__sub">{status || "JSON persisted to disk"}</span>
      </div>
      <div className="settings__tabs">
        {Object.keys(DEFAULTS).map((name) => (
          <button
            key={name}
            className={`settings__tab${active === name ? " settings__tab--active" : ""}`}
            onClick={() => setActive(name)}
          >
            {name}
            {dirty[name] && <span className="settings__dot" />}
          </button>
        ))}
      </div>
      <textarea
        className="settings__editor"
        spellCheck={false}
        value={files[active] ?? ""}
        onChange={(e) => {
          setFiles((f) => ({ ...f, [active]: e.target.value }));
          setDirty((d) => ({ ...d, [active]: true }));
        }}
      />
      <div className="settings__actions">
        <button className="build__go" onClick={save} title="Save to disk (settings dir)">
          <Icon name="save" size={14} /> Save
        </button>
        <button className="build__cancel" onClick={reset}>
          <Icon name="sync" size={13} /> Reset
        </button>
        <span className="settings__hint">Stored in &lt;app&gt;/settings/*.json — local-first, no cloud.</span>
      </div>
    </div>
  );
};

export default SettingsView;