"use client";

import { useMemo } from "react";
import type { AgentSession } from "@/lib/agent/schema";

export type ArtifactsTab = "Session" | "Intent" | "Taste" | "Constraints" | "Finalists" | "Watch";

export default function ArtifactsPanel({
  session,
  tab,
  setTab,
}: {
  session: AgentSession;
  tab: ArtifactsTab;
  setTab: (t: ArtifactsTab) => void;
}) {
  const payload = useMemo(() => {
    switch (tab) {
      case "Session":
        return session;
      case "Intent":
        return session.intent;
      case "Taste":
        return session.taste;
      case "Constraints":
        return session.constraints;
      case "Finalists":
        return { finalists: session.finalists, discovery: session.discovery };
      case "Watch":
        return session.watch ?? { note: "No watch spec yet." };
      default:
        return session;
    }
  }, [session, tab]);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `artifact-${tab.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tabs: ArtifactsTab[] = ["Session", "Intent", "Taste", "Constraints", "Finalists", "Watch"];

  return (
    <aside className="min-w-0 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Artifacts</div>
        <button
          type="button"
          onClick={downloadJson}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs hover:bg-neutral-800"
        >
          Download JSON
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              "rounded-full border px-3 py-1 text-xs",
              t === tab
                ? "border-neutral-600 bg-neutral-950 text-neutral-100"
                : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
            ].join(" ")}
          >
            {t}
          </button>
        ))}
      </div>

      <pre className="mt-3 max-h-[70vh] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-200">
{JSON.stringify(payload, null, 2)}
      </pre>
    </aside>
  );
}