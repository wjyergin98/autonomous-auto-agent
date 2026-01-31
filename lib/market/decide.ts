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
      watchSeedSummary: string[]; // human-readable Tier 1 summary
      blockers: string[];         // human-readable blockers (from candidate rationales)
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

function fmtCandidateLine(c: Candidate): string {
  const title = c.url ? `[${c.title}](${c.url})` : c.title;
  return `- [${c.verdict}] ${title} (score ${c.score})`;
}

/**
 * Pull a compact set of “blocking” statements from candidate rationales.
 * v1 heuristic: include any rationale line containing "not confirmed".
 */
function extractBlockers(candidates: Candidate[], max = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const rs = Array.isArray(c.rationale) ? c.rationale : [];
    for (const r of rs) {
      const s = String(r || "").trim();
      if (!s) continue;

      // keep it simple & generic (no domain literals)
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

export function decide(session: AgentSession): { decision: S4Decision; message: string } {
  const finalists = session.finalists ?? [];
  const discovery = session.discovery ?? [];

  const canonical = computeCanonicalBoundary(session);
  const tier1 = canonical.tier1 ?? [];

  // --- ACT: at least one Tier-1 match exists ---
  if (finalists.length > 0) {
    const best = topByScore(finalists)!;

    const decision: S4Decision = {
      action: "ACT",
      selected: best,
      rationale: [
        "At least one listing meets all Tier 1 constraints.",
        "This is the best-scoring qualifying candidate right now.",
      ],
    };

    const msg =
      `S4 Decide\n\n` +
      `Recommendation: ACT\n\n` +
      `Why:\n` +
      decision.rationale.map((x) => `- ${x}`).join("\n") +
      `\n\nSelected:\n` +
      fmtCandidateLine(best) +
      `\n\nNext: Inspect details, verify history/service, and move to outreach/PPI.`; // keep short v1

    return { decision, message: msg };
  }

  // --- WATCH: no finalists, but near-misses exist ---
  if (finalists.length === 0 && discovery.length > 0) {
    const blockers = extractBlockers(discovery);

    const decision: S4Decision = {
      action: "WATCH",
      rationale: [
        "No listings currently meet all Tier 1 constraints.",
        "Near-miss listings exist, but they fail strict requirements or lack confirmation.",
        "Waiting is the correct decision for this specification; set a watch.",
      ],
      watchSeedSummary: tier1,
      blockers,
    };

    const top3 = discovery.slice(0, 3);

    const msg =
      `S4 Decide\n\n` +
      `Recommendation: WATCH\n\n` +
      `Why:\n` +
      decision.rationale.map((x) => `- ${x}`).join("\n") +
      `\n\nTier 1 boundary:\n` +
      (tier1.length ? tier1.map((x) => `- ${x}`).join("\n") : "- (none captured)") +
      `\n\nBlocking signals (from listings):\n` +
      (blockers.length ? blockers.map((x) => `- ${x}`).join("\n") : "- (no explicit blockers captured)") +
      `\n\nClosest matches (Discovery):\n` +
      top3.map(fmtCandidateLine).join("\n") +
      `\n\nNext: Create a watch (S5) or revise constraints if you want more supply.`;

    return { decision, message: msg };
  }

  // --- REVISE: nothing even close ---
  const decision: S4Decision = {
    action: "REVISE",
    rationale: [
      "No listings meet Tier 1 constraints and no near-misses were found in the current retrieval window.",
      "This specification may be unrealistically strict, or the market is temporarily empty.",
    ],
    suggestedEdits: [
      "Relax one Tier 1 constraint (e.g., color, trim, transmission) if acceptable.",
      "Increase budget ceiling.",
      "Broaden acceptable years or mileage.",
      "Expand search radius / allow shipping if not already.",
    ],
  };

  const msg =
    `S4 Decide\n\n` +
    `Recommendation: REVISE\n\n` +
    `Why:\n` +
    decision.rationale.map((x) => `- ${x}`).join("\n") +
    `\n\nSuggested edits:\n` +
    decision.suggestedEdits.map((x) => `- ${x}`).join("\n") +
    `\n\nNext: Update constraints and re-run Explore (S3).`;

  return { decision, message: msg };
}
