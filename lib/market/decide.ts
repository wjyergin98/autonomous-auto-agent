// lib/market/decide.ts

import type { AgentSession, Candidate } from "@/lib/agent/schema";
import { computeCanonicalBoundary } from "@/lib/agent/normalize";

export type S4Decision =
  | {
      action: "ACT";
      rationale: string[];
      selected: Candidate;
    }
  | {
      action: "WATCH";
      rationale: string[];
      blockers: string[];
      watchSeedSummary: string[];
    }
  | {
      action: "REVISE";
      rationale: string[];
      suggestedEdits: string[];
    };

function topByScore(arr: Candidate[]): Candidate | undefined {
  if (!arr.length) return undefined;
  return [...arr].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
}

/**
 * v1 heuristic: surface unique “not confirmed” signals
 */
function extractBlockers(candidates: Candidate[], max = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const rs = Array.isArray(c.rationale) ? c.rationale : [];
    for (const r of rs) {
      const s = String(r || "").trim();
      if (!s) continue;

      if (s.toLowerCase().includes("not confirmed")) {
        const key = s.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(s);
        }
      }
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Light presentation cleanup only (no semantic changes)
 */
function prettyBoundary(lines: string[]) {
  return lines.map((l) =>
    "- " +
    l
      .replace(/:/g, ": ")
      .replace(/\bonly\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function decide(session: AgentSession): { decision: S4Decision; message: string } {
  const finalists = session.finalists ?? [];
  const discovery = session.discovery ?? [];

  const canonical = computeCanonicalBoundary(session);
  const tier1 = canonical.tier1 ?? [];

  // ---- ACT ----
  if (finalists.length > 0) {
    const best = topByScore(finalists)!;

    const decision: S4Decision = {
      action: "ACT",
      selected: best,
      rationale: [
        "At least one listing meets all Tier 1 constraints",
        "This is the strongest qualifying option available now",
      ],
    };

    const msg =
      `S4 Decide — **Recommendation: ACT**\n\n` +
      `Why:\n` +
      decision.rationale.map((x) => `- ${x}`).join("\n") +
      `\n\nNext: Inspect details, verify history/service, and proceed to outreach or PPI.`;

    return { decision, message: msg };
  }

  // ---- WATCH ----
  if (finalists.length === 0 && discovery.length > 0) {
    const blockers = extractBlockers(discovery);

    const decision: S4Decision = {
      action: "WATCH",
      rationale: [
        "No listings meet all Tier 1 constraints",
        "Near-misses exist but fail confirmation",
        "Waiting preserves spec integrity",
      ],
      blockers,
      watchSeedSummary: tier1,
    };

    const msg =
      `S4 Decide — **Recommendation: WATCH**\n\n` +
      `Why:\n` +
      decision.rationale.map((x) => `- ${x}`).join("\n") +
      `\n\nTier 1 boundary:\n` +
      (tier1.length ? prettyBoundary(tier1).join("\n") : "- (none captured)") +
      `\n\nWhat’s missing right now:\n` +
      (blockers.length ? blockers.map((x) => `- ${x}`).join("\n") : "- (no explicit blockers captured)") +
      `\n\nClosest matches are shown above in Explore.\n\n` +
      `Next: Create a watch (S5) or revise constraints if you want more supply.`;

    return { decision, message: msg };
  }

  // ---- REVISE ----
  const decision: S4Decision = {
    action: "REVISE",
    rationale: [
      "No listings meet Tier 1 constraints and no near-misses were found",
      "The specification may be unrealistically strict or the market is temporarily empty",
    ],
    suggestedEdits: [
      "Relax one Tier 1 constraint",
      "Increase budget ceiling",
      "Broaden acceptable years or mileage",
      "Expand search radius or allow shipping",
    ],
  };

  const msg =
    `S4 Decide — **Recommendation: REVISE**\n\n` +
    `Why:\n` +
    decision.rationale.map((x) => `- ${x}`).join("\n") +
    `\n\nSuggested edits:\n` +
    decision.suggestedEdits.map((x) => `- ${x}`).join("\n") +
    `\n\nNext: Update constraints and re-run Explore (S3).`;

  return { decision, message: msg };
}
