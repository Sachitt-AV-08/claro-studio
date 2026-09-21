import React, { useEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useClaroStore } from "./store/claroStore";
import { RenderTree } from "./preview/RenderTree";
import { AiPanel } from "./ai/AiPanel";
import { registerClaroLanguage, createClaroCompletionProvider } from "./dsl/claroLanguage";
import { format, parse } from "@project/dsl";

/** Debounce helper. */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const App: React.FC = () => {
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showAi, setShowAi] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const {
    source,
    project,
    errors,
    warnings,
    selection,
    inverseStack,
    forwardStack,
    setSource,
    select,
  } = useClaroStore();

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const debouncedSource = useDebounce(source, 150);

  // Register Claro language + completion on first mount
  useEffect(() => {
    registerClaroLanguage();
    monaco.languages.registerCompletionItemProvider(
      "claro",
      createClaroCompletionProvider(),
    );

    // Theme
    monaco.editor.setTheme("claro-dark");
  }, []);

  // Sync editor content when source changes (from undo/redo/AI)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (model.getValue() !== debouncedSource) {
      const pos = editor.getPosition();
      model.setValue(debouncedSource);
      if (pos) editor.setPosition(pos);
    }
  }, [debouncedSource]);

  // Handle editor text change → parse → reformat → preview
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    // Parse, then reformat to keep canonical source
    try {
      const parsed = parse(value);
      const canonical = format(parsed);
      setSource(canonical);
    } catch {
      // If parse throws (shouldn't), keep raw
      setSource(value);
    }
  };

  // Window controls via Electron API (graceful fallback in browser)
  const win = window.electronAPI;
  const minimize = () => win?.minimize();
  const maximize = () => {
    win?.maximize();
    setMaximized((m) => !m);
  };
  const close = () => win?.quit();

  useEffect(() => {
    if (!win) return;
    const unsubscribe = win.onMaximizeChange(setMaximized);
    return unsubscribe;
  }, [win]);

  return (
    <div className="app">
      {/* Titlebar */}
      <div
        className="titlebar"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="titlebar__brand">
          <span className="titlebar__brand-dot" />
          CLARO Studio
        </div>
        <div className="titlebar__file">{project.pages[0]?.name ?? "Home"}.cl</div>
        <div className="titlebar__spacer" />
        <div
          className="titlebar__controls"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <button className="titlebar__btn" onClick={minimize} title="Minimize">
            −
          </button>
          <button className="titlebar__btn" onClick={maximize} title={maximized ? "Restore" : "Maximize"}>
            {maximized ? "❐" : "☐"}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={close} title="Close">
            ✕
          </button>
        </div>
      </div>

      {/* Activity Bar */}
      <aside className="activitybar">
        <button
          className={`activitybar__btn ${showExplorer ? "activitybar__btn--active" : ""}`}
          onClick={() => setShowExplorer(!showExplorer)}
          title="Explorer (Ctrl+Shift+E)"
        >
          📁
        </button>
        <button
          className={`activitybar__btn ${showPreview ? "activitybar__btn--active" : ""}`}
          onClick={() => setShowPreview(!showPreview)}
          title="Preview (Ctrl+Shift+P)"
        >
          👁
        </button>
        <button
          className={`activitybar__btn ${showAi ? "activitybar__btn--active" : ""}`}
          onClick={() => setShowAi(!showAi)}
          title="AI Assistant"
        >
          🤖
        </button>
      </aside>

      {/* Workbench */}
      <main className={showAi ? "workbench" : "workbench workbench--no-ai"}>
        <div className="workbench__sash">
          {/* Explorer */}
          {showExplorer && (
            <aside className="pane pane--explorer" style={{ width: "var(--pane-explorer-width)" }}>
              <div className="pane__header">Explorer</div>
              <ul className="explorer__tree">
                <li
                  className="explorer__file"
                  onClick={() => select(project.pages[0]?.nodeId ?? null)}
                >
                  📄 {project.pages[0]?.name ?? "Home"}.cl
                </li>
                {project.components.length > 0 && (
                  <li className="explorer__file" style={{ paddingTop: "var(--space-6)" }}>
                    <strong style={{ fontSize: "var(--font-size-xs)", color: "var(--color-fg-muted)" }}>
                      COMPONENTS
                    </strong>
                  </li>
                )}
                {project.components.map((comp: import("@project/contracts").DslNode) => (
                  <li
                    key={comp.nodeId}
                    className="explorer__file"
                    onClick={() => select(comp.nodeId)}
                  >
                    ♻️ {comp.name ?? comp.type}
                  </li>
                ))}
              </ul>
            </aside>
          )}

          {/* Editor */}
          <section className="pane" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div className="pane__header">Editor</div>
            <Editor
              height="100%"
              defaultLanguage="claro"
              value={source}
              onChange={handleEditorChange}
              options={{
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                lineHeight: 22,
                minimap: { enabled: false },
                tabSize: 4,
                scrollBeyondLastLine: false,
                renderWhitespace: "none",
                automaticLayout: true,
                tabCompletion: "on",
                wordWrap: "off",
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true },
              }}
              onMount={(editor) => {
                editorRef.current = editor;
              }}
            />
          </section>

          {/* Preview */}
          {showPreview && (
            <aside className="pane pane--preview" style={{ width: "minmax(var(--pane-preview-min), 1fr)" }}>
              <div className="pane__header">Preview</div>
              <RenderTree project={project} selection={selection} onSelect={select} />
            </aside>
          )}
        </div>
      </main>

      {/* AI Panel */}
      {showAi && <AiPanel />}

      {/* Status Bar */}
      <footer className="statusbar">
        <div className="statusbar__item">
          <span className="statusbar__sum">
            {errors.length} error{errors.length !== 1 ? "s" : ""}
          </span>
          {errors.length && <span>|</span>}
          <span className="statusbar__sum">
            {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
          </span>
          {warnings.length && <span>|</span>}
          <span>Sel: {selection ?? "—"}</span>
          <span>|</span>
          <span>↶ {inverseStack.length} ↷ {forwardStack.length}</span>
          <span>|</span>
          <span>🌙 local-first</span>
        </div>
      </footer>
    </div>
  );
};