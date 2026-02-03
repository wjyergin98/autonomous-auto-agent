// lib/market/watchStore.ts

import type { WatchSpec } from "@/lib/agent/schema";

const store = new Map<string, WatchSpec>();

export function getWatch(key: string): WatchSpec | undefined {
  return store.get(key);
}

export function setWatch(key: string, watch: WatchSpec): void {
  store.set(key, watch);
}

export function hasWatch(key: string): boolean {
  return store.has(key);
}

export function listWatches(): WatchSpec[] {
  return Array.from(store.values());
}
