import React, { useEffect, useMemo, useRef, useState } from "react";
import { Editor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useClaroStore } from "./store/claroStore";
import { DevicePreview } from "./preview/DevicePreview";
import { BhasmPanel } from "./ai/BhasmPanel";
import { ExtensionsView } from "./extensions/ExtensionsView";
import { StitchView } from "./stitch/StitchView";
import { TasksView } from "./tasks/TasksView";
import { CommandPalette, makeExportCommands, type PaletteCommand } from "./chrome/CommandPalette";
import { ProblemsPanel } from "./chrome/ProblemsPanel";
import { registerClaroLanguage, createClaroCompletionProvider, createIdeaHoverProvider, ideaAtLine } from "./dsl/claroLanguage";
import { format, parse } from "@project/dsl";
import { Icon, type IconName } from "./components/Icon";

// Use the bundled Monaco instance (vite-plugin-monaco-editor) instead of the
// CDN-loaded one that @monaco-editor/react pulls in by default. Without this,
// App.tsx registers the 'claro' language/theme on one instance while the Editor
// renders with a second instance -> white editor with no claro support.
loader.config({ monaco });

// Register the Claro language, completion + hover providers and dark theme once,
// before the Editor mounts, so the theme/language are available when the editor
// creates its instance (also avoids StrictMode double-registration).
registerClaroLanguage();
monaco.languages.registerCompletionItemProvider("claro", createClaroCompletionProvider());
monaco.languages.registerHoverProvider("claro", createIdeaHoverProvider());

/** Debounce helper. */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type ViewId = "explorer" | "bhasm" | "stitch" | "tasks" | "extensions";

interface ViewDef {
  id: ViewId;
  icon: IconName;
  title: string;
}

