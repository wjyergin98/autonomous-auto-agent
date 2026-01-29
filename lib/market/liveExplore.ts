// lib/market/liveExplore.ts
import type { AgentSession } from "@/lib/agent/schema";
import { clampFinalists, clampDiscovery } from "@/lib/agent/stateMachine";
import { deriveExploreSeed } from "./exploreSeed";
import { searchAutoDevListings } from "./autodev";
import { listingToSignals, buildCandidateFromSignals } from "./normalizeCandidate";
import { scoreAndTier } from "./scoreAndTier";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
  });
}

function dedupeListingsByVinOrUrl(listings: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];

  for (const l of listings) {
    const vin = (l?.vin || l?.vehicle?.vin || "").toString().trim();
    const url = (l?.retailListing?.vdp || l?.["@id"] || "").toString().trim();

    const key = vin ? `vin:${vin}` : url ? `url:${url}` : "";
    if (!key) continue;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }

  return out;
}


export async function runLiveExplore(session: AgentSession): Promise<{
  session: AgentSession;
  meta: { fetched: number; used: number; seed: ReturnType<typeof deriveExploreSeed> };
}> {
  const seed = deriveExploreSeed(session);

  // Minimum viable seed for live retrieval
  if (!seed.make || !seed.model) {
    throw new Error("Insufficient seed (missing make/model)");
  }

  const topN = parseInt(process.env.LIVE_SEARCH_TOPN ?? "50", 10);
  const timeoutMs = parseInt(process.env.LIVE_SEARCH_TIMEOUT_MS ?? "3500", 10);

  // Build provider query (keep broader than Tier-1 to avoid missing)
  const year = seed.yearMin && seed.yearMax ? `${seed.yearMin}-${seed.yearMax}` : undefined;
  const price = seed.budgetMaxUsd ? `0-${seed.budgetMaxUsd}` : undefined;

  const listings = await withTimeout(
    searchAutoDevListings({
      page: 1,
      limit: Math.min(100, Math.max(1, topN)),
      sort: "price.asc",
      year,
      make: seed.make,
      model: seed.model,
      transmission: seed.transmission === "manual" ? "manual" : undefined,
      // do NOT filter by color here; it’s unreliable. handle in scoring.
      price,
      // optional mileage upper bound if provided (keeps recall reasonable)
      miles: seed.mileageOkMax ? `0-${seed.mileageOkMax}` : undefined,
    }),
    timeoutMs
  );
  
  //Logging for object
  //console.log("AUTO_DEV_SAMPLE_LISTING", JSON.stringify(listings[0], null, 2));

  const deduped = dedupeListingsByVinOrUrl(listings);
  const sliced = deduped.slice(0, topN);

  const sigs = sliced.map((l: any) => listingToSignals(l));
  const candidates = sigs.map((sig) =>
    buildCandidateFromSignals(sig, 50, "CONDITIONAL", ["Unscored (initial)"])
  );

  const tiered = scoreAndTier(
    seed,
    candidates.map((candidate, i) => ({ candidate, sig: sigs[i] })),
    clampFinalists,
    clampDiscovery
  );

  const next = structuredClone(session) as AgentSession;
  next.finalists = tiered.finalists;
  next.discovery = tiered.discovery;

  return { session: next, meta: { fetched: listings.length, used: sliced.length, seed } };
}
