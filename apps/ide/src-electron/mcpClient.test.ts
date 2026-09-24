/**
 * GraphifyMcpClient end-to-end test against the REAL `graphify.serve` process.
 *
 * Skipped when python-with-graphify is not available (CI/dev machines without a
 * graphify venv): resolve python via $CLARO_GRAPHIFY_PYTHON (venv python) or
 * `python`, then confirm `python -m graphify` imports before spawning.
 */
import { spawnSync } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

import { GraphifyMcpClient } from './mcpClient';

const PYTHON = process.env.CLARO_GRAPHIFY_PYTHON || 'python';
const GRAPH = process.env.CLARO_GRAPHIFY_GRAPH || join(__dirname, 'fixtures', 'sample-graph.json');

function graphifyAvailable(): string | null {
  if (!existsSync(GRAPH)) return `graph.json fixture missing: ${GRAPH}`;
  const probe = spawnSync(
    PYTHON,
    ['-c', 'import graphify, graphify.serve; from mcp.server.stdio import stdio_server'],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
  );
  if (probe.status !== 0 || probe.error) {
    return `python '${PYTHON}' cannot import graphify (${(probe.stderr || probe.error || '').toString().slice(0, 160)})`;
  }
  return null;
}

const skipReason = graphifyAvailable();
const maybe = skipReason ? describe.skip : describe;

maybe('graphify MCP sidecar', () => {
  const client = new GraphifyMcpClient();
  let status: Awaited<ReturnType<GraphifyMcpClient['spawn']>>;

  beforeAll(async () => {
    status = await client.spawn({ graphJson: GRAPH, python: PYTHON });
  }, 60_000);

  afterAll(() => {
    client.close();
  });

  it('completes the handshake and lists the MCP graph tools', async () => {
    expect(status.ok).toBe(true);
    expect(status.tools).toContain('query_graph');
    expect(status.tools).toContain('graph_stats');
    expect(status.tools).toContain('get_node');
  });

  it('graph_stats returns node/edge counts', async () => {
    const r = await client.graphStats();
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Nodes:');
    expect(r.text).toMatch(/Nodes: \d+/);
  });

  it('query_graph returns a component-usage traversal', async () => {
    const r = await client.queryGraph('Where is Chip used?');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Chip');
  });

  it('get_node resolves a component label', async () => {
    const r = await client.getNode('Chip');
    expect(r.ok).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('close() tears down the child process', () => {
    client.close();
    expect(client.running).toBe(false);
  });
});