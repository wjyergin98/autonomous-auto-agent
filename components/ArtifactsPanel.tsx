"use client";

import { useMemo, useState } from "react";
import type { AgentSession } from "@/lib/agent/schema";

type Tab = "Session" | "Intent" | "Taste" | "Constraints" | "Finalists" | "Watch";

export default function ArtifactsPanel({ session }: { session: AgentSession }) {
  const [tab, setTab] = useState<Tab>("Session");

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

  const tabs: Tab[] = ["Session", "Intent", "Taste", "Constraints", "Finalists", "Watch"];

  return (
    <aside className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
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

      <pre className="mt-3 max-h-[70vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-200">
{JSON.stringify(payload, null, 2)}
      </pre>
    </aside>
  );
}
