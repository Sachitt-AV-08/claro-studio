import React, { useEffect, useState } from "react";
import { useClaroStore } from "../store/claroStore";
import { TOOLS } from "../bhasm/tools";
import { skills } from "../bhasm/skills";
import { agentFor, type BhasmMode } from "../bhasm/agent";
import { Icon } from "../components/Icon";

/**
 * Extensions view — the BHASM extension is inspectable here: the agent, its
 * tool registry, and the loaded skills (claro-language is generated from the
 * schema; ideas is rebuilt from "#" comments).
 */

export const ExtensionsView: React.FC = () => {
  const source = useClaroStore((s) => s.source);
  const [skillFiles, setSkillFiles] = useState<string[]>([]);

  useEffect(() => {
    const scan = () =>
      (globalThis as { claroReadSkills?: () => Promise<string[]> }).claroReadSkills?.().then(setSkillFiles) ??
      Promise.resolve();
    scan();
  }, []);

  const generated = skills.list(source);
  const [ask, code, review, explain] = (["ask", "code", "review", "explain-comment"] as BhasmMode[]).map(
    (m) => agentFor(m),
  );
  const agents = [ask, code, review, explain];

  return (
    <div className="extensions">
      <div className="pane__header">
        <span>Extensions</span>
        <span className="pane__sub">CHROME · 1 BULT-IN</span>
      </div>

      <div className="extensions__list">
        <article className="ext-card">
          <div className="ext-card__head">
            <div className="ext-card__icon">
              <Icon name="sparkle" size={20} />
            </div>
            <div className="ext-card__title">
              <span className="ext-card__name">BHASM</span>
              <span className="ext-card__pub">CLARO · v0.1.0 · internal</span>
              <span className="ext-card__desc">
                opencode-style agent + typed tools + skills. Local-first, offline, reversible — it
                only ever proposes PatchOps.
              </span>
            </div>
            <span className="ext-card__install ext-card__install--installed">Installed</span>
          </div>

          <div className="ext-card__sections">
            <section className="ext-section">
              <h4>Agent</h4>
              <p className="ext-agent__byline">
                1 agent, {agents.length} modes · model <code>qwen2.5:3b</code> · skills auto-attached
                on every call
              </p>
              <div className="ext-agent__modes">
                {agents.map((a) => (
                  <div key={a.id} className="ext-agent__mode">
                    <span className="ext-agent__mode-name">{a.id.replace("bhasm-", "")}</span>
                    <span className="ext-agent__mode-desc">{a.description}</span>
                    <span className="ext-agent__mode-tools">{a.tools.join(" · ")}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="ext-section">
              <h4>Tools ({TOOLS.length})</h4>
              <div className="ext-tools">
                {TOOLS.map((t) => (
                  <div key={t.id} className="ext-tool">
                    <code className="ext-tool__id">{t.name}</code>
                    <span className="ext-tool__desc">{t.description}</span>
                    <span className="ext-tool__schema">{t.inputSchema.join(" · ")}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="ext-section">
              <h4>Skills ({generated.length + skillFiles.length})</h4>
              <div className="ext-skills">
                {generated.map((s) => (
                  <div key={s.id} className={`ext-skill ext-skill--${s.source}`}>
                    <Icon name={s.source === "generated" ? "zap" : "book"} size={13} />
                    <code className="ext-skill__name">{s.name}</code>
                    <span className="ext-skill__src">
                      {s.source === "generated"
                        ? s.id === "claro-language"
                          ? "generated from contracts/dsl-schema.ts (cannot drift)"
                          : "rebuilt from # comments"
                        : s.path}
                    </span>
                    <span className="ext-skill__lines">{(s.content.match(/\n/g)?.length ?? 0) + 1} lines</span>
                  </div>
                ))}
                {skillFiles.map((f) => (
                  <div key={f} className="ext-skill ext-skill--user-skill">
                    <Icon name="book" size={13} />
                    <code className="ext-skill__name">{f.split(/[\\/]/).slice(-2).join("/")}</code>
                    <span className="ext-skill__src">user skill on disk</span>
                  </div>
                ))}
                {!skillFiles.length && (
                  <p className="ext-skills__none">
                    Drop opencode-style <code>SKILL.md</code> files into <code>apps/ide/skills/</code> to
                    extend BHASM.
                  </p>
                )}
              </div>
            </section>
          </div>
        </article>

        <article className="ext-card">
          <div className="ext-card__head">
            <div className="ext-card__icon">
              <Icon name="terminal" size={20} />
            </div>
            <div className="ext-card__title">
              <span className="ext-card__name">CLARO Terminal</span>
              <span className="ext-card__pub">CLARO · v0.1.0 · internal</span>
              <span className="ext-card__desc">
                ConPTY bridge over claro:term:* — spawn a shell or a built EXE by argv, and stream
                its stdout live into the terminal feed. Offline, Windows-native, no node-pty.
              </span>
            </div>
            <span className="ext-card__install ext-card__install--installed">Installed</span>
          </div>

          <div className="ext-card__sections">
            <section className="ext-section">
              <h4>IPC surface</h4>
              <div className="ext-tools">
                {[
                  ["claroTermSpawn", "spawn cmd(w) with argv, ConPTY pipes"],
                  ["claroTermWrite", "stdin into the running shell"],
                  ["claroTermKill", "terminate the child (SIGKILL via TreeKill)"],
                  ["claroTermOnData", "stdout rows streamed to the feed"],
                  ["claroTermOnExit", "exit code + carry-on line"],
                ].map(([id, desc]) => (
                  <div key={id} className="ext-tool">
                    <code className="ext-tool__id">{id}</code>
                    <span className="ext-tool__desc">{desc}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
};