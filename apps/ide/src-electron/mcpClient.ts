/**
 * GraphifyMcpClient — a zero-dependency MCP **stdio** client for the
 * graphify `graphify.serve` process (Python), used as the IDE's graph sidecar.
 *
 * Why hand-rolled JSON-RPC instead of an SDK:
 *  - mcp's stdio transport is *newline-delimited JSON-RPC 2.0* (verified against
 *    mcp>=1.<n>: `stdin_reader` does `JSONRPCMessage.model_validate_json(line)`,
 *    `stdout_writer` writes `json + "\n"`). No SDK needed.
 *  - The IDE stays offline-first: no native build, no npm dep, one ~200-line file.
 *
 * Lifecycle: spawn() starts `python -m graphify.serve <graph.json>` and performs
 * the standard initialize/initialized handshake; the server hot-reloads
 * graph.json itself, so callers can safely long-run this client. close() sends
 * stdin EOF and kills the child.
 *
 * The module intentionally imports nothing from electron or the MCP SDK so it
 * can be unit-tested under plain Node (vitest) and reused from the main process.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface, type Interface } from 'readline';

export interface McpSpawnOptions {
  /** absolute path to a graphify graph.json */
  graphJson: string;
  /** python executable to use (default: $CLARO_GRAPHIFY_PYTHON || 'python') */
  python?: string;
  /** working directory for the child */
  cwd?: string;
  /** extra argv appended after `-m graphify.serve <graph>` */
  serveArgs?: string[];
}

export interface McpStatus {
  ok: boolean;
  running: boolean;
  python?: string;
  graphJson?: string;
  tools?: string[];
  error?: string;
}

export interface McpCallResult {
  ok: boolean;
  text?: string;
  content?: unknown[];
  error?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 25_000;

export class GraphifyMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrTail: string[] = [];
  private python = '';
  private graphJson = '';

  get running(): boolean {
    return !!this.child && !this.child.killed && this.child.exitCode === null;
  }

  /**
   * Spawn the sidecar and complete the MCP handshake. Resolves when the server
   * answers tools/list, rejects if the process dies or the handshake times out.
   */
  spawn(opts: McpSpawnOptions, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<McpStatus> {
    this.close();

    const python = opts.python ?? process.env.CLARO_GRAPHIFY_PYTHON ?? 'python';
    const args = ['-m', 'graphify.serve', opts.graphJson, ...(opts.serveArgs ?? [])];
    this.python = python;
    this.graphJson = opts.graphJson;

    return new Promise<McpStatus>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(python, args, {
          cwd: opts.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.child = child;

      child.on('error', (e) => {
        const err =
          e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT'
            ? new Error(`python (${python}) not found — graphify graph server unavailable`)
            : e;
        this.rejectAll(err);
        if (this.pending.size === 0) reject(err);
      });

      child.on('exit', (code, signal) => {
        const err = new Error(
          `graphify serve exited (code=${code ?? signal ?? '?'})`,
        );
        this.rejectAll(err);
        if (this.pending.size === 0) reject(err);
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        this.stderrTail.push(chunk);
        if (this.stderrTail.length > 20) this.stderrTail.shift();
      });

      const lines = createInterface({ input: child.stdout });
      this.lines = lines;
      lines.on('line', (raw) => this.onMessage(raw));

      const timer = setTimeout(() => {
        this.rejectAll(new Error(`MCP handshake timed out after ${timeoutMs}ms`));
        reject(new Error(`MCP handshake timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'claro-workbench', version: '0.1.0' },
      })
        .then(() => {
          this.notify('notifications/initialized', {});
          return this.listTools();
        })
        .then((tools) => {
          clearTimeout(timer);
          resolve({ ok: true, running: true, python, graphJson: opts.graphJson, tools });
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  status(): McpStatus {
    return {
      ok: this.running,
      running: this.running,
      python: this.python,
      graphJson: this.graphJson,
      error: this.running ? undefined : this.lastError(),
    };
  }

  private lastError(): string {
    return (
      (this.stderrTail.join('').trim() || 'sidecar not running') +
      (this.child ? ` (pid ${this.child.pid ?? '?'})` : '')
    );
  }

  /** Fire a JSON-RPC request and await its matching response by id. */
  request(method: string, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const child = this.child;
    if (!child || child.stdin.writableEnded) {
      return Promise.reject(new Error('graphify serve is not running'));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(payload + '\n');
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Fire-and-forget JSON-RPC notification (no response expected). */
  notify(method: string, params: Record<string, unknown> = {}): void {
    const child = this.child;
    if (!child || child.stdin.writableEnded) return;
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    } catch {
      // sidecar gone; ignore
    }
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; method?: string; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return; // not JSON (e.g. stray stdout) — ignore
    }
    if (msg.id === undefined) return; // notification

    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error.message ?? `MCP error ${msg.id}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private rejectAll(err: Error): void {
    const keys = [...this.pending.keys()];
    for (const id of keys) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      this.pending.delete(id);
    }
  }

  // ---- typed convenience wrappers --------------------------------------

  async listTools(): Promise<string[]> {
    const result = (await this.request('tools/list')) as { tools?: { name: string }[] } | undefined;
    return (result?.tools ?? []).map((t) => t.name);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    try {
      const result = (await this.request('tools/call', { name, arguments: args })) as
        | { content?: { type?: string; text?: string }[]; isError?: boolean }
        | undefined;
      const texts = (result?.content ?? [])
        .map((c) => (c.type === 'text' || c.text !== undefined ? c.text ?? '' : ''))
        .filter((t) => t !== '');
      return {
        ok: !result?.isError,
        text: texts.join('\n'),
        content: result?.content,
        error: result?.isError ? texts.join('\n') || 'tool returned isError' : undefined,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async graphStats(): Promise<McpCallResult> {
    return this.callTool('graph_stats');
  }

  async queryGraph(question: string): Promise<McpCallResult> {
    return this.callTool('query_graph', { question });
  }

  async getNode(label: string): Promise<McpCallResult> {
    return this.callTool('get_node', { label });
  }

  close(): void {
    for (const id of [...this.pending.keys()]) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('graphify serve closed'));
      }
      this.pending.delete(id);
    }
    const child = this.child;
    const lines = this.lines;
    this.child = null;
    this.lines = null;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      child.kill();
    }
    lines?.close();
  }
}

/** Convenience factory: create + spawn, resolving only when ready. */
export async function connectGraphifyMcpClient(
  opts: McpSpawnOptions,
  timeoutMs?: number,
): Promise<{ client: GraphifyMcpClient; status: McpStatus }> {
  const client = new GraphifyMcpClient();
  const status = await client.spawn(opts, timeoutMs);
  return { client, status };
}