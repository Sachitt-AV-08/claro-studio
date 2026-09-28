import React, { useEffect, useMemo, useRef, useState } from "react";
import { Editor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useClaroStore } from "./store/claroStore";
import { DevicePreview } from "./preview/DevicePreview";
import { BhasmPanel } from "./ai/BhasmPanel";
import { ExtensionsView } from "./extensions/ExtensionsView";
import { SettingsView } from "./settings/SettingsView";
import { useClaroSettings } from "./settings/useClaroSettings";
import { StitchView } from "./stitch/StitchView";
import { TasksView } from "./tasks/TasksView";
import { BuildView } from "./build/BuildView";
import { TerminalPanel, type TermLine } from "./components/TerminalPanel";
import { CommandPalette, makeExportCommands, type PaletteCommand } from "./chrome/CommandPalette";
import { ProblemsPanel } from "./chrome/ProblemsPanel";
import { registerClaroLanguage, createClaroCompletionProvider, createIdeaHoverProvider, ideaAtLine, ideaLines, installWorkbenchLanguages } from "./dsl/claroLanguage";
import { format, parse } from "@project/dsl";
import { Icon, type IconName } from "./components/Icon";
import { Splitter } from "./components/Splitter";
import { KotlinPreview } from "./preview/KotlinPreview";
import { PythonConsole } from "./preview/PythonConsole";
import { useMcpStore } from "./graph/mcpStore";
import { discoverGraphJson, loadBhasmGraphSettings, type BhasmGraphSettings } from "./graph/graphSettings";
import { JudgingTour } from "./tour/JudgingTour";
import { DEMO_SOURCE, DEMO_EDIT_PROMPT } from "./tour/demoScreen";
import { useMetricsStore } from "./bhasm/metricsStore";

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

type ViewId = "explorer" | "bhasm" | "stitch" | "tasks" | "extensions" | "build" | "settings";

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
  { id: "settings", icon: "settings-gear", title: "Settings" },
];

type TabId = "cl" | "pkg" | "py" | "kt";

// Extra workspace documents opened via Explorer "New file" / File… Open.
interface OpenDoc {
  id: string;
  name: string;
  path?: string;
  lang: string;
  content: string;
  dirty?: boolean;
}

const EXT_LANG: Record<string, string> = {
  cl: "claro",
  py: "python",
  kt: "kotlin",
  json: "json",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "html",
  css: "css",
  md: "markdown",
  txt: "plaintext",
};

