import { Candidate, Verdict } from "./schema";

export function makeCandidate(
  partial: Omit<Candidate, "id"> & { id?: string }
): Candidate {
  const id = partial.id ?? cryptoRandomId();
  return { id, ...partial };
}

export function normalizeVerdict(v: Verdict): Verdict {
  if (v === "ACCEPT" || v === "CONDITIONAL" || v === "REJECT") return v;
  return "CONDITIONAL";
}

// Simple utility for v1 (no dependency)
function cryptoRandomId() {
  return Math.random().toString(16).slice(2) + "-" + Math.random().toString(16).slice(2);
}
