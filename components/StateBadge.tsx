"use client";

import type { AgentState } from "@/lib/agent/schema";

const LABELS: Record<AgentState, string> = {
  S0_INIT: "S0 Init",
  S1_CAPTURE: "S1 Capture",
  S2_CONFIRM: "S2 Confirm",
  S3_EXPLORE: "S3 Explore",
  S4_DECIDE: "S4 Decide",
  S5_WATCH: "S5 Watch",
  S6_ITERATE: "S6 Iterate",
  S7_CLOSE: "S7 Close",
};

export default function StateBadge({ state }: { state: AgentState }) {
  return (
    <span className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-200">
      {LABELS[state] ?? state}
    </span>
  );
}
