"use client";

import { useMemo, useState } from "react";
import type { AgentApiResponse, AgentSession, ChatMessage } from "@/lib/agent/schema";
import StateBadge from "@/components/StateBadge";
import ArtifactsPanel from "@/components/ArtifactsPanel";
import ImageDropzone from "@/components/ImageDropzone";

function newSession(): AgentSession {
  return {
    id: cryptoRandomId(),
    state: "S0_INIT",
    goal_type: "vehicle_hunt",
    intent: {
      goal_type: "vehicle_hunt",
      vehicle: {},
      goal: {},
      usage: { street_bias: "high", track_bias: "low", show_bias: "low" },
      horizon: "long_term",
      budget: {},
    },
    constraints: { tier1: [], tier2: [], tier3: [] },
    taste: {
      era_correctness: "medium",
      materials_allowed: [],
      materials_excluded: [],
      aesthetics: { aggression: "medium", branding: "subtle" },
      authenticity: { oem: "preferred", repro: "conditional" },
      rejection_rules: [],
    },
    finalists: [],
    discovery: [],
    notes: [],
  };
}

export default function Chat() {
  const [session, setSession] = useState<AgentSession>(() => newSession());
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: cryptoRandomId(),
      role: "assistant",
      content:
        "Initialized v1. Paste a test case (e.g., your Boxster hunt or E92 interior swap). You can optionally upload images.",
      timestamp: Date.now(),
    },
  ]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const state = session.state;

  const transcript = useMemo(() => messages, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: cryptoRandomId(),
      role: "user",
      content: text,
      images: images.length ? images : undefined,
      timestamp: Date.now(),
    };

    setMessages((m) => [...m, userMsg]);
    setDraft("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          userMessage: text,
          userImages: images,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "API error");
      }

      const data = (await res.json()) as AgentApiResponse;

      setSession(data.session);

      setMessages((m) => [
        ...m,
        {
          id: cryptoRandomId(),
          role: "assistant",
          content: data.userFacingMessage,
          timestamp: Date.now(),
        },
      ]);

      // For v1-lite: clear images after sending (keeps interaction clean)
      setImages([]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          id: cryptoRandomId(),
          role: "assistant",
          content: `Error: ${e?.message ?? "Unknown error"}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setSession(newSession());
    setMessages([
      {
        id: cryptoRandomId(),
        role: "assistant",
        content: "Reset session. Paste a test case to begin.",
        timestamp: Date.now(),
      },
    ]);
    setDraft("");
    setImages([]);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-800 p-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold">Chat</div>
            <StateBadge state={state} />
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs hover:bg-neutral-800"
          >
            Reset
          </button>
        </div>

        <div className="max-h-[60vh] overflow-auto p-4">
          <div className="space-y-4">
            {transcript.map((m) => (
              <div
                key={m.id}
                className={[
                  "rounded-xl border p-3",
                  m.role === "user"
                    ? "border-neutral-700 bg-neutral-950"
                    : "border-neutral-800 bg-neutral-900",
                ].join(" ")}
              >
                <div className="mb-1 text-xs text-neutral-400">
                  {m.role === "user" ? "You" : "Agent"}
                </div>
                <div className="whitespace-pre-wrap text-sm text-neutral-100">{m.content}</div>
                {m.images?.length ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {m.images.map((src, idx) => (
                      <div key={idx} className="overflow-hidden rounded-lg border border-neutral-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`msgimg-${idx}`} className="h-24 w-full object-cover" />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-neutral-800 p-4">
          <ImageDropzone images={images} setImages={setImages} />

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <textarea
              className="h-28 w-full resize-none bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
              placeholder="Paste a test case, or respond to the agent’s questions…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="text-xs text-neutral-500">
                v1 stub: Explore uses placeholders until live search/model is wired.
              </div>
              <button
                type="button"
                onClick={send}
                disabled={loading}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs hover:bg-neutral-800 disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <ArtifactsPanel session={session} />
    </div>
  );
}

function cryptoRandomId() {
  return Math.random().toString(16).slice(2) + "-" + Math.random().toString(16).slice(2);
}
