// lib/market/watch.ts

import type { AgentSession, WatchSpec } from "@/lib/agent/schema";
import { computeCanonicalBoundary } from "@/lib/agent/normalize";
import { getWatch, setWatch } from "./watchStore";

function canonicalWatchKey(session: AgentSession): string {
  const c = computeCanonicalBoundary(session);
  return JSON.stringify({
    goal: session.goal_type,
    must_have: c.tier1 ?? [],
    acceptable: c.tier2 ?? [],
    reject: c.hard_rejections ?? [],
  });
}

export function ensureWatch(session: AgentSession): {
  watch: WatchSpec;
  created: boolean;
} {
  const canonical = computeCanonicalBoundary(session);

  const spec: WatchSpec = {
    must_have: canonical.tier1 ?? [],
    acceptable: canonical.tier2 ?? [],
    reject: canonical.hard_rejections ?? [],
    sources: ["auto.dev"],
  };

  const key = JSON.stringify({
    goal: session.goal_type,
    must_have: spec.must_have,
    acceptable: spec.acceptable,
    reject: spec.reject,
    sources: spec.sources,
  });

  const existing = getWatch(key);
  if (existing) {
    return { watch: existing, created: false };
  }

  setWatch(key, spec);
  return { watch: spec, created: true };
}
