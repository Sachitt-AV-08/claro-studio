# @project/ai — owned by Agent 3

Local AI layer. Swappable providers (Ollama first, model `qwen2.5:3b`, `format:"json"`),
structured patch producer, deterministic-first code reviewer, metrics and offline proof.

- `src/provider.ts` — `ModelProvider` impls (Ollama HTTP + test stub)
- `src/client.ts` — `AiClient`: context → instruction → PatchProposal
- `src/reviewer.ts` — static rules + optional quiet LLM pass
- `src/metrics.ts` — CPU/RAM/GPU/VRAM/latency/network snapshot

Rules: LLM proposes, validator decides. No fake success. Stub for TESTS ONLY.