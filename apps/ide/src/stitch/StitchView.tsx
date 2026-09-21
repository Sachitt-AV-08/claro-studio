import React, { useEffect, useMemo, useState } from "react";
import { useClaroStore } from "../store/claroStore";
import { useStitchStore, destProject, checkOps, type StitchProposal } from "./stitchStore";
import { DevicePreview } from "../preview/DevicePreview";
import { extractIdeas } from "../bhasm/skills/ideas";
import { Icon } from "../components/Icon";

/**
 * Stitch — CLARO Studio's primary view.
 *
 * Google-Stitch style merge UX for the project's own evolution:
 *   goal bar  -> the active "#" idea (the project brain)
 *   Source A  -> current project
 *   the seam  -> the exact PatchOps to reach the goal (reversible).
 *   Destination -> A + ops applied, live-previewed in the phone frame.
 */

export const StitchView: React.FC = () => {
  const source = useClaroStore((s) => s.source);
  const project = useClaroStore((s) => s.project);
  const selection = useClaroStore((s) => s.selection);
  const applyOps = useClaroStore((s) => s.applyOps);

  const proposal = useStitchStore((s) => s.proposal);
  const goal = useStitchStore((s) => s.goal);
  const setGoal = useStitchStore((s) => s.setGoal);

  const [showSeam, setShowSeam] = useState(true);
  const ideas = useMemo(() => extractIdeas(source), [source]);

  // keep goal in sync with the first idea automatically
  useEffect(() => {
    if (!goal && ideas.length) setGoal(ideas[0].text);
  }, [ideas, goal, setGoal]);

  const dest = useMemo(
    () => (proposal ? destProject(project, proposal.ops) : project),
    [proposal, project],
  );

  const opsValid = proposal ? checkOps(proposal.ops).ok : false;

  const commit = () => {
    if (!proposal || !opsValid) return;
    const res = applyOps(proposal.ops);
    if (res.ok) useStitchStore.getState().clear();
  };

  const nodeOpCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (proposal) {
      for (const op of proposal.ops) {
        const target = (op as { target?: string }).target ?? (op as { parent?: string }).parent;
        if (target) counts[target] = (counts[target] ?? 0) + 1;
      }
    }
    return counts;
  }, [proposal]);

  return (
    <div className="stitch">
      {/* Goal bar */}
      <header className="stitch__goalbar">
        <div className="stitch__goal-label">
          <Icon name="milestone" size={13} /> GOAL
        </div>
        <input
          className="stitch__goal-input"
          value={goal ?? ""}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="The goal comes from your # ideas…"
          title="The project's # comments are the brain — BHASM treats this line as the spec"
        />
        {ideas.length > 0 && (
          <div className="stitch__ideas">
            {ideas.map((idea) => (
              <button
                key={idea.line}
                className={`stitch__idea${goal === idea.text ? " stitch__idea--active" : ""}`}
                onClick={() => setGoal(idea.text)}
                title={`line ${idea.line}`}
              >
                {idea.text}
              </button>
            ))}
          </div>
        )}
        <span className="stitch__provenance">
          <Icon name="shield" size={12} /> reversible seam
        </span>
      </header>

      {/* The seam */}
      <div className="stitch__body">
        <section className="stitch__col stitch__col--a">
          <div className="stitch__col-head">
            <span className="stitch__tag stitch__tag--a">SOURCE A</span>
            <span className="stitch__col-sub">current project</span>
          </div>
          <DevicePreview project={project} selection={selection} onSelect={() => {}} showToolbar={false} />
        </section>

        <section className="stitch__seam">
          <div className="stitch__seam-head">
            <Icon name="diff" size={13} />
            <span>SEAM</span>
            <button
              className={`stitch__seam-toggle${showSeam ? " stitch__seam-toggle--on" : ""}`}
              onClick={() => setShowSeam((v) => !v)}
              title={showSeam ? "hide ops" : "show ops"}
            >
              <Icon name={showSeam ? "chevron-up" : "chevron-down"} size={12} />
            </button>
          </div>

          {proposal ? (
            showSeam && (
              <div className="stitch__ops">
                <div className="stitch__op-summary">{proposal.summary}</div>
                {proposal.ops.map((op, i) => {
                  const target = (op as { target?: string }).target ?? (op as { parent?: string }).parent ?? "?";
                  return (
                    <div key={i} className="stitch__op" title={JSON.stringify(op)}>
                      <span className="stitch__op-index">{i + 1}</span>
                      <code className="stitch__op-kind">{(op as { op: string }).op}</code>
                      <code className="stitch__op-target">{target}</code>
                      <span className="stitch__op-dir" title="reversible">
                        <Icon name="history" size={11} /> undo
                      </span>
                    </div>
                  );
                })}
                {!opsValid && (
                  <div className="stitch__ops-invalid">
                    <Icon name="error" size={12} /> This batch failed validation — BHASM produced
                    invalid ops. Re-run in the panel.
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="stitch__empty">
              <Icon name="arrow-both" size={18} />
              <p>
                No patch staged yet. Ask BHASM to make a change (Code mode) — the proposal lands
                here as a reversible seam between Source A and the Destination.
              </p>
            </div>
          )}

          {proposal && (
            <div className="stitch__actions">
              <button className="stitch__btn stitch__btn--ghost" onClick={() => useStitchStore.getState().clear()}>
                Discard
              </button>
              <button className="stitch__btn stitch__btn--primary" onClick={commit} disabled={!opsValid} title="Apply the seam to the editor undo stack (Ctrl+Z to undo)">
                <Icon name="check" size={13} /> Commit seam
              </button>
            </div>
          )}
        </section>

        <section className="stitch__col stitch__col--dest">
          <div className="stitch__col-head">
            <span className="stitch__tag stitch__tag--dest">DESTINATION</span>
            <span className="stitch__col-sub">
              {proposal ? `A + ${proposal.ops.length} ${proposal.ops.length === 1 ? "op" : "ops"}` : "unchanged"}
              {proposal && (
                <button
                  className="stitch__node-count"
                  title={`touches ${Object.keys(nodeOpCounts).length} nodes`}
                >
                  <Icon name="target" size={11} /> {Object.keys(nodeOpCounts).length} nodes
                </button>
              )}
            </span>
          </div>
          <DevicePreview project={dest} selection={selection} onSelect={() => {}} showToolbar={false} />
        </section>
      </div>
    </div>
  );
};

export type { StitchProposal };