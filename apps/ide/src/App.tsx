import React, { useEffect, useMemo, useRef, useState } from "react";
import { Editor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useClaroStore } from "./store/claroStore";
import { DevicePreview } from "./preview/DevicePreview";
import { BhasmPanel } from "./ai/BhasmPanel";
import { ExtensionsView } from "./extensions/ExtensionsView";
import { StitchView } from "./stitch/StitchView";
import { TasksView } from "./tasks/TasksView";
import { BuildView } from "./build/BuildView";
import { CommandPalette, makeExportCommands, type PaletteCommand } from "./chrome/CommandPalette";
import { ProblemsPanel } from "./chrome/ProblemsPanel";
import { registerClaroLanguage, createClaroCompletionProvider, createIdeaHoverProvider, ideaAtLine, installWorkbenchLanguages } from "./dsl/claroLanguage";
import { format, parse } from "@project/dsl";
import { Icon, type IconName } from "./components/Icon";
import { Splitter } from "./components/Splitter";
import { KotlinPreview } from "./preview/KotlinPreview";
import { PythonConsole } from "./preview/PythonConsole";

// Use the bundled Monaco instance (vite-plugin-monaco-editor) instead of the
// CDN-loaded one that @monaco-editor/react pulls in by default. Without this,
// App.tsx registers the 'claro' language/theme on one instance while the Editor
// renders with a second instance -> white editor with no claro support.
loader.config({ monaco });

// Register the Claro language, completion + hover providers and dark theme once,
// before the Editor mounts, so the theme/language are available when the editor
// creates its instance (also avoids StrictMode double-registration).
registerClaroLanguage();
installWorkbenchLanguages();
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

type ViewId = "explorer" | "bhasm" | "stitch" | "tasks" | "extensions" | "build";

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
  { id: "build", icon: "package", title: "Build" },
];

type TabId = "cl" | "pkg" | "py" | "kt";

const EDITOR_LANG: Record<TabId, string> = {
  cl: "claro",
  pkg: "json",
  py: "python",
  kt: "kotlin",
};

const PY_STARTER = `# logic.py — complementary app logic
TITLE = "My App"
SUB = "Python powers the behaviour"
CLICKS = 0

def on_tap():
    global CLICKS
    CLICKS = CLICKS + 1
    print("tapped", CLICKS, "time(s)")

title(TITLE)
label(SUB)
button("Tap me", on_tap)
`;

