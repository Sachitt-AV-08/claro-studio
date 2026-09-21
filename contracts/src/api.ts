import type { MetricsSnapshot } from "./metrics.js";
import type { ModelStatus, PatchProposal, ProjectContext } from "./ai.js";
import type { ReviewResult } from "./review.js";
import type { Project } from "./ast.js";

/**
 * IPC / channel contract between the Electron main process and the renderer.
 * The same interface is shadowed over HTTP/WS for browser-mode fallback.
 * Every channel returns { ok, data } | { ok:false, error }.
 */

export interface RpcOk<T> {
  ok: true;
  data: T;
}

export interface RpcErr {
  ok: false;
  error: string;
}

export type Rpc<T> = RpcOk<T> | RpcErr;

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export interface ReadFileResult {
  path: string;
  content: string;
  revision: number;
}

export interface WriteFileResult {
  path: string;
  revision: number;
}

export interface AndroidProjectInfo {
  root: string;
  gradleFile: string | null;
  manifest: string | null;
  srcDirs: string[];
}

export interface AndroidDeviceInfo {
  adbDevices: string[];
  avds: string[];
}

export interface TermStreamInit {
  cols: number;
  rows: number;
}

export type Channel =
  | { ch: "fs:list"; args: { path: string }; ret: Rpc<FileEntry[]> }
  | { ch: "fs:read"; args: { path: string }; ret: Rpc<ReadFileResult> }
  | { ch: "fs:write"; args: { path: string; content: string }; ret: Rpc<WriteFileResult> }
  | { ch: "fs:watch"; args: { path: string }; ret: void }
  | { ch: "ai:status"; args: { }; ret: Rpc<ModelStatus> }
  | { ch: "ai:complete"; args: { system: string; user: string }; ret: Rpc<string> }
  | { ch: "bhasm:health"; args: { }; ret: Rpc<{ ok: boolean; models: Array<{ name: string; size: number }>; error?: string }> }
  | { ch: "bhasm:status"; args: { }; ret: Rpc<ModelStatus> }
  | { ch: "bhasm:propose"; args: { instruction: string; project: Project }; ret: Rpc<PatchProposal> }
  | { ch: "bhasm:describe"; args: { intended: string; current: string; project: Project }; ret: Rpc<PatchProposal> }
  | { ch: "bhasm:review"; args: { project: Project }; ret: Rpc<ReviewResult> }
  | { ch: "android:open"; args: { path: string }; ret: Rpc<AndroidProjectInfo> }
  | { ch: "android:devices"; args: { }; ret: Rpc<AndroidDeviceInfo> }
  | { ch: "gradle:run"; args: { project: string; task: string }; ret: Rpc<{ taskId: string }> }
  | { ch: "metrics:snapshot"; args: { }; ret: Rpc<MetricsSnapshot> }
  | { ch: "term:open"; args: TermStreamInit; ret: Rpc<{ termId: string }> }
  | { ch: "term:write"; args: { termId: string; data: string }; ret: Rpc<void> };