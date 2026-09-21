/**
 * The ideas skill — rebuilt from the project's `#` comments on every call.
 *
 * Users encode product intent as `# comment` lines above nodes. Extracting them
 * straight from the raw source (line-prefix regex, not the AST) keeps the ideas
 * view authoritative even while Agent 1's comment-preservation lands.
 */

export interface Idea {
  line: number;
  text: string;
  /** The first node-ish token following the comment, when resolvable */
  target?: string;
}

export function extractIdeas(source: string): Idea[] {
  const ideas: Idea[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*#\s*(.+)$/);
    if (!m) continue;
    ideas.push({ line: i + 1, text: m[1].trim() });
  }
  return ideas;
}

/** Best-effort: point the idea at the first element owned by the next block. */
function targetFor(idea: Idea, lines: string[]): string | undefined {
  for (let i = idea.line; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([a-z][\w-]*)\s/);
    if (m) return m[1];
    if (i > idea.line + 4) break;
  }
  return undefined;
}

export function buildIdeasSkill(source: string): string {
  const ideas = extractIdeas(source).map((idea) => ({
    line: idea.line,
    text: idea.text,
    target: targetFor(idea, source.split(/\r?\n/)),
  }));
  if (!ideas.length) {
    return `# Project ideas

No "#" comments found in the current file.`;
  }
  const body = ideas
    .map((i) => `- (line ${i.line})${i.target ? ` \`${i.target}\`` : ""} — ${i.text}`)
    .join("\n");
  return `# Project ideas (from "#" comments)

These comments encode product intent. Treat them as the spec for this project.\n\n${body}`;
}