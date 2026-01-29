// lib/market/exploreSeed.ts
import type { AgentSession } from "@/lib/agent/schema";

export type ExploreSeed = {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  generation?: string;
  trim?: string;
  transmission?: "manual" | "automatic" | "either";
  exteriorColor?: string;

  // Constraints that are not provider-queryable in v1
  titleClean?: boolean;
  avoidSaltHistory?: boolean;

  // Preferences (for scoring)
  mileageIdealMax?: number;
  mileageOkMax?: number;

  budgetMaxUsd?: number;
};

export function deriveExploreSeed(session: AgentSession): ExploreSeed {
  const seed: ExploreSeed = {};

  // Start with structured intent if present
  seed.make = session.intent?.vehicle?.make || undefined;
  seed.model = session.intent?.vehicle?.model || undefined;
  seed.trim = session.intent?.vehicle?.trim || undefined;

  const all = [
    ...(session.constraints?.tier1 ?? []),
    ...(session.constraints?.tier2 ?? []),
    ...(session.constraints?.tier3 ?? []),
  ].join(" | ").toLowerCase();

  // Year range e.g. "(2003-2004)" or "2003–2004"
  const yr = all.match(/\b(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\b/);
  if (yr) {
    const parts = yr[0].split(/[-–]/).map((x) => parseInt(x.trim(), 10));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      seed.yearMin = parts[0];
      seed.yearMax = parts[1];
    }
  }

  // Generation token e.g. 986.2, B8.5, E92 etc.
  const gen = all.match(/\b\d{3}\.\d\b|\b[A-Z]\d{2,3}\b|\bB\d(\.\d)?\b/i);
  if (gen) seed.generation = gen[0].toUpperCase();

  // Transmission
  if (all.includes("manual")) seed.transmission = "manual";
  else if (all.includes("automatic") || all.includes("pdk") || all.includes("dsg")) seed.transmission = "automatic";
  else seed.transmission = "either";

  // Exterior color (strict phrases)
  const color = all.match(/speed yellow|guards red|arctic silver|black|white|yellow|silver|blue/);
  if (color) seed.exteriorColor = color[0];

  // Clean title
  if (all.includes("clean title")) seed.titleClean = true;

  // Salt-road history avoidance (v1 heuristic)
  if (all.includes("salt-road") || all.includes("salt road") || all.includes("northern") || all.includes("rust")) {
    seed.avoidSaltHistory = true;
  }

  // Mileage preferences
  // "under 50k ideal, under 80k acceptable"
  const miIdeal = all.match(/under\s*(\d{2,3})k\s*ideal/);
  if (miIdeal) seed.mileageIdealMax = parseInt(miIdeal[1], 10) * 1000;

  const miOk = all.match(/under\s*(\d{2,3})k\s*acceptable/);
  if (miOk) seed.mileageOkMax = parseInt(miOk[1], 10) * 1000;

  // Budget (your earlier runs used intent.budget.max; keep flexible)
  const budgetAny = (session.intent as any)?.budget?.max;
  if (typeof budgetAny === "number") seed.budgetMaxUsd = budgetAny;

  // Also parse explicit "max budget $30k"
  const b2 = all.match(/\bmax budget\s*\$?\s*(\d{2,3})k\b/);
  if (!seed.budgetMaxUsd && b2) seed.budgetMaxUsd = parseInt(b2[1], 10) * 1000;

  return seed;
}
