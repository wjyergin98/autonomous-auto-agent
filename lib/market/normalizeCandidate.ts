// lib/market/normalizeCandidate.ts
import type { Candidate, Verdict } from "@/lib/agent/schema";
import { makeCandidate } from "@/lib/agent/scoring";
import type { AutoDevListing } from "./autodev";
import type { ExploreSeed } from "./exploreSeed";

function toNum(x: any): number | undefined {
  const n = typeof x === "number" ? x : typeof x === "string" ? parseFloat(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function normStr(x: any): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t ? t : undefined;
}

// Deterministic hash for stable IDs in demo (no crypto dependency)
function stableId(parts: (string | number | undefined)[]) {
  const s = parts.filter(Boolean).join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `autodev-${(h >>> 0).toString(16)}`;
}

export type CandidateSignals = {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  transmission?: string;
  exteriorColor?: string;
  price?: number;
  miles?: number;
  state?: string;
  dealer?: string;
  url?: string;
  photo?: string;
  vin?: string;
  rawText?: string;
};

export function listingToSignals(l: AutoDevListing): CandidateSignals {
  const v = l?.vehicle ?? {};
  const r = l?.retailListing ?? {};

  const year = toNum(v.year);
  const make = normStr(v.make);
  const model = normStr(v.model);
  const trim = normStr(v.trim);
  const transmission = normStr(v.transmission);
  const exteriorColor = normStr(v.exteriorColor);

  const price = toNum(r.price);
  const miles = toNum(r.miles);
  const state = normStr(r.state);
  const dealer = normStr(r.dealer);

  const url = normStr(r.vdp) || normStr(l["@id"]);
  const photo = normStr(r.primaryImage);

  const vin = normStr(l.vin) || normStr(v.vin);

  const rawText = [
    make, model, trim, transmission, exteriorColor,
    normStr(v.engine),
    normStr(v.series),
    normStr(r.city), state, dealer,
  ].filter(Boolean).join(" ").toLowerCase();


  return { year, make, model, trim, transmission, exteriorColor, price, miles, state, dealer, url, photo, vin, rawText };
}

export function buildCandidateFromSignals(sig: CandidateSignals, score: number, verdict: Verdict, rationale: string[]): Candidate {
  const titleParts: string[] = [];
  if (sig.year) titleParts.push(String(sig.year));
  if (sig.make) titleParts.push(sig.make);
  if (sig.model) titleParts.push(sig.model);
  if (sig.trim) titleParts.push(sig.trim);

  const meta: string[] = [];
  if (sig.price != null) meta.push(`$${Math.round(sig.price).toLocaleString()}`);
  if (sig.miles != null) meta.push(`${Math.round(sig.miles).toLocaleString()} mi`);
  if (sig.state) meta.push(sig.state);

  const title = `${titleParts.join(" ")}${meta.length ? " — " + meta.join(", ") : ""}`.trim();

  return makeCandidate({
    id: stableId([sig.vin, sig.url, sig.year, sig.make, sig.model, sig.trim, sig.price]),
    title,
    url: sig.url,
    // NOTE: Candidate.images is documented as base64 data URLs in v1, but the UI usually accepts normal URLs.
    // If your UI enforces data URLs, omit images here.
    images: sig.photo ? [sig.photo] : undefined,
    verdict,
    score,
    rationale,
    is_placeholder: false,
  });
}
