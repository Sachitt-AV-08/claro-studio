import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";

/**
 * PythonConsole — a mini Python preview runtime.
 *
 * Supports a documented subset so the preview works with .py code:
 *   title("...") / label("...")       → preview UI header/subtitle
 *   button("Tap me", on_tap)          → a tappable button wired to a def
 *   def handler(): ... (indented)     → a function you can wire to a button
 *   x = <expr> / print(<expr>, ...)   → assignments + console output
 *   global NAME lines                 → ignored
 *   arithmetic: + - * / // % and string concat/repeat
 * Anything unsupported is reported to the console instead of crashing.
 */

type Value = number | string;
interface UiButton {
  label: string;
  fn: string;
}

const MAX_STEPS = 4000;

class PyError extends Error {}

interface Token {
  t: "num" | "str" | "id" | "op";
  v: string;
}

function tokenizePy(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") break; // comment to EOL
    if (c === '"' || c === "'") {
      const q = c;
      let s = "";
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\" && i + 1 < src.length) {
          s += src[i + 1] === "n" ? "\n" : src[i + 1];
          i += 2;
        } else {
          s += src[i];
          i++;
        }
      }
      i++;
      out.push({ t: "str", v: s });
      continue;
    }
    if (/[0-9]/.test(c)) {
      let num = c;
      i++;
      while (i < src.length && /[0-9.]/.test(src[i])) {
        num += src[i];
        i++;
      }
      out.push({ t: "num", v: num });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let id = c;
      i++;
      while (i < src.length && /[\w]/.test(src[i])) {
        id += src[i];
        i++;
      }
      out.push({ t: "id", v: id });
      continue;
    }
    out.push({ t: "op", v: c });
    i++;
  }
  return out;
}

function evalExpr(tokens: Token[], vars: Record<string, Value>): Value {
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const primary = (): Value => {
    const tok = next();
    if (!tok) throw new PyError("unexpected end of expression");
    if (tok.t === "num") return Number(tok.v);
    if (tok.t === "str") return tok.v;
    if (tok.t === "op" && tok.v === "(") {
      const v = expr();
      const closer = next();
      if (!closer || closer.v !== ")") throw new PyError("expected )");
      return v;
    }
    if (tok.t === "op" && tok.v === "-") return -(primary() as number);
    if (tok.t === "id") {
      if (vars[tok.v] !== undefined) return vars[tok.v];
      throw new PyError(`name '${tok.v}' is not defined`);
    }
    throw new PyError(`unexpected token ${tok.v}`);
  };

  const term = (): Value => {
    let v = primary();
    let tok = peek();
    while (tok && tok.t === "op" && (tok.v === "*" || tok.v === "/" || tok.v === "//" || tok.v === "%")) {
      next();
      const rhs = primary();
      if (tok.v === "*") v = typeof v === "string" ? v.repeat(Number(rhs)) : (v as number) * (rhs as number);
      else if (tok.v === "/") v = (v as number) / (rhs as number);
      else if (tok.v === "//") v = Math.floor((v as number) / (rhs as number));
      else v = (v as number) % (rhs as number);
      tok = peek();
    }
    return v;
  };

  const expr = (): Value => {
    let v = term();
    let tok = peek();
    while (tok && tok.t === "op" && (tok.v === "+" || tok.v === "-")) {
      next();
      const rhs = term();
      if (tok.v === "+") v = (v as number) + (rhs as number);
      else v = (v as number) - (rhs as number);
      tok = peek();
    }
    return v;
  };

  const result = expr();
  if (pos < tokens.length) throw new PyError("unexpected trailing input");
  return result;
}

function evalExprStr(exprText: string, vars: Record<string, Value>): Value {
  return evalExpr(tokenizePy(exprText.trim().replace(/\)\s*$/, "")), vars);
}

function formatValue(v: Value): string {
  return typeof v === "string" ? v : String(v);
}

interface Runtime {
  output: string[];
  vars: Record<string, Value>;
  funcs: Map<string, string[]>;
  ui: { title: string; subs: string; buttons: UiButton[] };
  runStatements(code: string): void;
  runFn(name: string): void;
}

