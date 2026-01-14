import { AgentSession, AgentState, Candidate } from "./schema";

export function nextExecState(session: AgentSession): AgentState {
  // Convergent guardrails
  switch (session.state) {
    case "S0_INIT":
      return "S1_CAPTURE";
    case "S1_CAPTURE":
      // Heuristic: consider "captured" if we have at least 3 Tier-1 constraints
      return session.constraints.tier1.length >= 3 ? "S2_CONFIRM" : "S1_CAPTURE";
    case "S2_CONFIRM":
      return "S3_EXPLORE";
    case "S3_EXPLORE":
      return "S4_DECIDE";
    case "S4_DECIDE":
      // Model (or stub) chooses next; default to Watch if no accepted finalists
      return session.finalists.some((c) => c.verdict === "ACCEPT") ? "S7_CLOSE" : "S5_WATCH";
    case "S5_WATCH":
      return "S7_CLOSE";
    case "S6_ITERATE":
      return "S2_CONFIRM";
    case "S7_CLOSE":
      return "S7_CLOSE";
    default:
      return "S1_CAPTURE";
  }
}

export function clampFinalists(items: Candidate[]) {
  return [...items].sort((a, b) => b.score - a.score).slice(0, 5);
}

export function clampDiscovery(items: Candidate[]) {
  return [...items].sort((a, b) => b.score - a.score).slice(0, 3);
}