const KT_STARTER = `@Composable
fun HomeScreen() {
    Column(modifier = Modifier.fillMaxWidth().padding(16)) {
        Text("Welcome to Kotlin", Modifier.padding(8))
        Button(onClick = { }) {
            Text("Tap me")
        }
        Spacer(modifier = Modifier.height(12))
        Row {
            Text("Row A", Modifier.padding(8))
            Text("Row B", Modifier.padding(8))
        }
    }
}
`;

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewId>("explorer");
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showAi, setShowAi] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [activityHidden, setActivityHidden] = useState(false);
  // Tabs: "cl" (Claro source), "pkg" (artifact JSON), "py" (logic.py), "kt" (screen.kt).
  const [tab, setTab] = useState<TabId>("cl");
  const [files, setFiles] = useState<{ py: string; kt: string }>({ py: PY_STARTER, kt: KT_STARTER });
  const [previewMode, setPreviewMode] = useState<"cl" | "py" | "kt">("cl");

  // Resizable split panes (persisted to localStorage).
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const MIN_EXPLORER = 180;
  const MAX_EXPLORER = 460;
  const MIN_PREVIEW = 300;
  const MAX_PREVIEW = 760;
  const DEFAULT_PANES = { explorer: 260, preview: 380 };
  const [paneWidths, setPaneWidths] = useState<{ explorer: number; preview: number }>(() => {
    try {
      const raw = localStorage.getItem("claro.workbench.panes");
      if (raw) {
        const v = JSON.parse(raw) as Partial<{ explorer: number; preview: number }>;
        return {
          explorer: clamp(v.explorer ?? DEFAULT_PANES.explorer, MIN_EXPLORER, MAX_EXPLORER),
          preview: clamp(v.preview ?? DEFAULT_PANES.preview, MIN_PREVIEW, MAX_PREVIEW),
        };
      }
    } catch {
      /* ignore corrupt storage */
    }
    return DEFAULT_PANES;
  });
  useEffect(() => {
    try {
      localStorage.setItem("claro.workbench.panes", JSON.stringify(paneWidths));
    } catch {
      /* ignore */
    }
  }, [paneWidths]);

  const [aiHeight, setAiHeight] = useState(240);
  const sashRef = useRef<HTMLDivElement>(null);

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

  // Shrink split panes to fit when the window gets too small for the editor.
  useEffect(() => {
    const el = sashRef.current;
    if (!el) return;
    let ro: ResizeObserver | undefined;
    try {
      ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        if (w <= 0) return;
        setPaneWidths((prev) => {
          const fixed = (showExplorer ? prev.explorer + 6 : 0) + (showPreview ? prev.preview + 6 : 0);
          const over = fixed + 300 - w;
          if (over <= 0) return prev;
          let shrink = Math.round(over);
          let explorer = prev.explorer;
          let preview = prev.preview;
          if (showExplorer) {
            const take = Math.min(explorer - MIN_EXPLORER, Math.ceil(shrink / 2));
            explorer -= take;
            shrink -= take;
          }
          if (showPreview) {
            preview = Math.max(MIN_PREVIEW, preview - shrink);
          }
          if (explorer === prev.explorer && preview === prev.preview) return prev;
          return { explorer, preview };
        });
      });
      ro.observe(el);
    } catch {
      /* ResizeObserver unavailable */
    }
    return () => ro?.disconnect();
  }, [showExplorer, showPreview]);

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

  // Handle editor text change → parse for diagnostics/preview only. Never
  // rewrite the model while the user is typing (auto-canonicalizing every
  // keystroke caused cursor jumps and broke undo). Formatting happens on
  // demand via Format Document (Ctrl+K).
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    setSource(value);
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
        if (view === "bhasm") {
          setShowAi(true);
          return;
        }
        setActiveView(view);
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

  // The preview follows the active tab (Claro UI / Python console / Kotlin compose).
  useEffect(() => {
    if (tab === "cl" || tab === "py" || tab === "kt") setPreviewMode(tab);
  }, [tab]);

  const pageName = project.pages[0]?.name ?? "Home";
  const activeFileName = `${pageName}.cl`;
  const pkgFileName = `${pageName}.package.json`;

  const tabFileNames: Record<TabId, string> = {
    cl: activeFileName,
    pkg: pkgFileName,
    py: "logic.py",
    kt: "screen.kt",
  };

  const editorValue =
    tab === "cl"
      ? source
      : tab === "pkg"
        ? JSON.stringify(project, null, 2)
        : tab === "py"
          ? files.py
          : files.kt;

  const handleAnyChange = (value: string | undefined) => {
    if (value === undefined) return;
    if (tab === "cl") handleEditorChange(value);
    else if (tab === "py") setFiles((f) => ({ ...f, py: value }));
    else if (tab === "kt") setFiles((f) => ({ ...f, kt: value }));
  };

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
        id: "view.build",
        label: "Build App Package (EXE installer)",
        group: "build",
        icon: "package" as IconName,
        run: () => go("build"),
      },
      {
        id: "editor.format",
        label: "Format Document (Ctrl+K)",
        group: "editor",
        icon: "code" as IconName,
        run: () => formatRef.current(),
      },
      {
        id: "bhasm.seed.cursor",
        label: "Seed BHASM from idea at cursor",
        group: "bhasm",
        icon: "comment" as IconName,
        run: () => {
          const editor = editorRef.current;
          const pos = editor?.getPosition();
          if (!editor || !pos) return;
          const line = editor.getModel()?.getLineContent(pos.lineNumber) ?? "";
          const idea = ideaAtLine(line);
          if (!idea) return;
          setShowAi(true);
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("claro:bhasm-prompt", { detail: { idea, mode: "explain-comment" } }),
            );
          }, 80);
        },
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

  // Format Document: canonicalize the open source without fighting the cursor.
  const formatDocument = () => {
    const editor = editorRef.current;
    if (!editor || tab !== "cl") return;
    const model = editor.getModel();
    if (!model) return;
    try {
      const canonical = format(parse(model.getValue()));
      const pos = editor.getPosition();
      const sel = editor.getSelection();
      editor.pushUndoStop();
      model.setValue(canonical);
      editor.pushUndoStop();
      if (pos) editor.setPosition(pos);
      if (sel && !sel.isEmpty()) editor.setSelection(sel);
    } catch {
      /* leave the text as-is when it won't parse */
    }
  };
  const formatRef = useRef(formatDocument);
  formatRef.current = formatDocument;

  // double-click on a "#" idea line → seed BHASM explain-comment
  const mountEditor = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    editor.addAction({
      id: "claro.format-document",
      label: "Format Document",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => formatRef.current(),
    });
    editor.onMouseDown((e) => {
      if (e.event.detail < 2) return;
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
      // short delay so the panel mounts before we dispatch the seed fill
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("claro:bhasm-prompt", { detail: { idea, mode: "explain-comment" } }));
      }, 80);
    };
    window.addEventListener("claro:bhasm-seed", onSeed);
    return () => window.removeEventListener("claro:bhasm-seed", onSeed);
  }, []);

  return (
    <div className={`app${activityHidden ? " app--activity-hidden" : ""}${showAi ? " app--bottom-open" : ""}`}>
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
          CLARO Workbench
        </div>
        <button
          className="titlebar__palette"
          onClick={() => setPaletteOpen(true)}
          title="Command Palette (Ctrl+Shift+P)"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <Icon name="search" size={13} /> {tabFileNames[tab]}
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
            <span className="tab__label">{tabFileNames.cl}</span>
          </button>
          <button
            className={`tab${tab === "py" ? " tab--active" : ""}`}
            onClick={() => setTab("py")}
            title="logic.py · Python logic (preview: console runtime)"
          >
            <Icon name="file-text" size={14} />
            <span className="tab__label">logic.py</span>
          </button>
          <button
            className={`tab${tab === "kt" ? " tab--active" : ""}`}
            onClick={() => setTab("kt")}
            title="screen.kt · Kotlin Compose (preview: rendered composables)"
          >
            <Icon name="file-code" size={14} />
            <span className="tab__label">screen.kt</span>
          </button>
          <button
            className={`tab${tab === "pkg" ? " tab--active" : ""}`}
            onClick={() => setTab("pkg")}
            title={`${pkgFileName} · exported artifact (JSON)`}
          >
            <Icon name="file-text" size={14} />
            <span className="tab__label">{tabFileNames.pkg}</span>
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
              if (view.id === "bhasm") {
                setShowAi((v) => !v);
                return;
              }
              setActiveView(view.id);
              if (view.id === "explorer") setShowExplorer(true);
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
      <main className={`workbench${showProblems ? "" : " workbench--no-problems"}`}>
        <div ref={sashRef} className={`workbench__sash${activeView === "explorer" ? "" : " view-slot--hidden"}`}>
          {/* Explorer */}
          {showExplorer && (
            <aside className="pane pane--explorer" style={{ width: paneWidths.explorer, flex: "0 0 auto" }}>
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
                <li className="explorer__group-label">LOGIC</li>
                <li className="explorer__file" onClick={() => setTab("py")} title="logic.py — Python logic">
                  <Icon name="file-text" size={15} />
                  <span>logic.py</span>
                </li>
                <li className="explorer__file" onClick={() => setTab("kt")} title="screen.kt — Kotlin Compose">
                  <Icon name="file-code" size={15} />
                  <span>screen.kt</span>
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

          {showExplorer && (
            <Splitter
              onDelta={(d) => setPaneWidths((w) => ({ ...w, explorer: clamp(w.explorer + d, MIN_EXPLORER, MAX_EXPLORER) }))}
              onReset={() => setPaneWidths((w) => ({ ...w, explorer: DEFAULT_PANES.explorer }))}
            />
          )}

          {/* Editor */}
          <section className="pane pane--editor" style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div className="pane__header pane__header--editor">
              <span>
                <Icon name="code" size={12} /> {tabFileNames[tab]}
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
              defaultLanguage={EDITOR_LANG[tab]}
              language={EDITOR_LANG[tab]}
              key={tab}
              value={editorValue}
              onChange={handleAnyChange}
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
            <>
              <Splitter
                onDelta={(d) => setPaneWidths((w) => ({ ...w, preview: clamp(w.preview - d, MIN_PREVIEW, MAX_PREVIEW) }))}
                onReset={() => setPaneWidths((w) => ({ ...w, preview: DEFAULT_PANES.preview }))}
              />
              <aside className="pane pane--preview" style={{ width: paneWidths.preview, flex: "0 0 auto" }}>
              <div className="pane__header">
                <span>
                  <Icon name="eye" size={12} /> Preview
                  <span className="preview__mode">
                    {previewMode === "cl" ? "Claro UI" : previewMode === "py" ? "Python" : "Kotlin"}
                  </span>
                </span>
                <button className="pane__action" title="Device toggle (phone/tablet/desktop)">
                  <Icon name="device-mobile" size={14} />
                </button>
              </div>
              {previewMode === "py" ? (
                <PythonConsole source={files.py} />
              ) : previewMode === "kt" ? (
                <KotlinPreview source={files.kt} />
              ) : (
                <DevicePreview project={project} selection={selection} onSelect={select} />
              )}
            </aside>
            </>
          )}
          </div>
        <section className={`view-slot${activeView === "stitch" ? "" : " view-slot--hidden"}`}>
          <StitchView />
        </section>
        <section className={`view-slot${activeView === "tasks" ? "" : " view-slot--hidden"}`}>
          <TasksView />
        </section>
        <section className={`view-slot${activeView === "extensions" ? "" : " view-slot--hidden"}`}>
          <ExtensionsView />
        </section>
        <section className={`view-slot${activeView === "build" ? "" : " view-slot--hidden"}`}>
          <BuildView project={project} pyCode={files.py} ktCode={files.kt} />
        </section>
        {showProblems && activeView === "explorer" && (
          <ProblemsPanel
            errors={errors}
            warnings={warnings}
            onJump={jumpToLine}
            onClose={() => setShowProblems(false)}
          />
        )}
      </main>

      {/* BHASM panel */}
      {showAi && (
        <>
          <Splitter
            axis="row"
            onDelta={(d) => setAiHeight((h) => clamp(h + d, 168, 520))}
            onReset={() => setAiHeight(240)}
            title="Drag to resize BHASM panel · double-click to reset"
          />
          <BhasmPanel onToggle={() => setShowAi(false)} height={aiHeight} />
        </>
      )}

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