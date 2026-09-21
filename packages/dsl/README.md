# @project/dsl — owned by Agent 1

The Claro language engine. Eight folders' worth of concern in one package:
- `tokenizer.ts` — Claro → tokens (whitespace-insensitive)
- `parser.ts` — tokens → AST + diagnostics + id map (error-tolerant)
- `generator.ts` — AST → canonical `.cl` source (idempotent, pretty)
- `patcher.ts` — `validateOps` + `applyOps` with inverse generation
- `index.ts` — public surface

Deterministic guarantees tested by `test/`:
- `parse(generate(parse(x)))` ≡ `parse(x)` (round-trip stability)
- ids are a pure function of the AST
- every `applyOps` succeeds atomically or returns `{ ok:false }` untouched

No UI here. No AI here. This is the deterministic core everything else hangs off.