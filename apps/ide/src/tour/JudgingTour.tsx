import React, { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon";

/**
 * Judging Tour — a 3-step guided walkthrough baked into the workbench.
 *
 *   Ctrl+Shift+J  (or Command Palette → "Start Judging Tour") opens the tour.
 *   Step 1 "See"   loads the preloaded demo screen + resets Edge-AI metrics.
 *   Step 2 "Edit"  opens BHASM pre-filled with a real code prompt.
 *   Step 3 "Step back" opens the Stitch seam and performs one undo.
 *
 * Each step dispatches a `claro:tour` event that App.tsx handles (it owns the
 * workbench state). This component is a thin, stateless shell — no store access.
 */

type TourAction = "load-demo" | "edit-demo" | "step-back" | "open";

const STEPS: { id: TourAction; icon: IconName; title: string; body: string; cta: string }[] = [
  {
    id: "load-demo",
    icon: "eye",
    title: "1 · See it",
    body: "Load a full product page written in Claro — navbar, hero, pricing grid, form. Zero build step, live preview.",
    cta: "Load the demo screen",
  },
  {
    id: "edit-demo",
    icon: "sparkle",
    title: "2 · Edit it",
    body: "BHASM reads the source like a human. Watch it propose real PatchOps — gated by the local Edge-AI ladder first.",
    cta: "Open BHASM pre-filled",
  },
  {
    id: "step-back",
    icon: "history",
    title: "3 · Step back",
    body: "Every AI edit is a reversible PatchOp. Open the Stitch seam and undo — the source returns to byte-identical.",
    cta: "Open Stitch + undo once",
  },
];

const fire = (action: TourAction) =>
  window.dispatchEvent(new CustomEvent("claro:tour", { detail: { action } }));

export const JudgingTour: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (action === "open") setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("claro:tour", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("claro:tour", onOpen);
    };
  }, []);

  if (!open) {
    return (
      <button
        className="tour__launch"
        onClick={() => setOpen(true)}
        title="Judging Tour (Ctrl+Shift+J)"
      >
        <Icon name="rocket" size={14} /> Tour
      </button>
    );
  }

  return (
    <div className="tour" role="dialog" aria-label="Judging Tour">
      <header className="tour__head">
        <span>
          <Icon name="rocket" size={13} /> Judging Tour
        </span>
        <button className="tour__close" onClick={() => setOpen(false)} title="Close (Ctrl+Shift+J)">
          <Icon name="chrome-close" size={12} />
        </button>
      </header>
      <div className="tour__steps">
        {STEPS.map((s) => (
          <button key={s.id} className="tour__step" onClick={() => fire(s.id)}>
            <span className="tour__step-icon">
              <Icon name={s.icon} size={14} />
            </span>
            <span className="tour__step-copy">
              <b>{s.title}</b>
              <small>{s.body}</small>
              <em>{s.cta} →</em>
            </span>
          </button>
        ))}
      </div>
      <footer className="tour__foot">
        Ctrl+Shift+J toggles · pops open the three beats of the product pitch
      </footer>
    </div>
  );
};

export default JudgingTour;