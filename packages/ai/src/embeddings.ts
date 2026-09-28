import type { OllamaTransport } from "./ollama.js";

const DEFAULT_HOST = "http://localhost:11434";
const TIMEOUT_MS = 30_000;

let embedTransport: OllamaTransport | undefined;

export function setEmbedTransport(t: OllamaTransport | undefined): void {
  embedTransport = t;
}

async function request(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const bodyText = body !== undefined ? JSON.stringify(body) : undefined;
  if (embedTransport) {
    return embedTransport(path, { method, body: bodyText });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DEFAULT_HOST}${path}`, {
      method,
      headers: bodyText !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: bodyText,
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      text: await res.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

interface EmbedResponse {
  embeddings: number[][];
}

async function ollamaEmbed(texts: string[], model: string): Promise<number[][]> {
  const r = await request("/api/embed", "POST", { model, input: texts });
  if (!r.ok) {
    throw new Error(`Ollama /api/embed failed (${r.status}): ${r.text}`);
  }
  const data = JSON.parse(r.text) as EmbedResponse;
  return data.embeddings;
}

async function ollamaGet<T>(path: string): Promise<T> {
  const r = await request(path, "GET");
  if (!r.ok) {
    throw new Error(`Ollama ${path} failed (${r.status}): ${r.text}`);
  }
  return JSON.parse(r.text) as T;
}

interface TagResponse {
  models: Array<{ name: string; model: string; size: number; digest: string }>;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  isInstalled(): Promise<boolean>;
}

function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function createOllamaEmbedder(model = "nomic-embed-text"): Embedder {
  const cache = new Map<string, number[]>();

  return {
    async embed(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      const uncached: string[] = [];
      const uncachedIdx: number[] = [];

      texts.forEach((t, i) => {
        const cached = cache.get(t);
        if (cached) {
          results[i] = cached;
        } else {
          uncached.push(t);
          uncachedIdx.push(i);
        }
      });

      if (uncached.length > 0) {
        const vectors = await ollamaEmbed(uncached, model);
        vectors.forEach((v, j) => {
          const norm = l2Normalize(v);
          const idx = uncachedIdx[j];
          cache.set(uncached[j], norm);
          results[idx] = norm;
        });
      }

      return results;
    },

    async isInstalled(): Promise<boolean> {
      try {
        const tags = await ollamaGet<TagResponse>("/api/tags");
        return tags.models.some((m) => m.name === model || m.model === model);
      } catch {
        return false;
      }
    },
  };
}