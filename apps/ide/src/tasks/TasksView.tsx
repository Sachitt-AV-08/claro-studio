import React from "react";
import { useTasksStore, type TaskStatus } from "./tasksStore";
import { Icon, type IconName } from "../components/Icon";

/**
 * Team Tasks — the persisted board (openstyle "Tasks" pane). Tracks the
 * M0→M5 milestones across A1/A2/A3/A4. Ready for shared sync later;
 * currently survives restarts via localStorage.
 */

const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done", "blocked"];
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "todo",
  in_progress: "in progress",
  done: "done",
  blocked: "blocked",
};
const STATUS_ICON: Record<TaskStatus, IconName> = {
  todo: "circle-outline",
  in_progress: "sync",
  done: "circle-filled",
  blocked: "error",
};

export const TasksView: React.FC = () => {
  const tasks = useTasksStore((s) => s.tasks);
  const setStatus = useTasksStore((s) => s.setStatus);
  const reset = useTasksStore((s) => s.reset);

  const done = tasks.filter((t) => t.status === "done").length;
  const pct = Math.round((done / tasks.length) * 100);

  return (
    <div className="tasks">
      <div className="pane__header">
        <span>Tasks</span>
        <span className="pane__sub">
          {done}/{tasks.length} · {pct}%
        </span>
      </div>

      <div className="tasks__board">
        {tasks.map((task) => (
          <div key={task.id} className="tasks__card">
            <button
              className={`tasks__check tasks__check--${task.status}`}
              onClick={() => {
                const idx = STATUS_ORDER.indexOf(task.status);
                const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
                setStatus(task.id, task.status === "blocked" ? "todo" : next);
              }}
              title={`mark ${task.status === "done" ? "todo" : "done"}`}
            >
              <Icon name={STATUS_ICON[task.status]} size={13} />
            </button>
            <div className="tasks__meta">
              <span className="tasks__milestone">{task.milestone}</span>
              <span className="tasks__agent" title={`assigned to ${task.agent}`}>
                {task.agent}
              </span>
            </div>
            <span className="tasks__title">{task.title}</span>
            <span
              className={`tasks__status tasks__status--${task.status}`}
              title={STATUS_LABEL[task.status]}
            />
          </div>
        ))}
      </div>

      <button className="tasks__reset" onClick={reset} title="Restore default board">
        <Icon name="refresh" size={12} /> reset board
      </button>
    </div>
  );
};