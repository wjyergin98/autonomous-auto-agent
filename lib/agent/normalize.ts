import type { AgentSession } from "./schema";

/**
 * Normalizes extracted state into a canonical, retrieval-friendly form.
 * Goals:
 * - (B1) Tier hygiene: avoid/prefer/ideal/acceptable -> Tier2/3 unless explicitly non-negotiable.
 * - (B2) Vehicle normalization: pull gen + year_range out of constraint text when missing.
 * - De-duplicate constraints and keep them stable.
 */
export function normalizeSession(session: AgentSession): AgentSession {
  const s = structuredClone(session) as AgentSession;

  // ---- 1) Extract gen/year_range from Tier 1 text if missing ----
  const allText = [
    ...(s.constraints.tier1 ?? []),
    ...(s.constraints.tier2 ?? []),
    ...(s.constraints.tier3 ?? []),
  ].join(" | ");

  s.intent.vehicle = s.intent.vehicle ?? {};

  if (!s.intent.vehicle.gen) {
    const gen = extractGenerationToken(allText);
    if (gen) s.intent.vehicle.gen = gen;
  }

  if (!s.intent.vehicle.year_range) {
    const yr = extractYearRange(allText);
    if (yr) s.intent.vehicle.year_range = yr;
  }

  // ---- 2) Tier normalization (heuristic) ----
  const tier1: string[] = [];
  const tier2: string[] = [];
  const tier3: string[] = [];

  const pushUnique = (arr: string[], item: string) => {
    const norm = normalizeLine(item);
    if (!norm) return;
    if (!arr.some((x) => normalizeLine(x) === norm)) arr.push(item.trim());
  };

  // Process Tier1 first; demote "avoid/prefer/ideal/acceptable" phrasing unless explicit non-negotiable.
  for (const c of s.constraints.tier1 ?? []) {
    const bucket = classifyConstraintTier(c, "tier1");
    if (bucket === "tier1") pushUnique(tier1, c);
    else if (bucket === "tier2") pushUnique(tier2, c);
    else pushUnique(tier3, c);
  }

  // Keep existing Tier2/Tier3 but allow promotion if explicitly non-negotiable.
  for (const c of s.constraints.tier2 ?? []) {
    const bucket = classifyConstraintTier(c, "tier2");
    if (bucket === "tier1") pushUnique(tier1, c);
    else if (bucket === "tier2") pushUnique(tier2, c);
    else pushUnique(tier3, c);
  }

  for (const c of s.constraints.tier3 ?? []) {
    const bucket = classifyConstraintTier(c, "tier3");
    if (bucket === "tier1") pushUnique(tier1, c);
    else if (bucket === "tier2") pushUnique(tier2, c);
    else pushUnique(tier3, c);
  }

  s.constraints.tier1 = tier1;
  s.constraints.tier2 = tier2;
  s.constraints.tier3 = tier3;

  return s;
}

/**
 * Canonical boundary derived from session state (B3).
 * Model boundary can still add compromises, but Tier1/Tier2 truth lives here.
 */
export function computeCanonicalBoundary(session: AgentSession): {
  tier1: string[];
  tier2: string[];
  hard_rejections: string[];
} {
  const tier1 = session.constraints.tier1 ?? [];
  const tier2 = session.constraints.tier2 ?? [];

  // Hard rejections: explicit rejection rules + auto-derived "no <tier1-violations>"
  const explicit = session.taste?.rejection_rules ?? [];
  const derived = tier1.map((x) => `No listings that violate: ${x}`);

  const hard_rejections = dedupeStrings([...explicit, ...derived]);
  return { tier1, tier2, hard_rejections };
}

// ------------------------- helpers -------------------------

function normalizeLine(s: string) {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-")
    .trim();
}

function dedupeStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of items) {
    const n = normalizeLine(x);
    if (!n) continue;
    if (!seen.has(n)) {
      seen.add(n);
      out.push(x.trim());
    }
  }
  return out;
}

function classifyConstraintTier(text: string, prior: "tier1" | "tier2" | "tier3"): "tier1" | "tier2" | "tier3" {
  const t = normalizeLine(text);

  // Strong Tier1 indicators
  const isHard = /\b(non-negotiable|deal-?breaker|must|only|clean title)\b/.test(t);

  // Strong Tier3 indicators
  const isNice = /\b(nice to have|nice-to-have|nice)\b/.test(t);

  // Preference language (demote from Tier1 unless explicitly hard)
  const isPreference = /\b(avoid|prefer|preferred|ideal|ideally|acceptable|ok)\b/.test(t);

  if (isHard) return "tier1";
  if (isNice) return "tier3";

  // If it reads like preference, never Tier1
  if (isPreference) return prior === "tier3" ? "tier3" : "tier2";

  // Default: keep prior
  return prior;
}

function extractYearRange(text: string): string | null {
  // Matches 2003-2004, 2003–2004, 2003 to 2004
  const m =
    text.match(/\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/) ??
    text.match(/\b(19|20)\d{2}\s*(to)\s*(19|20)\d{2}\b/i);

  if (!m) return null;

  const years = m[0].match(/\b(19|20)\d{2}\b/g);
  if (!years || years.length < 2) return null;

  const a = years[0];
  const b = years[1];
  return `${a}-${b}`;
}

function extractGenerationToken(text: string): string | null {
  // Common patterns:
  // - Porsche: 986.2, 987.2, 996, 997.2 etc
  // - BMW: E92, F80, G80 etc
  // - Audi: B7, B8.5 etc
  const patterns = [
    /\b\d{3}\.\d\b/g,          // 986.2
    /\b\d{3}\b/g,              // 986/987/996 (fallback)
    /\b[A-Z]\d{2,3}\b/g,       // E92, F80, G80
    /\bB\d(\.\d)?\b/gi,        // B7, B8.5
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m && m.length) {
      // pick the first "best" token
      return m[0].toUpperCase();
    }
  }
  return null;
}
