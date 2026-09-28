/**
 * Claro Decisions — UI-facing state: last route + last guardrail verdict,
 * so the BHASM panel can render a confidence chip and safety notices.
 */

import { create } from "zustand";
import type { LadderStep } from "@project/ai";

export interface RouteInfo {
  task: "route" | "classify";
  choice: string;
  probability: number;
  step: LadderStep;
  provider: "local" | "fallback" | "embed" | "gate";
}

export interface GuardrailInfo {
  choice: "approve" | "reject";
  probability: number;
  step: LadderStep;
  reason?: string;
  provider: "local" | "fallback" | "embed" | "gate";
}

interface DecisionState {
  lastRoute?: RouteInfo;
  lastGuardrail?: GuardrailInfo;
  setRoute: (r: RouteInfo) => void;
  setGuardrail: (g: GuardrailInfo) => void;
  clear: () => void;
}

export const useDecisionStore = create<DecisionState>((set) => ({
  lastRoute: undefined,
  lastGuardrail: undefined,
  setRoute: (r) => set({ lastRoute: r }),
  setGuardrail: (g) => set({ lastGuardrail: g }),
  clear: () => set({ lastRoute: undefined, lastGuardrail: undefined }),
}));