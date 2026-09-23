import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@project/contracts";
import { renderPackagedHtml } from "../export/renderHtml";
import { Icon } from "../components/Icon";

type BuildStatus = "idle" | "building" | "done" | "error" | "cancelled";

interface BuildViewProps {
  project: Project;
  pyCode: string;
  ktCode: string;
  onBuildLog?: (line: string) => void;
  onRun?: (cmd: string) => void;
}

const STATUS_LABEL: Record<BuildStatus, string> = {
  idle: "Ready",
  building: "Building…",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

export function BuildView({ project, pyCode, ktCode, onBuildLog }: BuildViewProps) {
  const suggestedName = useMemo(() => {
    const page = project.pages[0]?.name;
    return page ? `${page} App` : "My App";
  }, [project]);

  const [name, setName] = useState(suggestedName);
  const [version, setVersion] = useState("1.0.0");
  const [outDir, setOutDir] = useState("");
  const [portable, setPortable] = useState(false);
  const [status, setStatus] = useState<BuildStatus>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const buildId = useRef("");
  const logBox = useRef<HTMLPreElement>(null);

  const addLog = useCallback((line: string) => {
    setLog((prev) => (prev.length > 300 ? [...prev.slice(-250), line] : [...prev, line]));
    onBuildLog?.(line);
  }, [onBuildLog]);

  useEffect(() => {
    void (async () => {
      const api = window.electronAPI;
      if (!api?.claroPkgHost) {
        setHint("Packaging is available in the desktop app (CLARO Workbench.exe).");
        return;
      }
      const host = await api.claroPkgHost();
      setOutDir(host.defaultOutDir);
      if (!host.builderAvailable) setHint("electron-builder is missing from this install — rebuild the IDE with npm install.");
      else setHint(`Electron ${host.electronVersion} — first build reuses the bundled runtime, fully offline.`);
    })();
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const offLog = api.claroPkgOnLog((p) => {
      if (p.id === buildId.current) addLog(p.line);
    });
    const offDone = api.claroPkgOnDone((p) => {
      if (p.id !== buildId.current) return;
      setStatus(p.canceled ? "cancelled" : "done");
      if (p.canceled) addLog("Build cancelled.");
      setArtifacts(p.artifacts);
      if (p.artifacts[0]) onBuildLog?.(`claro:exec › built ${p.artifacts[0]} — Run fetches it via claro:term:spawn(cmd)`);
    });
    const offError = api.claroPkgOnError((p) => {
      if (p.id !== buildId.current) return;
      setError(p.error);
      setStatus("error");
      addLog(`Error: ${p.error}`);
    });
    return () => {
      offLog();
      offDone();
      offError();
    };
  }, [addLog]);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [log]);

  const start = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.claroPkgBuild || status === "building") return;
    setStatus("building");
    setLog([]);
    setArtifacts([]);
    setError("");
    addLog(`Starting build for "${name.trim() || "My App"}"…`);
    const html = renderPackagedHtml(project, pyCode, ktCode);
    const result = await api.claroPkgBuild({
      name: name.trim() || "My App",
      version: /^\d+\.\d+\.\d+$/.test(version.trim()) ? version.trim() : "1.0.0",
      description: `${name.trim() || "My App"} — built with CLARO Workbench`,
      outDir: outDir.trim(),
      html,
      pyCode,
      ktCode,
      targets: ["nsis", ...(portable ? ["portable"] : [])],
    });
    if (result.ok && result.id) {
      buildId.current = result.id;
    } else if (!result.ok) {
      setError(result.error ?? "Build could not start.");
      setStatus("error");
      addLog(`Error: ${result.error}`);
    }
  }, [status, name, version, outDir, portable, project, pyCode, ktCode, addLog]);

  const cancel = useCallback(() => {
    if (buildId.current) void window.electronAPI?.claroPkgCancel(buildId.current);
    buildId.current = "";
  }, []);

  const browse = useCallback(async () => {
    const chosen = await window.electronAPI?.claroPkgPickDir();
    if (chosen) setOutDir(chosen);
  }, []);

  const openPath = useCallback((p: string) => () => void window.electronAPI?.claroPkgOpenPath(p), []);

  return (
    <div className="build">
      <div className="build__head">
        <span className="build__title">
          <Icon name="package" size={16} /> App Packaging
        </span>
        <span className={`build__chip build__chip--${status}`}>
          <Icon name={status === "error" ? "error" : status === "done" ? "check" : status === "building" ? "sync" : "circle-filled"} size={12} />
          {STATUS_LABEL[status]}
        </span>
      </div>

      <section className="build__section">
        <div className="build__field">
          <label className="build__label" htmlFor="pkg-name">App name</label>
          <input
            id="pkg-name"
            className="build__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My App"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="build__row">
          <div className="build__field">
            <label className="build__label" htmlFor="pkg-version">Version</label>
            <input
              id="pkg-version"
              className="build__input build__input--sm"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="build__field build__field--grow">
            <label className="build__label" htmlFor="pkg-out">Output folder</label>
            <div className="build__outdir">
              <input
                id="pkg-out"
                className="build__input"
                value={outDir}
                onChange={(e) => setOutDir(e.target.value)}
                placeholder="C:\Users\you\claro-builds"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="pane__action" title="Choose folder…" onClick={browse}>
                <Icon name="folder" size={15} />
              </button>
            </div>
          </div>
        </div>
        <div className="build__targets">
          <label className="build__label">Targets</label>
          <label className={`build__chip-opt${true ? " build__chip-opt--on" : ""}`}>
            <input type="checkbox" checked disabled /> EXE installer (NSIS x64)
          </label>
          <label className={`build__chip-opt${portable ? " build__chip-opt--on" : ""}`}>
            <input type="checkbox" checked={portable} onChange={(e) => setPortable(e.target.checked)} /> Portable .exe
          </label>
        </div>
      </section>

      <section className="build__actions">
        <button
          className={`build__go${status === "building" ? " build__go--disabled" : ""}`}
          onClick={start}
          disabled={status === "building"}
        >
          <Icon name="rocket" size={14} /> {status === "building" ? "Building…" : "Build EXE installer"}
        </button>
        {status === "building" && (
          <button className="build__cancel" onClick={cancel}>
            <Icon name="close" size={14} /> Cancel
          </button>
        )}
      </section>

      <section className="build__logwrap">
        <pre ref={logBox} className={`build__log${status === "error" ? " build__log--error" : ""}`}>
          {log.length === 0 ? (status === "error" ? error : "No build yet — press “Build EXE installer”.") : log.join("\n")}
        </pre>
      </section>

      {artifacts.length > 0 && (
        <section className="build__results">
          <div className="build__results-title">Artifacts</div>
          {artifacts.map((p) => (
            <div className="build__result" key={p}>
              <Icon name="file-text" size={14} />
              <span className="build__result-path" title={p}>{p}</span>
              <button type="button" className="pane__action" title="Open folder" onClick={openPath(p.replace(/\\[^\\/]+$/, ""))}>
                <Icon name="folder-opened" size={14} />
              </button>
              <button type="button" className="pane__action" title="Run installer" onClick={openPath(p)}>
                <Icon name="play" size={14} />
              </button>
            </div>
          ))}
          <div className="build__results-open">
            <button type="button" className="build__cancel" onClick={openPath(outDir)}>
              <Icon name="folder" size={13} /> Open output folder
            </button>
          </div>
        </section>
      )}

      {hint && <p className="build__hint">{hint}</p>}
    </div>
  );
}