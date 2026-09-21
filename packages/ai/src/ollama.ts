import type { ModelProvider, Completion, ModelStatus } from "@project/contracts";

const DEFAULT_HOST = "http://localhost:11434";
const TIMEOUT_MS = 30_000;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface TagResponse {
  models: Array<{ name: string; model: string; size: number; digest: string }>;
}

interface PsResponse {
  models: Array<{ name: string; model: string; size: number; size_vram?: number }>;
}

async function ollamaFetch<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DEFAULT_HOST}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama ${path} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DEFAULT_HOST}${path}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama ${path} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function createOllamaProvider(model = "qwen2.5:3b"): ModelProvider {
  return {
    id: `bhasm:ollama:${model}`,

    async isInstalled(): Promise<boolean> {
      try {
        const tags = await ollamaGet<TagResponse>("/api/tags");
        return tags.models.some((m) => m.name === model || m.model === model);
      } catch {
        return false;
      }
    },

    async complete(system: string, user: string): Promise<Completion> {
      const start = Date.now();
      const res = await ollamaFetch<ChatResponse>("/api/chat", {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
      });
      return {
        text: res.message?.content ?? "",
        latencyMs: Date.now() - start,
        model: res.model,
        tokens: {
          in: res.prompt_eval_count ?? 0,
          out: res.eval_count ?? 0,
        },
      };
    },

    async structuredComplete<T>(
      system: string,
      user: string,
      _shape: Record<string, unknown>,
    ): Promise<T> {
      const start = Date.now();
      const res = await ollamaFetch<ChatResponse>("/api/chat", {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        format: "json",
        stream: false,
      });
      const text = res.message?.content ?? "";
      let parsed: T;
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        throw new Error(`Model returned invalid JSON: ${text.slice(0, 200)}`);
      }
      return parsed;
    },

    async status(): Promise<ModelStatus> {
      try {
        const ps = await ollamaGet<PsResponse>("/api/ps");
        const running = ps.models.find(
          (m) => m.name === model || m.model === model,
        );
        return {
          model,
          loaded: !!running,
          vramMiB: running?.size_vram
            ? Math.round(running.size_vram / 1024 / 1024)
            : undefined,
        };
      } catch {
        return { model, loaded: false };
      }
    },
  };
}

/** Quick health check — returns list of available models. */
export async function health(): Promise<{
  ok: boolean;
  models: Array<{ name: string; size: number }>;
  error?: string;
}> {
  try {
    const tags = await ollamaGet<TagResponse>("/api/tags");
    return {
      ok: true,
      models: tags.models.map((m) => ({
        name: m.name,
        size: Math.round(m.size / 1024 / 1024),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      models: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
