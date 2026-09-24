import { buildClaroLanguageSkill } from "./claroLanguage";
import { buildIdeasSkill, extractIdeas } from "./ideas";

export interface Skill {
  id: string;
  name: string;
  /** markdown body, injected verbatim into the BHASM system prompt */
  content: string;
  source: "generated" | "user-skill";
  /** presence of a real .md file on disk (user skills) */
  path?: string;
}

/**
 * Skill registry. Two are always auto-provided:
 *  - claro-language: generated from contracts/dsl-schema.ts (cannot drift)
 *  - ideas:          rebuilt from the project's "#" comments on every call
 * Users can drop real opencode-style SKILL.md files into apps/ide/skills/ and
 * they are loaded on top (files named SKILL.md; name/description from frontmatter).
 */
export class SkillRegistry {
  /** in-memory generated skills are computed fresh each read */
  list(source: string): Skill[] {
    const skills: Skill[] = [
      {
        id: "claro-language",
        name: "claro-language",
        content: buildClaroLanguageSkill(),
        source: "generated",
      },
      {
        id: "ideas",
        name: "ideas",
        content: buildIdeasSkill(source),
        source: "generated",
      },
    ];
    return skills;
  }

  /** Raw idea list (gutter badges / Explain-comment mode). */
  ideas(source: string) {
    return extractIdeas(source);
  }

  /**
   * The bounded set of skills loaded into the agent loop's context window.
   * (claro-language + ideas) then real user skills.
   */
  async forAgent(source: string): Promise<Skill[]> {
    const userSkills = await this.loadUserSkills();
    return [...this.list(source), ...userSkills];
  }

  async loadUserSkills(): Promise<Skill[]> {
    try {
      const files = await this.discoverSkillFiles();
      const out: Skill[] = [];
      for (const path of files) {
        const text = await this.readFile(path);
        const name = path
          .split(/[\\/]/)
          .slice(-2, -1)[0]
          ?.replace(/-/g, " ");
        out.push({
          id: path,
          name: name || "user-skill",
          content: text,
          source: "user-skill",
          path,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  private async discoverSkillFiles(): Promise<string[]> {
    try {
      const scan = (globalThis as { claroReadSkills?: () => Promise<string[]> }).claroReadSkills;
      if (scan) return await scan();
      return [];
    } catch {
      return [];
    }
  }

  private async readFile(path: string): Promise<string> {
    try {
      const read = (globalThis as { claroReadText?: (p: string) => Promise<string> }).claroReadText;
      if (read) return await read(path);
      // tsc isolatedModules guard; unreachable at runtime without a bridge
      throw new Error(`no file bridge for ${path}`);
    } catch (e) {
      return `(could not read ${path}) ${e}`;
    }
  }
}

export const skills = new SkillRegistry();