const ACTIVITY_VIEWS: ViewDef[] = [
  { id: "explorer", icon: "files", title: "Explorer" },
  { id: "stitch", icon: "diff", title: "Stitch" },
  { id: "bhasm", icon: "sparkle", title: "BHASM" },
  { id: "tasks", icon: "checklist", title: "Tasks" },
  { id: "extensions", icon: "extensions", title: "Extensions" },
];

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewId>("explorer");
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showAi, setShowAi] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [activityHidden, setActivityHidden] = useState(false);
  // Multi-language tabs: "cl" (the Claro source) or "pkg" (the artifact JSON).
  const [tab, setTab] = useState<"cl" | "pkg">("cl");

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

  // Sync editor content when source changes (from undo/redo/AI)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || tab !== "cl") return;
    const model = editor.getModel();
    if (!model) return;
    if (model.getValue() !== debouncedSource) {
      const pos = editor.getPosition();
      model.setValue(debouncedSource);
      if (pos) editor.setPosition(pos);
    }
  }, [debouncedSource, tab]);

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
    const onView = (e: Event) => {
      const view = (e as CustomEvent).detail;
      if (view === "stitch" || view === "bhasm" || view === "tasks") {
        setActiveView(view);
        if (view === "bhasm") setShowAi(true);
      }
    };
    window.addEventListener("claro:view", onView);
    return () => window.removeEventListener("claro:view", onView);
  }, []);

  // Global command palette shortcuts: Ctrl+Shift+P / F1 / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "F1") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (tab === "cl") return; // leave Ctrl+K for the editor
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  useEffect(() => {
    if (!win) return;
    const unsubscribe = win.onMaximizeChange(setMaximized);
    return unsubscribe;
  }, [win]);

  const pageName = project.pages[0]?.name ?? "Home";
  const activeFileName = `${pageName}.cl`;
  const pkgFileName = `${pageName}.package.json`;

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const go = (view: ViewId) => {
      setActiveView(view);
      if (view === "bhasm") setShowAi(true);
    };
    const exportCmds = makeExportCommands(project);
    return [
      ...exportCmds,
      {
        id: "view.stitch",
        label: "Open Stitch seam",
        group: "view",
        icon: "diff" as IconName,
        run: () => go("stitch"),
      },
      {
        id: "view.bhasm",
        label: "Toggle BHASM panel",
        group: "view",
        icon: "sparkle" as IconName,
        run: () => setShowAi((v) => !v),
      },
      {
        id: "view.tasks",
        label: "Open team Tasks board",
        group: "view",
        icon: "checklist" as IconName,
        run: () => go("tasks"),
      },
      {
        id: "view.problems",
        label: "Toggle Problems panel",
        group: "view",
        icon: "issues" as IconName,
        run: () => setShowProblems((v) => !v),
      },
      {
        id: "tab.pkg",
        label: `Open artifact tab (${pkgFileName})`,
        group: "tab",
        icon: "file-text" as IconName,
        run: () => setTab("pkg"),
      },
      {
        id: "tab.cl",
        label: `Open source tab (${activeFileName})`,
        group: "tab",
        icon: "file-code" as IconName,
        run: () => setTab("cl"),
      },
      {
        id: "view.preview",
        label: showPreview ? "Hide preview pane" : "Show preview pane",
        group: "view",
        icon: "eye" as IconName,
        run: () => setShowPreview((v) => !v),
      },
      {
        id: "bhasm.seed",
        label: "Seed BHASM from the top # idea",
        group: "bhasm",
        icon: "comment" as IconName,
        run: () => {
          const m = source.split(/\r?\n/).find((l) => /^\s*#\s+(.+)$/.test(l));
          const idea = m ? m.match(/#\s+(.+)/)?.[1] ?? null : null;
          if (!idea) return;
          setShowAi(true);
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("claro:bhasm-prompt", { detail: { idea, mode: "explain-comment" } }),
            );
          }, 80);
        },
      },
    ];
  }, [project, source, showPreview, activeFileName, pkgFileName]);

  const jumpToLine = (line: number) => {
    const editor = editorRef.current;
    if (!editor || tab !== "cl") {
      setTab("cl");
      return;
    }
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  };

  // single-click on a "#" idea line → seed BHASM explain-comment
  const mountEditor = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    editor.onMouseDown((e) => {
      const pos = e.target.position;
      if (!pos) return;
      const line = editor.getModel()?.getLineContent(pos.lineNumber) ?? "";
      const idea = ideaAtLine(line);
      if (!idea) return;
      editor.setSelection(
        new monaco.Range(pos.lineNumber, 1, pos.lineNumber, line.length + 1),
      );
      window.dispatchEvent(
        new CustomEvent("claro:bhasm-seed", { detail: { idea } }),
      );
    });
  };

  // consume claro:bhasm-seed → open panel + fill prompt (explain-comment mode)
  useEffect(() => {
    const onSeed = (e: Event) => {
      const { idea } = (e as CustomEvent).detail as { idea: string };
      setShowAi(true);
      window.dispatchEvent(new CustomEvent("claro:view", { detail: "bhasm" }));
      // short delay so the panel mounts before we dispatch the seed fill
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("claro:bhasm-prompt", { detail: { idea, mode: "explain-comment" } }));
      }, 80);
    };
    window.addEventListener("claro:bhasm-seed", onSeed);
    return () => window.removeEventListener("claro:bhasm-seed", onSeed);
  }, []);

  return (
    <div className={`app${activityHidden ? " app--activity-hidden" : ""}`}>
      {/* Titlebar */}
      <div className="titlebar" style={{ WebkitAppRegion: "drag" }}>
        <button
          className={`titlebar__toggle${activityHidden ? " titlebar__toggle--active" : ""}`}
          onClick={() => setActivityHidden((v) => !v)}
          title="Toggle Activity Bar"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <Icon name="layout" size={15} />
        </button>
        <div className="titlebar__brand">
          <Icon name="sparkle" size={14} />
          CLARO Studio
        </div>
        <button
          className="titlebar__palette"
          onClick={() => setPaletteOpen(true)}
          title="Command Palette (Ctrl+Shift+P)"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <Icon name="search" size={13} /> {tab === "cl" ? activeFileName : pkgFileName}
        </button>
        <div className="titlebar__spacer" />
        <div className="titlebar__controls" style={{ WebkitAppRegion: "no-drag" }}>
          <button className="titlebar__btn" onClick={minimize} title="Minimize">
            <Icon name="chrome-minimize" size={14} />
          </button>
          <button className="titlebar__btn" onClick={maximize} title={maximized ? "Restore" : "Maximize"}>
            <Icon name={maximized ? "chrome-restore" : "chrome-maximize"} size={14} />
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={close} title="Close">
            <Icon name="chrome-close" size={14} />
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="tabstrip" style={{ WebkitAppRegion: "no-drag" }}>
        <div className="tabstrip__tabs">
          <button
            className={`tab${tab === "cl" ? " tab--active" : ""}`}
            onClick={() => setTab("cl")}
            title={activeFileName}
          >
            <Icon name="file-code" size={14} />
            <span className="tab__label">{activeFileName}</span>
          </button>
          <button
            className={`tab${tab === "pkg" ? " tab--active" : ""}`}
            onClick={() => setTab("pkg")}
            title={`${pkgFileName} · exported artifact (JSON)`}
          >
            <Icon name="file-text" size={14} />
            <span className="tab__label">{pkgFileName}</span>
          </button>
        </div>
        <div className="tabstrip__actions">
          <button
            className="tabstrip__action tabstrip__action--active"
            onClick={() => {
              setActiveView("stitch");
            }}
            title="Open Stitch view"
          >
            <Icon name="diff" size={15} />
          </button>
          <button
            className="tabstrip__action"
            onClick={() => makeExportCommands(project)[0].run()}
            title="Export single-file HTML"
          >
            <Icon name="rocket" size={15} />
          </button>
          <button
            className="tabstrip__action"
            onClick={() => setPaletteOpen(true)}
            title="Command Palette (Ctrl+Shift+P)"
          >
            <Icon name="search" size={15} />
          </button>
        </div>
      </div>

      {/* Activity Bar */}
      <aside className="activitybar">
        {ACTIVITY_VIEWS.map((view) => (
          <button
            key={view.id}
            className={`activitybar__btn ${activeView === view.id ? "activitybar__btn--active" : ""}`}
            onClick={() => {
              setActiveView(view.id);
              if (view.id === "explorer") setShowExplorer(true);
              if (view.id === "bhasm") setShowAi(true);
            }}
            title={view.title}
          >
            <Icon name={view.icon} size={19} />
          </button>
        ))}
        <div className="activitybar__spacer" />
        <button
          className={`activitybar__btn ${showPreview ? "activitybar__btn--active" : ""}`}
          onClick={() => setShowPreview(!showPreview)}
          title="Toggle Preview"
        >
          <Icon name="eye" size={19} />
        </button>
      </aside>

      {/* Workbench */}
      <main className={`workbench${showAi ? "" : " workbench--no-ai"}`}>
        {activeView === "extensions" ? (
          <ExtensionsView />
        ) : activeView === "stitch" ? (
          <StitchView />
        ) : activeView === "tasks" ? (
          <TasksView />
        ) : (
          <div className="workbench__sash">
          {/* Explorer */}
          {showExplorer && (
            <aside className="pane pane--explorer" style={{ width: "var(--pane-explorer-width)" }}>
              <div className="pane__header">
                <span>Explorer</span>
                <button className="pane__action" title="New file (coming soon)" disabled>
                  <Icon name="new-file" size={14} />
                </button>
              </div>
              <ul className="explorer__tree">
                <li className="explorer__file explorer__file--active" onClick={() => select(project.pages[0]?.nodeId ?? null)}>
                  <Icon name="file-code" size={15} />
                  <span>{activeFileName}</span>
                </li>
                <li className="explorer__file" onClick={() => setTab("pkg")}>
                  <Icon name="file-text" size={15} />
                  <span>{pkgFileName}</span>
                </li>
                {project.components.length > 0 && (
                  <li className="explorer__group-label">COMPONENTS</li>
                )}
                {project.components.map((comp: import("@project/contracts").DslNode) => (
                  <li
                    key={comp.nodeId}
                    className="explorer__file"
                    onClick={() => select(comp.nodeId)}
                  >
                    <Icon name="file-code" size={15} />
                    <span>{comp.name ?? comp.type}</span>
                  </li>
                ))}
              </ul>
            </aside>
          )}

          {/* Editor */}
          <section className="pane pane--editor" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div className="pane__header pane__header--editor">
              <span>
                <Icon name="code" size={12} /> {tab === "cl" ? "Editor" : "Artifact"}
              </span>
              <span className="pane__sub">
                {tab === "cl" ? (
                  <button
                    className="pane__sub-btn"
                    onClick={() => setShowProblems((v) => !v)}
                    title="Open Problems"
                  >
                    {errors.length} <Icon name="error" size={12} /> {warnings.length} <Icon name="warning" size={12} />
                  </button>
                ) : (
                  <span>generated · read-only</span>
                )}
              </span>
            </div>
            <Editor
              height="100%"
              theme="claro-dark"
              defaultLanguage={tab === "cl" ? "claro" : "json"}
              language={tab === "cl" ? "claro" : "json"}
              key={tab}
              value={tab === "cl" ? source : JSON.stringify(project, null, 2)}
              onChange={tab === "cl" ? handleEditorChange : undefined}
              options={{
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                lineHeight: 22,
                minimap: { enabled: false },
                tabSize: 2,
                scrollBeyondLastLine: false,
                renderWhitespace: "none",
                automaticLayout: true,
                tabCompletion: "on",
                wordWrap: "off",
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true },
                readOnly: tab === "pkg",
              }}
              onMount={mountEditor}
            />
          </section>

          {/* Preview */}
          {showPreview && (
            <aside className="pane pane--preview" style={{ width: "minmax(var(--pane-preview-min), 1fr)" }}>
              <div className="pane__header">
                <span>
                  <Icon name="eye" size={12} /> Preview
                </span>
                <button className="pane__action" title="Device toggle (phone/tablet/desktop)">
                  <Icon name="device-mobile" size={14} />
                </button>
              </div>
              <DevicePreview project={project} selection={selection} onSelect={select} />
            </aside>
          )}
          </div>
        )}
        {showProblems && (
          <ProblemsPanel
            errors={errors}
            warnings={warnings}
            onJump={jumpToLine}
            onClose={() => setShowProblems(false)}
          />
        )}
      </main>

      {/* BHASM panel */}
      {showAi && <BhasmPanel onToggle={() => setShowAi(false)} />}

      {/* Command Palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} makeCommands={() => paletteCommands} />

      {/* Status Bar */}
      <footer className="statusbar">
        <div className="statusbar__group">
          <button className="statusbar__item statusbar__item--click" title="Open Problems" onClick={() => setShowProblems((v) => !v)}>
            <Icon name={errors.length ? "error" : "check"} size={13} />
            <span>{errors.length}</span>
          </button>
          <button className="statusbar__item statusbar__item--click" title="Open Problems" onClick={() => setShowProblems((v) => !v)}>
            <Icon name={warnings.length ? "warning" : "info"} size={13} />
            <span>{warnings.length}</span>
          </button>
          <span className="statusbar__sep" />
          <div className="statusbar__item" title="Undo history">
            <Icon name="history" size={13} />
            <span>{inverseStack.length}</span>
          </div>
          <div className="statusbar__item" title="Redo stack">
            <Icon name="redo" size={13} />
            <span>{forwardStack.length}</span>
          </div>
          <div className="statusbar__item" title="Selected node">
            <Icon name="target" size={13} />
            <span>{selection ?? "—"}</span>
          </div>
        </div>
        <div className="statusbar__spacer" />
        <div className="statusbar__group">
          <button className="statusbar__item statusbar__item--click" onClick={() => setPaletteOpen(true)} title="Command Palette (Ctrl+Shift+P)">
            <Icon name="search" size={13} />
            <span>palette</span>
          </button>
          <div className="statusbar__item" title="Branch">
            <Icon name="git-branch" size={13} />
            <span>agent-2/ide</span>
          </div>
          <div className="statusbar__item" title="Local-first, offline AI">
            <Icon name="lock" size={13} />
            <span>local-first</span>
          </div>
          <div className="statusbar__item statusbar__item--accent">
            <Icon name="sparkle" size={13} />
            <span>BHASM ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
};