function buildRuntime(source: string): Runtime {
  const vars: Record<string, Value> = {};
  const output: string[] = [];
  const funcs = new Map<string, string[]>();
  let steps = 0;
  let title = "";
  let subs = "";
  const buttons: UiButton[] = [];

  const parseDef = (lines: string[], at: number): number => {
    const header = lines[at].trim().match(/^def\s+([\w]+)\s*\(([^)]*)\)\s*:\s*$/);
    if (!header) return at;
    const body: string[] = [];
    let j = at + 1;
    while (j < lines.length) {
      const line = lines[j];
      const trimmed = line.trim();
      if (/^\s/.test(line)) {
        body.push(line);
        j++;
      } else if (trimmed.length === 0 || trimmed.startsWith("#")) {
        body.push(line);
        j++;
      } else {
        break;
      }
    }
    funcs.set(header[1], body);
    return j - 1;
  };

  const runStatements = (code: string) => {
    const lines = code.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      if (++steps > MAX_STEPS) {
        output.push("halted: too many steps");
        return;
      }
      const trimmed = lines[idx].trim();
      if (trimmed.length === 0 || trimmed.startsWith("#") || /^(global|nonlocal)\b/.test(trimmed)) continue;
      if (/^def\s+/.test(trimmed)) {
        idx = parseDef(lines, idx);
        continue;
      }
      if (/^title\s*\(/.test(trimmed)) {
        try {
          title = formatValue(evalExprStr(trimmed.slice(5), vars));
        } catch (err) {
          output.push(`  title(): ${(err as Error).message}`);
        }
        continue;
      }
      if (/^label\s*\(/.test(trimmed)) {
        try {
          subs = formatValue(evalExprStr(trimmed.slice(5), vars));
        } catch (err) {
          output.push(`  label(): ${(err as Error).message}`);
        }
        continue;
      }
      const btn = trimmed.match(/^button\s*\(\s*(.*?),\s*([\w]+)\s*\)\s*$/);
      if (btn) {
        try {
          buttons.push({ label: formatValue(evalExprStr(btn[1], vars)), fn: btn[2] });
        } catch (err) {
          output.push(`  button(): ${(err as Error).message}`);
        }
        continue;
      }
      if (/^print\s*\(/.test(trimmed)) {
        const inner = trimmed.slice(6).trim();
        try {
          const parts = inner
            .slice(0, inner.endsWith(")") ? -1 : inner.length)
            .split(",")
            .map((p) => p.trim());
          output.push(String(parts.map((p) => formatValue(evalExprStr(p, vars))).join(" ")));
        } catch (err) {
          output.push(`  print(): ${(err as Error).message}`);
        }
        continue;
      }
      const assign = trimmed.match(/^([\w]+)\s*=\s*(.+)$/);
      if (assign) {
        try {
          vars[assign[1]] = evalExprStr(assign[2], vars);
        } catch (err) {
          output.push(`  ${trimmed} → ${(err as Error).message}`);
        }
        continue;
      }
      output.push(`  cannot run: ${trimmed}`);
    }
  };

  runStatements(source);

  const runFn = (name: string) => {
    const body = funcs.get(name);
    if (!body) {
      output.push(`  ${name}() is not defined`);
      return;
    }
    runStatements(body.join("\n"));
  };

  return {
    output,
    vars,
    funcs,
    ui: { title, subs, buttons },
    runStatements,
    runFn,
  };
}

export function PythonConsole({ source }: { source: string }) {
  const [output, setOutput] = useState<string[]>([]);
  const [ui, setUi] = useState<Runtime["ui"]>({ title: "", subs: "", buttons: [] });
  const [runId, setRunId] = useState(0);
  const runtimeRef = useRef<Runtime | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rt = buildRuntime(source);
    runtimeRef.current = rt;
    setOutput(rt.output.slice());
    setUi(rt.ui);
  }, [source, runId]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const tap = (fn: string, label: string) => {
    const rt = runtimeRef.current;
    if (!rt) return;
    rt.output.push(`  [tapped] ${label} → ${fn}()`);
    rt.runFn(fn);
    setOutput(rt.output.slice());
    setUi({ ...rt.ui });
  };

  const lineCount = useMemo(() => source.split(/\r?\n/).length, [source]);

  return (
    <div className="preview__source">
      <div className="preview__source__frame preview__source__frame--py">
        <div className="preview__source__top">
          <Icon name="terminal" size={12} /> Python · console runtime
          <button className="preview__source__run" onClick={() => setRunId((r) => r + 1)} title="Re-run the program">
            <Icon name="play" size={11} /> Run
          </button>
        </div>

        {(ui.title || ui.subs || ui.buttons.length > 0) && (
          <div className="pycon__ui">
            {ui.title && <div className="pycon__title">{ui.title}</div>}
            {ui.subs && <div className="pycon__subs">{ui.subs}</div>}
            {ui.buttons.length > 0 && (
              <div className="pycon__buttons">
                {ui.buttons.map((b, i) => (
                  <button key={i} className="pycon__button" onClick={() => tap(b.fn, b.label)} title={`runs ${b.fn}()`}>
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pycon__console" ref={scrollerRef}>
          {output.length === 0 ? (
            <div className="pycon__empty">no output — write print(...) to see results</div>
          ) : (
            output.map((line, i) => (
              <div key={i} className={line.startsWith("  ") ? "pycon__line pycon__line--ch" : "pycon__line"}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="preview__source__hint">
        {lineCount} lines · print / vars · title · label · button(name, fn)
      </div>
    </div>
  );
}