import type { Candidate } from "@/lib/agent/schema";
import type { ExploreSeed } from "./exploreSeed";
import type { CandidateSignals } from "./normalizeCandidate";

export type Tiered = {
  finalists: Candidate[];
  discovery: Candidate[];
  rejected: Candidate[];
};

function includesCI(hay?: string, needle?: string) {
  if (!hay || !needle) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
}

function transmissionNorm(x?: string) {
  const t = (x ?? "").toLowerCase();
  if (!t) return undefined;
  if (t.includes("manual")) return "manual";
  if (t.includes("automatic") || t.includes("pdk") || t.includes("dsg")) return "automatic";
  return undefined;
}

/**
 * Strict semantic attribute match.
 *
 * - confirmed: required phrase appears in evidence
 * - unknown: evidence present but does not confirm
 *
 * NOTE: We intentionally do NOT return "contradicted" yet; absence of
 * evidence should not hard-fail a candidate, only downgrade it.
 */
type MatchResult = "confirmed" | "unknown";

function strictAttributeMatch(
  required: string | undefined,
  evidence: (string | undefined)[]
): MatchResult {
  if (!required) return "confirmed";

  const req = required.toLowerCase();
  const haystack = evidence
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack) return "unknown";
  if (haystack.includes(req)) return "confirmed";
  return "unknown";
}

export function scoreAndTier(
  seed: ExploreSeed,
  signalsAndCandidates: { sig: CandidateSignals; candidate: Candidate }[],
  clampFinalists: (c: Candidate[]) => Candidate[],
  clampDiscovery: (c: Candidate[]) => Candidate[]
): Tiered {
  const finalists: Candidate[] = [];
  const discovery: Candidate[] = [];
  const rejected: Candidate[] = [];

  for (const { sig, candidate } of signalsAndCandidates) {
    const reasons: string[] = [];
    let score = 50;

    // ---- Identity sanity gates ----
    if (seed.make && sig.make && !includesCI(sig.make, seed.make)) {
      rejected.push({
        ...candidate,
        verdict: "REJECT",
        score: 0,
        rationale: ["Wrong make"],
      });
      continue;
    }

    if (seed.model && sig.model && !includesCI(sig.model, seed.model)) {
      rejected.push({
        ...candidate,
        verdict: "REJECT",
        score: 0,
        rationale: ["Wrong model"],
      });
      continue;
    }

    // ---- Year gating ----
    const yearOk =
      !seed.yearMin ||
      (sig.year != null &&
        sig.year >= seed.yearMin &&
        (!seed.yearMax || sig.year <= seed.yearMax));

    if (!yearOk) {
      rejected.push({
        ...candidate,
        verdict: "REJECT",
        score: 0,
        rationale: ["Year outside required range"],
      });
      continue;
    }

    if (seed.yearMin && sig.year == null) {
      reasons.push("Year not specified (verify)");
    }

    // ---- Transmission ----
    const sigTx = transmissionNorm(sig.transmission);
    const txOk = seed.transmission !== "manual" || sigTx === "manual";

    if (!txOk) {
      rejected.push({
        ...candidate,
        verdict: "REJECT",
        score: 0,
        rationale: ["Transmission does not meet requirement"],
      });
      continue;
    }

    if (seed.transmission === "manual") {
      reasons.push("Manual transmission");
      score += 10;
    }

    // ---- Trim (generic, evidence-based) ----
    const trimEvidence = [
      sig.trim,
      sig.rawText,
    ];

    const trimMatch = strictAttributeMatch(seed.trim, trimEvidence);

    if (seed.trim) {
      if (trimMatch === "confirmed") {
        score += 8;
        reasons.push(`Trim confirmed (${seed.trim})`);
      } else {
        reasons.push(`Trim not confirmed (${seed.trim})`);
      }
    }

    // ---- Color (generic, strict semantic) ----
    const colorEvidence = [
      sig.exteriorColor,
      sig.rawText,
    ];

    const colorMatch = strictAttributeMatch(seed.exteriorColor, colorEvidence);

    if (seed.exteriorColor) {
      if (colorMatch === "confirmed") {
        score += 12;
        reasons.push(`Color confirmed (${seed.exteriorColor})`);
      } else {
        reasons.push(`Color not confirmed (${seed.exteriorColor})`);
      }
    }

    // ---- Budget ----
    const budgetOk =
      !seed.budgetMaxUsd ||
      (sig.price != null && sig.price <= seed.budgetMaxUsd);

    if (seed.budgetMaxUsd) {
      if (budgetOk && sig.price != null) {
        score += 8;
        reasons.push("Within budget");
      } else if (sig.price != null) {
        reasons.push("Over budget");
        score -= 10;
      } else {
        reasons.push("Price unknown");
      }
    }

    // ---- Mileage preferences ----
    if (sig.miles != null) {
      if (seed.mileageIdealMax && sig.miles <= seed.mileageIdealMax) {
        score += 10;
        reasons.push(`Mileage ideal (≤${seed.mileageIdealMax.toLocaleString()} mi)`);
      } else if (seed.mileageOkMax && sig.miles <= seed.mileageOkMax) {
        score += 5;
        reasons.push(`Mileage acceptable (≤${seed.mileageOkMax.toLocaleString()} mi)`);
      } else if (seed.mileageOkMax && sig.miles > seed.mileageOkMax) {
        score -= 8;
        reasons.push("Mileage above preference");
      }
    } else {
      reasons.push("Mileage unknown");
    }

    // ---- Salt-road heuristic (location-based, non-fatal) ----
    if (seed.avoidSaltHistory && sig.state) {
      reasons.push("Verify salt-road history");
    }

    // ---- Tier-1 gate (explicit, monotonic) ----
    const tier1Pass =
      (!seed.trim || trimMatch === "confirmed") &&
      (!seed.exteriorColor || colorMatch === "confirmed") &&
      txOk &&
      yearOk &&
      budgetOk;

    const out: Candidate = {
      ...candidate,
      score: Math.max(0, Math.min(100, Math.round(score))),
      rationale: reasons,
      verdict: "CONDITIONAL",
    };

    if (tier1Pass) {
      out.verdict = out.score >= 75 ? "ACCEPT" : "CONDITIONAL";
      finalists.push(out);
    } else {
      discovery.push(out);
    }
  }

  return {
    finalists: clampFinalists(finalists),
    discovery: clampDiscovery(discovery),
    rejected,
  };
}