function langForName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

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
  const [openDocs, setOpenDocs] = useState<OpenDoc[]>([]);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
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
  const [gitBranch, setGitBranch] = useState<string>("—");
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const settings = useClaroSettings();
  const sashRef = useRef<HTMLDivElement>(null);
  const termFeed = useRef<((l: TermLine) => void) | null>(null);

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

  // Live-apply Settings.json to the open editor and any future ones.
  const { "editor.fontSize": fontSize, "editor.tabSize": tabSize, "editor.wordWrap": wordWrap } = settings;
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, tabSize, wordWrap });
  }, [fontSize, tabSize, wordWrap]);

  // Handle editor text change → parse for diagnostics/preview only. Never
  // rewrite the model while the user is typing (auto-canonicalizing every
  // keystroke caused cursor jumps and broke undo). Formatting happens on
  // demand via Format Document (Ctrl+K).
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    setSource(value);
  };

  // Squiggles in the editor mirror the same diagnostics the Problems panel
  // renders (one store -> both surfaces; the panel stays the clickable index).
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model) return;
    const markers = [...errors, ...warnings].map((d) => {
      const startColumn = Math.max(1, d.range?.start.col ?? 1);
      const endColumnFromRange = d.range?.end.col ?? startColumn;
      return {
        severity:
          d.severity === "error"
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        message: d.message,
        startLineNumber: d.range?.start.line ?? 1,
        startColumn,
        endLineNumber: d.range?.end.line ?? d.range?.start.line ?? 1,
        endColumn: Math.max(startColumn + 1, endColumnFromRange),
      };
    });
    monaco.editor.setModelMarkers(model, "claro-problems", markers);
  }, [errors, warnings]);

  // Debug breakpoints → red gutter dots
  const debugDecosRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!debugDecosRef.current) debugDecosRef.current = editor.createDecorationsCollection();
    const decorations = breakpoints.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: "claro-debug-breakpoint",
        glyphMarginHoverMessage: { value: `Breakpoint · line ${line}` },
      },
    }));
    debugDecosRef.current.set(decorations);
  }, [breakpoints]);

  // "#" idea comments → violet gutter badge (double-click/Tab seeds BHASM)
  const ideaDecosRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!ideaDecosRef.current) ideaDecosRef.current = editor.createDecorationsCollection();
    const decorations = ideaLines(debouncedSource).map((line) => {
      const text = editor.getModel()?.getLineContent(line) ?? "";
      const idea = ideaAtLine(text) ?? "";
      return {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "claro-idea-badge",
          glyphMarginHoverMessage: {
            value: `**Idea** — ${idea}\n\ndouble-click or press **Tab** to ask BHASM.`,
          },
        },
      };
    });
    ideaDecosRef.current.set(decorations);
  }, [debouncedSource]);

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

  // Judging Tour actions (dispatched by the tour overlay / palette).
  useEffect(() => {
    const onTour = (e: Event) => {
      const { action } = (e as CustomEvent).detail as { action?: string };
      if (!action || action === "open") return;
      if (action === "load-demo") {
        setActiveView("explorer");
        setShowExplorer(true);
        setShowPreview(true);
        setActiveDoc(null);
        setTab("cl");
        setTimeout(() => {
          useClaroStore.getState().setSource(DEMO_SOURCE);
          useMetricsStore.getState().reset();
        }, 40);
      } else if (action === "edit-demo") {
        setShowExplorer(true);
        setShowPreview(true);
        setShowAi(true);
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("claro:bhasm-prompt", { detail: { idea: DEMO_EDIT_PROMPT, mode: "code" } }),
          );
        }, 120);
      } else if (action === "step-back") {
        useClaroStore.getState().undo();
        setActiveView("stitch");
      }
    };
    window.addEventListener("claro:tour", onTour);
    return () => window.removeEventListener("claro:tour", onTour);
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const doc = openDocs.find((d) => d.id === activeDoc);
        if (doc) void saveDocRef.current();
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

  // Git branch in statusbar — fetch on mount and poll every 5s
  useEffect(() => {
    const fetchBranch = async () => {
      try {
        const branch = await win?.claroGitBranch?.();
        if (branch) setGitBranch(branch);
      } catch {
        setGitBranch("error");
      }
    };
    fetchBranch();
    const id = setInterval(fetchBranch, 5000);
    return () => clearInterval(id);
  }, [win]);

  // ---- Graphify MCP sidecar lifecycle (Phase 3) ----
  // Loads bhasm.json settings once (and on every change), refreshes sidecar
  // status on a 5s poll, and auto-starts the graph server when a graph.json is
  // configured or discovered next to an opened Claro file.
  const [graphCfg, setGraphCfg] = useState<BhasmGraphSettings | null>(null);
  const mcpRunning = useMcpStore((s) => s.status?.running ?? false);
  const mcpTools = useMcpStore((s) => s.status?.tools?.length ?? 0);
  const mcpError = useMcpStore((s) => s.status?.error);

  useEffect(() => {
    let mounted = true;
    const reload = async () => {
      const cfg = await loadBhasmGraphSettings();
      if (mounted) setGraphCfg(cfg);
    };
    reload();
    window.addEventListener("claro:settings-changed", reload);
    const id = setInterval(() => void useMcpStore.getState().refresh(), 5000);
    useMcpStore.getState().refresh();
    return () => {
      mounted = false;
      window.removeEventListener("claro:settings-changed", reload);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!graphCfg) return;
    if (graphCfg.autoStart && graphCfg.graphJson && !mcpRunning) {
      void useMcpStore.getState().start({ graphJson: graphCfg.graphJson, python: graphCfg.python });
    }
  }, [graphCfg, mcpRunning]);

  const autoStartForFile = async (filePath?: string) => {
    const cfg = graphCfg ?? (await loadBhasmGraphSettings());
    if (!cfg || cfg.autoStart === false) return;
    const running = useMcpStore.getState().status?.running;
    if (running) return;
    const graphJson = cfg.graphJson ?? (await discoverGraphJson(filePath));
    if (graphJson) await useMcpStore.getState().start({ graphJson, python: cfg.python });
  };
  const startSidecar = async () => {
    const cfg = graphCfg ?? (await loadBhasmGraphSettings());
    const graphJson = cfg.graphJson ?? (await discoverGraphJson(activeOpenDoc?.path));
    if (graphJson) await useMcpStore.getState().start({ graphJson, python: cfg.python });
  };

  // The preview follows the active tab (Claro UI / Python console / Kotlin compose).
  useEffect(() => {
    if (!activeDoc && (tab === "cl" || tab === "py" || tab === "kt")) setPreviewMode(tab);
  }, [tab, activeDoc]);

  // Open a file from disk into a new workspace tab.
  const openFile = async () => {
    const res = await window.electronAPI?.claroFileOpen?.();
    if (!res?.ok || !res.name || res.content === undefined) return;
    const id = `doc-${Date.now()}`;
    setOpenDocs((docs) => [...docs, { id, name: res.name as string, path: res.path, lang: langForName(res.name as string), content: res.content as string }]);
    setActiveDoc(id);
    void autoStartForFile(res.path);
  };

  const saveDoc = async () => {
    const doc = openDocs.find((d) => d.id === activeDoc);
    if (!doc) return;
    const res = await window.electronAPI?.claroFileSave?.({ path: doc.path, name: doc.name, content: doc.content });
    if (res?.ok && res.path) {
      setOpenDocs((docs) => docs.map((d) => (d.id === doc.id ? { ...d, path: res.path as string, dirty: false } : d)));
    }
  };
  const saveDocRef = useRef(saveDoc);
  saveDocRef.current = saveDoc;

  const closeDoc = (id: string) => {
    setOpenDocs((docs) => docs.filter((d) => d.id !== id));
    if (activeDoc === id) setActiveDoc(null);
  };

  const pageName = project.pages[0]?.name ?? "Home";
  const activeFileName = `${pageName}.cl`;
  const pkgFileName = `${pageName}.package.json`;

  const tabFileNames: Record<TabId, string> = {
    cl: activeFileName,
    pkg: pkgFileName,
    py: "logic.py",
    kt: "screen.kt",
  };

  const activeOpenDoc = openDocs.find((d) => d.id === activeDoc) ?? null;

  const editorValue = activeOpenDoc
    ? activeOpenDoc.content
    : tab === "cl"
      ? source
      : tab === "pkg"
        ? JSON.stringify(project, null, 2)
        : tab === "py"
          ? files.py
          : files.kt;

  const editorLang = activeOpenDoc ? activeOpenDoc.lang : EDITOR_LANG[tab];

  const handleAnyChange = (value: string | undefined) => {
    if (value === undefined) return;
    if (activeOpenDoc) {
      setOpenDocs((docs) => docs.map((d) => (d.id === activeOpenDoc.id ? { ...d, content: value, dirty: true } : d)));
    } else if (tab === "cl") handleEditorChange(value);
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
        id: "view.settings",
        label: "Open Settings (JSON)",
        group: "view",
        icon: "settings-gear" as IconName,
        run: () => go("settings"),
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
        run: () => {
          setActiveDoc(null);
          setTab("cl");
        },
      },
      {
        id: "file.open",
        label: "Open file… (Explorer)",
        group: "file",
        icon: "folder-opened" as IconName,
        run: () => openFile(),
      },
      {
        id: "file.save",
        label: "Save current file (Ctrl+S)",
        group: "file",
        icon: "save" as IconName,
        run: () => saveDocRef.current(),
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
      {
        id: "graph.toggle",
        label: mcpRunning ? "Graph: stop graphify sidecar" : "Graph: start graphify sidecar",
        group: "graph",
        icon: "graph" as IconName,
        run: () => {
          if (mcpRunning) {
            void useMcpStore.getState().stop();
          } else {
            void startSidecar();
          }
        },
      },
      {
        id: "tour.open",
        label: "Start Judging Tour (Ctrl+Shift+J)",
        group: "tour",
        icon: "rocket" as IconName,
        run: () => {
          window.dispatchEvent(new CustomEvent("claro:tour", { detail: { action: "open" } }));
        },
      },
      {
        id: "tour.load",
        label: "Load the demo product screen",
        group: "tour",
        icon: "rocket" as IconName,
        run: () => window.dispatchEvent(new CustomEvent("claro:tour", { detail: { action: "load-demo" } })),
      },
      {
        id: "graph.chat",
        label: "Open BHASM with graph assist",
        group: "graph",
        icon: "graph" as IconName,
        run: () => {
          setShowAi(true);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("claro:bhasm-prompt", { detail: { mode: "ask" } }));
          }, 80);
        },
      },
    ];
  }, [project, source, showPreview, activeFileName, pkgFileName, mcpRunning]);

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

  const toggleBreakpoint = (line: number) => {
    setBreakpoints((prev) => {
      const next = prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line].sort((a, b) => a - b);
      return next;
    });
  };
  const breakRef = useRef(toggleBreakpoint);
  breakRef.current = toggleBreakpoint;
  const clearBreakRef = useRef(() => setBreakpoints([]));

  // double-click on a "#" idea line → seed BHASM explain-comment
  const mountEditor = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    editor.addAction({
      id: "claro.format-document",
      label: "Format Document",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => formatRef.current(),
    });
    editor.addAction({
      id: "claro.toggle-breakpoint",
      label: "Toggle Breakpoint (F9)",
      keybindings: [monaco.KeyCode.F9],
      run: () => {
        const pos = editor.getPosition();
        if (pos) breakRef.current(pos.lineNumber);
      },
    });
    editor.addAction({
      id: "claro.clear-breakpoints",
      label: "Clear All Breakpoints (Shift+F5)",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F5],
      run: () => clearBreakRef.current(),
    });
    editor.onMouseDown((e) => {
      if (e.target?.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return;
      const pos = e.target.position;
      if (pos) breakRef.current(pos.lineNumber);
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
    editor.onKeyDown((e) => {
      if (e.keyCode !== monaco.KeyCode.Tab || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const pos = editor.getPosition();
      if (!pos) return;
      const line = editor.getModel()?.getLineContent(pos.lineNumber) ?? "";
      const idea = ideaAtLine(line);
      if (!idea) return;
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("claro:bhasm-seed", { detail: { idea } }));
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
            className={`tab${!activeOpenDoc && tab === "cl" ? " tab--active" : ""}`}
            onClick={() => {
              setActiveDoc(null);
              setTab("cl");
            }}
            title={activeFileName}
          >
            <Icon name="file-code" size={14} />
            <span className="tab__label">{tabFileNames.cl}</span>
          </button>
          <button
            className={`tab${!activeOpenDoc && tab === "py" ? " tab--active" : ""}`}
            onClick={() => {
              setActiveDoc(null);
              setTab("py");
            }}
            title="logic.py · Python logic (preview: console runtime)"
          >
            <Icon name="file-text" size={14} />
            <span className="tab__label">logic.py</span>
          </button>
          <button
            className={`tab${!activeOpenDoc && tab === "kt" ? " tab--active" : ""}`}
            onClick={() => {
              setActiveDoc(null);
              setTab("kt");
            }}
            title="screen.kt · Kotlin Compose (preview: rendered composables)"
          >
            <Icon name="file-code" size={14} />
            <span className="tab__label">screen.kt</span>
          </button>
          <button
            className={`tab${!activeOpenDoc && tab === "pkg" ? " tab--active" : ""}`}
            onClick={() => {
              setActiveDoc(null);
              setTab("pkg");
            }}
            title={`${pkgFileName} · exported artifact (JSON)`}
          >
            <Icon name="file-text" size={14} />
            <span className="tab__label">{tabFileNames.pkg}</span>
          </button>
          {openDocs.map((doc) => (
            <button
              key={doc.id}
              className={`tab${activeDoc === doc.id ? " tab--active" : ""}`}
              onClick={() => setActiveDoc(doc.id)}
              title={`${doc.path ?? doc.name}${doc.dirty ? " (unsaved)" : ""}`}
            >
              <Icon name={doc.lang === "plaintext" ? "file-text" : "file-code"} size={14} />
              <span className="tab__label">{doc.name}</span>
              {doc.dirty && <span className="tab__dot-marker">•</span>}
              <span
                className="tab__close"
                role="button"
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeDoc(doc.id);
                }}
              >
                <Icon name="chrome-close" size={12} />
              </span>
            </button>
          ))}
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
            onClick={() => void saveDoc()}
            title="Save current file (Ctrl+S)"
          >
            <Icon name="save" size={15} />
          </button>
          <button
            className="tabstrip__action"
            onClick={() => void openFile()}
            title="Open file from disk"
          >
            <Icon name="folder-opened" size={15} />
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
                <button className="pane__action" title="Open a file from disk" onClick={() => void openFile()}>
                  <Icon name="new-file" size={14} />
                </button>
              </div>
              <ul className="explorer__tree">
                <li className={`explorer__file${!activeOpenDoc && tab === "cl" ? " explorer__file--active" : ""}`} onClick={() => { setActiveDoc(null); select(project.pages[0]?.nodeId ?? null); }}>
                  <Icon name="file-code" size={15} />
                  <span>{activeFileName}</span>
                </li>
                <li className={`explorer__file${!activeOpenDoc && tab === "pkg" ? " explorer__file--active" : ""}`} onClick={() => { setActiveDoc(null); setTab("pkg"); }}>
                  <Icon name="file-text" size={15} />
                  <span>{pkgFileName}</span>
                </li>
                <li className="explorer__group-label">LOGIC</li>
                <li className={`explorer__file${!activeOpenDoc && tab === "py" ? " explorer__file--active" : ""}`} onClick={() => { setActiveDoc(null); setTab("py"); }} title="logic.py — Python logic">
                  <Icon name="file-text" size={15} />
                  <span>logic.py</span>
                </li>
                <li className={`explorer__file${!activeOpenDoc && tab === "kt" ? " explorer__file--active" : ""}`} onClick={() => { setActiveDoc(null); setTab("kt"); }} title="screen.kt — Kotlin Compose">
                  <Icon name="file-code" size={15} />
                  <span>screen.kt</span>
                </li>
                {openDocs.length > 0 && (
                  <li className="explorer__group-label">OPEN FILES</li>
                )}
                {openDocs.map((doc) => (
                  <li
                    key={doc.id}
                    className={`explorer__file${activeDoc === doc.id ? " explorer__file--active" : ""}`}
                    onClick={() => setActiveDoc(doc.id)}
                    title={`${doc.path ?? doc.name}${doc.dirty ? " (unsaved)" : ""}`}
                  >
                    <Icon name={doc.lang === "plaintext" ? "file-text" : "file-code"} size={15} />
                    <span>{doc.name}{doc.dirty ? " •" : ""}</span>
                  </li>
                ))}
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
                <Icon name="code" size={12} /> {activeOpenDoc ? activeOpenDoc.name : tabFileNames[tab]}
                {activeOpenDoc?.dirty && <span className="tab__dot-marker" title="unsaved changes">•</span>}
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
              defaultLanguage={editorLang}
              language={editorLang}
              key={activeOpenDoc ? activeOpenDoc.id : tab}
              value={editorValue}
              onChange={handleAnyChange}
              options={{
                fontFamily: "var(--font-mono)",
                fontSize: settings["editor.fontSize"],
                lineHeight: Math.round(settings["editor.fontSize"] * 1.6),
                minimap: { enabled: false },
                tabSize: settings["editor.tabSize"],
                scrollBeyondLastLine: false,
                renderWhitespace: "none",
                automaticLayout: true,
                tabCompletion: "on",
                wordWrap: settings["editor.wordWrap"],
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true },
                readOnly: !activeOpenDoc && tab === "pkg",
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
          <BuildView
            project={project}
            pyCode={files.py}
            ktCode={files.kt}
            onBuildLog={(line) => termFeed.current?.({ text: line, kind: "out" })}
            onRun={(cmd) => void window.electronAPI?.claroTermSpawn?.({ cmd: [cmd] })}
            onBuildAndRun={() => {
              setShowPreview(true);
              setActiveView("build");
            }}
          />
          <TerminalPanel feedRef={termFeed} fontFamily={settings["terminal.fontFamily"]} />
        </section>
        <section className={`view-slot${activeView === "settings" ? "" : " view-slot--hidden"}`}>
          <SettingsView />
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

      {/* Judging Tour — 3-step guided demo overlay (Ctrl+Shift+J) */}
      <JudgingTour />

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
          <div className="statusbar__item" title={`${breakpoints.length} breakpoint(s) — F9 to toggle, Shift+F5 to clear`}>
            <Icon name="issues" size={13} />
            <span>{breakpoints.length}</span>
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
            <span>{gitBranch}</span>
          </div>
          <div className="statusbar__item" title="Local-first, offline AI">
            <Icon name="lock" size={13} />
            <span>local-first</span>
          </div>
          <button
            className={`statusbar__item statusbar__item--click statusbar__graph${mcpRunning ? " statusbar__graph--on" : ""}`}
            onClick={() => (mcpRunning ? void useMcpStore.getState().stop() : void startSidecar())}
            title={
              mcpRunning
                ? `graphify sidecar running — ${mcpTools} graph tools\n${useMcpStore.getState().status?.graphJson ?? ""} · click to stop`
                : mcpError && !graphCfg?.graphJson
                  ? `graphify sidecar ${mcpError} — configure bhasm.json → graphJson to auto-start`
                  : "graphify sidecar off — click to start, or configure bhasm.json (Settings → open file → auto-starts)"
            }
          >
            <Icon name="graph" size={13} />
            <span className="statusbar__graph-dot" data-on={mcpRunning} />
            <span>{mcpRunning ? (mcpTools ? `graph ${mcpTools}` : "graph on") : "graph off"}</span>
          </button>
          <div className="statusbar__item statusbar__item--accent">
            <Icon name="sparkle" size={13} />
            <span>BHASM ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
};