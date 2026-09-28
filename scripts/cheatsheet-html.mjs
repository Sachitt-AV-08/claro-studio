// Build a printable one-page HTML from docs/claro-cheatsheet.md, then print
// it to PDF via Edge headless. Keeps the .md as the single source of truth.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(root, "docs", "claro-cheatsheet.md"), "utf8");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code = (s) => `<code>${esc(s)}</code>`;

// Minimal markdown -> HTML for this single known file.
function render(md) {
  const out = [];
  let inCode = false;
  let codeLines = [];
  let inTable = false;
  let tableRows = [];
  const flushCode = () => {
    if (codeLines.length) {
      out.push(`<pre>${esc(codeLines.join("\n"))}</pre>`);
      codeLines = [];
    }
  };
  const flushTable = () => {
    if (tableRows.length) {
      const header = tableRows[0];
      const body = tableRows.slice(1);
      out.push(`<table><thead><tr>${header.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`);
      for (const r of body) out.push(`<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`);
      out.push(`</tbody></table>`);
      tableRows = [];
    }
  };

  for (const line of md.split("\n")) {
    if (/^```/.test(line)) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (/^\|/.test(line)) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.some((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      tableRows.push(cells);
      continue;
    }
    if (inTable) {
      flushTable();
      inTable = false;
    }
    if (!line.trim()) {
      out.push("");
      continue;
    }
    if (/^#\s/.test(line)) out.push(`<h1>${line.replace(/^#\s/, "")}</h1>`);
    else if (/^##\s/.test(line)) out.push(`<h2>${line.replace(/^##\s/, "")}</h2>`);
    else if (/^>\s/.test(line)) out.push(`<blockquote>${line.replace(/^>\s?/, "")}</blockquote>`);
    else if (/^- /.test(line)) {
      const item = line.replace(/^- /, "");
      const inl = item.replace(/`([^`]+)`/g, (_, c) => code(c)).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out.push(`<li>${inl}</li>`);
    } else {
      const inl = line.replace(/`([^`]+)`/g, (_, c) => code(c)).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out.push(`<p>${inl}</p>`);
    }
  }
  flushCode();
  flushTable();
  return out.join("\n");
}

const body = render(md);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Claro in 60 seconds</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: 8.27in 11.69in; margin: 0; }
  body {
    font-family: "Segoe UI", Arial, sans-serif;
    width: 8.27in; min-height: 11.69in; margin: 0 auto; padding: 0.18in;
    color: #12121a; background: #fff; line-height: 1.22;
  }
  .pane { border: 1px solid #dce0ea; border-radius: 12px; padding: 8px 13px; margin-bottom: 7px; background: #fbfbfe; }
  h1 { font-size: 15.5pt; color: #0d0d12; margin-bottom: 3px; }
  h2 { font-size: 10.5pt; color: #1f5fb8; margin: 0 0 3px 0; display: flex; align-items: center; gap: 6px; }
  h2 .no { color: #fff; background: #2a7ade; border-radius: 5px; width: 14px; height: 14px; font-size: 7.5pt; display: inline-flex; align-items: center; justify-content: center; }
  blockquote { font-size: 8pt; font-style: italic; color: #444; border-left: 3px solid #2a7ade; padding-left: 8px; margin-bottom: 5px; }
  code { background: #eef2f8; border-radius: 4px; padding: 0 3px; font-family: "Cascadia Mono", Consolas, monospace; font-size: 7.8pt; }
  pre { background: #0d0d12; color: #e6edf5; border-radius: 8px; padding: 5px 8px; font-family: "Cascadia Mono", Consolas, monospace; font-size: 7.8pt; line-height: 1.32; margin-bottom: 4px; white-space: pre; }
  pre code { background: none; color: inherit; }
  p, li { font-size: 8.7pt; }
  ul { list-style: none; padding-left: 0; }
  li { margin-bottom: 2px; position: relative; padding-left: 14px; }
  li::before { content: "✓"; position: absolute; left: 0; color: #2ea043; font-size: 8pt; }
  table { width: 100%; border-collapse: collapse; margin: 3px 0 4px; font-size: 8pt; }
  th { background: #eef2f8; text-align: left; padding: 2px 6px; font-size: 8pt; }
  td { padding: 2px 6px; border-bottom: 1px solid #e3e7f0; font-family: "Cascadia Mono", Consolas, monospace; font-size: 7.5pt; }
  .foot { font-size: 7pt; color: #666; margin-top: 4px; text-align: center; }
</style>
</head>
<body>
${body}
<p class="foot">CLARO Workbench — local-first AI-native UI-language IDE · Hack the Horizon 3.0</p>
</body>
</html>`;

const outRoot = join(root, "docs");
mkdirSync(outRoot, { recursive: true });
const htmlPath = join(outRoot, "claro-cheatsheet.html");
writeFileSync(htmlPath, html);
console.log(htmlPath);