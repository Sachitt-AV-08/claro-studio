import { create } from "zustand";

/**
 * Team Tasks board — persisted to localStorage so the panel survives restarts.
 * Tracks the M0–M5 milestones across the CLARO agents (openstyle "Tasks" pane).
 */

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

export interface TaskItem {
  id: string;
  milestone: string;
  agent: string;
  title: string;
  status: TaskStatus;
}

const DEFAULT_TASKS: TaskItem[] = [
  { id: "m0", milestone: "M1", agent: "A2", title: "Icon + brand wiring", status: "done" },
  { id: "m1", milestone: "M1", agent: "A2", title: "Icons + chrome + tab strip + activity bar", status: "done" },
  { id: "m2a", milestone: "M2", agent: "A2", title: "Phone-frame preview + device toggle", status: "done" },
  { id: "m2b", milestone: "M2", agent: "A3", title: "Streaming AI + health gate (Bhasm)", status: "done" },
  { id: "m3a", milestone: "M3", agent: "A2", title: "BHASM panel (agent/tools/skills/runtime)", status: "done" },
  { id: "m3b", milestone: "M3", agent: "A2", title: "Extensions view", status: "done" },
  { id: "m4a", milestone: "M4", agent: "A2", title: "Stitch primary view + seam", status: "in_progress" },
  { id: "m4b", milestone: "M4", agent: "A2", title: "Todos (chat + team board)", status: "in_progress" },
  { id: "m4c", milestone: "M4", agent: "A2", title: "Comment → Bhasm + palette + Problems + Export", status: "todo" },
  { id: "m5", milestone: "M5", agent: "A2", title: "Delivery: final rebuild, commit, push", status: "todo" },
  { id: "a1", milestone: "A1", agent: "A1", title: "Comment preservation + getLanguageKnowledge", status: "todo" },
  { id: "a4", milestone: "A4", agent: "A4", title: "Android Compose codegen + parity tests", status: "todo" },
];

const STORAGE_KEY = "claro.team-tasks.v1";

function loadTasks(): TaskItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TASKS;
    const parsed = JSON.parse(raw) as TaskItem[];
    if (Array.isArray(parsed) && parsed.length) return parsed;
    return DEFAULT_TASKS;
  } catch {
    return DEFAULT_TASKS;
  }
}

interface TasksState {
  tasks: TaskItem[];
  setStatus: (id: string, status: TaskStatus) => void;
  reset: () => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: loadTasks(),
  setStatus(id, status) {
    const tasks = get().tasks.map((t) => (t.id === id ? { ...t, status } : t));
    set({ tasks });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      /* storage unavailable */
    }
  },
  reset() {
    set({ tasks: DEFAULT_TASKS });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  },
}));