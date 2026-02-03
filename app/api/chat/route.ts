import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/agent/model";
import { ModelResponseSchema } from "@/lib/agent/modelSchema";
import { buildPrompt } from "@/lib/agent/statePrompt";
import { nextExecState, clampFinalists, clampDiscovery } from "@/lib/agent/stateMachine";
import { makeCandidate } from "@/lib/agent/scoring";
import type { AgentApiRequest, AgentApiResponse, AgentSession } from "@/lib/agent/schema";
import { normalizeSession, computeCanonicalBoundary } from "@/lib/agent/normalize";
import { runLiveExplore } from "@/lib/market/liveExplore";
import type { AgentState } from "@/lib/agent/schema";
import { decide } from "@/lib/market/decide";
import { ensureWatch } from "@/lib/market/watch";
const featureFlags = { liveExplore: true };

export async function POST(req: NextRequest) {
  const { session, userMessage }: AgentApiRequest = await req.json();

  let working: AgentSession = {
    ...session,
    last_user_message: userMessage,
  };

  // 0) Deterministic command routing (user control inputs)
  const cmd = parseUserCommand(userMessage, session.state);

  // If a command applies, override state directly.
  if (cmd) {
    working.state = cmd;
  } else {
  // 1) Otherwise advance state deterministically (authoritative)
    working.state = nextExecState(working);
  }

  // 2) Ask model for structured outputs ONLY
  const prompt = buildPrompt(working, userMessage);

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const raw = getOutputText(response);
    const jsonText = extractJsonObject(raw);
    const parsed = ModelResponseSchema.safeParse(JSON.parse(jsonText));

    if (!parsed.success) {
      console.error("Raw model output:", raw);
      console.error("Zod issues:", parsed.error.issues);
      throw new Error("Model JSON did not match schema");
    }

    const modelData = parsed.data;

    // 3) Merge patch into session (controlled, deterministic)
    if (modelData.patch) {
      working = mergePatch(working, modelData.patch);
    }
    if (modelData.watch) {
      (working as any).watch = modelData.watch;
    }
    working = normalizeSession(working);

    // ---- S5 Watch (explicit user intent) ----
    if (
      (working.state === "S4_DECIDE" || working.state === "S5_WATCH") &&
      typeof userMessage === "string" &&
      userMessage.toLowerCase().includes("watch")
    ) {
      const { watch, created } = ensureWatch(working);

      working.watch = watch;
      working.state = "S5_WATCH";

      const msg =
        `S5 Watch\n\n` +
        (created
          ? `This search is now being monitored.\n`
          : `This search was already being monitored.\n`) +
        `\nI’ll notify you when a listing appears that meets all Tier 1 constraints.`;

      return NextResponse.json({
        userFacingMessage: msg,
        session: working,
      });
    }

    // ---- Live Explore (S3) ----
    if (working.state === "S3_EXPLORE" && featureFlags.liveExplore) {
      let explored: AgentSession = working;
      let meta: { fetched: number; used: number } | null = null;

      try {
        const exploreResult = await runLiveExplore(working);
        explored = { ...working, ...exploreResult.session };
        meta = exploreResult.meta;
      } catch (e) {
        console.error("Live Explore failed; falling back to placeholder:", e);
      }

      explored.state = "S4_DECIDE";

      // ---- S3 Explore message ----
      const exploreMsg =
        `S3 Explore (live)\n\n` +
        `Fetched ${meta?.used ?? "?"} listings (provider: Auto.dev). Showing bounded finalists/discovery.\n\n` +
        `Finalists (≤5):\n` +
        (explored.finalists?.length
          ? explored.finalists
            .map((c, i) => {
              const title = c.url ? `[${c.title}](${c.url})` : c.title;
              return `${i + 1}. [${c.verdict}] ${title} (score ${c.score})`;
            })
            .join("\n")
          : "— none met Tier 1 gates —") +
        `\n\nDiscovery (≤3):\n` +
        (explored.discovery?.length
          ? explored.discovery
            .map((c, i) => {
              const title = c.url ? `[${c.title}](${c.url})` : c.title;
              return `${i + 1}. [${c.verdict}] ${title} (score ${c.score})`;
            })
            .join("\n")
          : "— none —");

      // ---- S4 Decide ----
      const { decision, message: decideMsg } = decide(explored);
      explored.decision = decision;

      return NextResponse.json({
        userFacingMessage: `${exploreMsg}\n\n${decideMsg}`,
        session: explored,
      });
    }

    // 4) Enforce caps defensively (if any candidates already exist)
    working.finalists = clampFinalists(working.finalists ?? []);
    working.discovery = clampDiscovery(working.discovery ?? []);

    // 5) Deterministic user message rendering (no model-written chat)
    const userFacingMessage = renderMessage(working, modelData);

    // 6) For states not yet model-driven in v1, keep stub outputs
    // (S3/S4/S5 can be handled by model later; currently S3/S4 are placeholders)
    //if (working.state === "S3_EXPLORE" || working.state === "S4_DECIDE" || working.state === "S5_WATCH") {
    //  const stubbed = runStubStep(working, []);
    //  // But preserve any watch produced by the model in S5
    //  if ((working as any).watch) {
    //    (stubbed.session as any).watch = (working as any).watch;
    //  }
    //  return NextResponse.json({
    //    userFacingMessage: userFacingMessage || stubbed.userFacingMessage,
    //    session: stubbed.session,
    //  } satisfies AgentApiResponse);
    //}

    return NextResponse.json({
      userFacingMessage,
      session: working,
    } satisfies AgentApiResponse);
  } catch (err) {
    console.error("Model error, falling back:", err);
    return NextResponse.json(runStubStep(working, []));
  }
}

function mergePatch(session: AgentSession, patch: any): AgentSession {
  const s = structuredClone(session) as AgentSession;

  if (patch.intent) {
    s.intent = {
      ...s.intent,
      ...patch.intent,
      vehicle: {
        ...(s.intent.vehicle ?? {}),
        ...(patch.intent.vehicle ?? {}),
      },
      budget: {
        ...(s.intent.budget ?? {}),
        ...(patch.intent.budget ?? {}),
      },
    } as any;
  }

  if (patch.constraints) {
    s.constraints = {
      tier1: patch.constraints.tier1 ?? s.constraints.tier1,
      tier2: patch.constraints.tier2 ?? s.constraints.tier2,
      tier3: patch.constraints.tier3 ?? s.constraints.tier3,
    };
  }

  if (patch.taste) {
    s.taste = {
      ...s.taste,
      rejection_rules: patch.taste.rejection_rules ?? s.taste.rejection_rules,
    } as any;
  }

  return s;
}

function renderMessage(session: AgentSession, modelData: any): string {
  const state = session.state;

  if (state === "S1_CAPTURE") {
    const missing = computeMissingForS1(session);
    if (missing.length === 0) {
      return (
        "S1 Capture\n\n" +
        "I extracted your constraints and vehicle intent. If anything in the Artifacts panel is wrong, correct it in chat. " +
        "Otherwise reply **confirm** to proceed to boundary confirmation (S2)."
      );
    }

    const questions: string[] = Array.isArray(modelData?.questions) ? modelData.questions : [];
    const q = questions.length ? questions : missing.map((m) => m.question).slice(0, 4);

    return (
      "S1 Capture\n\n" +
      "I extracted what I could. To proceed, answer:\n" +
      q.slice(0, 4).map((x, i) => `${i + 1}. ${x}`).join("\n")
    );
  }

  if (state === "S2_CONFIRM") {
    const b = modelData?.boundary;

    const canonical = computeCanonicalBoundary(session);

    const tier1 = canonical.tier1;
    const tier2 = canonical.tier2;
    const rejects = canonical.hard_rejections;

    // Keep model’s acceptable_compromises if it provided any, but treat as advisory only.
    const compromises =
      (Array.isArray(b?.acceptable_compromises) ? b.acceptable_compromises : []) ?? [];

    return (
      "S2 Confirm\n\n" +
      "**Boundary (what qualifies):**\n" +
      `- Tier 1 (non-negotiable): ${tier1.length ? tier1.join("; ") : "(none captured yet)"}\n` +
      `- Tier 2 (strong preferences): ${tier2.length ? tier2.join("; ") : "(none captured yet)"}\n\n` +
      `**Hard rejections:** ${rejects.length ? rejects.join("; ") : "(none captured yet)"}\n\n` +
      `**Acceptable compromises:** ${compromises.length ? compromises.join("; ") : "(none proposed)"}\n\n` +
      "Reply **confirm** to proceed to Explore (S3), or edit any rule."
    );
  }

  // For other states, we allow stub to handle messaging.
  return "";
}

function computeMissingForS1(session: AgentSession): Array<{ key: string; question: string }> {
  const missing: Array<{ key: string; question: string }> = [];

  const tier1Count = session.constraints.tier1?.length ?? 0;
  if (tier1Count < 3) {
    missing.push({ key: "tier1", question: "List your Tier 1 deal-breakers (3–6 items)." });
  }

  const v = session.intent.vehicle ?? {};
  const hasVehicleCore = (v.model && v.gen) || (v.make && v.model);
  if (!hasVehicleCore) {
    missing.push({ key: "vehicle", question: "Confirm make/model/generation (e.g., Porsche Boxster 986.2)." });
  }

  const budgetMax = (session.intent as any)?.budget?.max;
  if (!budgetMax) {
    missing.push({ key: "budget", question: "What is your max budget (rough is fine)?" });
  }

  return missing;
}

function runStubStep(session: AgentSession, userImages: string[]): AgentApiResponse {
  const s = structuredClone(session) as AgentSession;

  const goalHint = s.goal_type;

  if (s.state === "S1_CAPTURE") {
    const questions: string[] = [];
    if (s.constraints.tier1.length < 3) questions.push("List your Tier 1 deal-breakers (3–6 items).");
    if (!s.intent.vehicle?.make) questions.push("What is the make/model/generation?");
    if (!(s.intent as any)?.budget?.max) questions.push("What is your max budget (even rough)?");
    if (!s.intent.horizon) questions.push("Is this a short-term buy or long-term keep?");

    const msg =
      `S1 Capture\n\n` +
      `I’ve started a session for **${goalHint}**. To proceed to confirmation, answer:\n` +
      questions.slice(0, 4).map((q, i) => `${i + 1}. ${q}`).join("\n");

    return { userFacingMessage: msg, session: s };
  }

  if (s.state === "S2_CONFIRM") {
    const tier1 = s.constraints.tier1.length ? s.constraints.tier1 : ["(add Tier 1 constraints)"];
    const tier2 = s.constraints.tier2.length ? s.constraints.tier2 : ["(add Tier 2 constraints)"];
    const rejects = s.taste.rejection_rules.length ? s.taste.rejection_rules : ["(add rejection rules)"];

    const msg =
      `S2 Confirm\n\n` +
      `**Boundary (what counts as correct):**\n` +
      `- Tier 1 (non-negotiable): ${tier1.join("; ")}\n` +
      `- Tier 2 (strong prefs): ${tier2.join("; ")}\n\n` +
      `**Hard rejections:** ${rejects.join("; ")}\n\n` +
      `Reply “confirm” to proceed to market explore, or edit any rule.`;

    return { userFacingMessage: msg, session: s };
  }

  if (s.state === "S3_EXPLORE") {
    const finalists = [
      makeCandidate({
        title: "Placeholder Candidate A (mechanically strong, spec-aligned)",
        verdict: "ACCEPT",
        score: 90,
        rationale: [
          "Meets Tier 1 constraints (placeholder assumption)",
          "Strong maintenance narrative (placeholder)",
          "Best expected decision-quality trade-off",
        ],
        is_placeholder: true,
      }),
      makeCandidate({
        title: "Placeholder Candidate B (spec-aligned, missing key proof)",
        verdict: "CONDITIONAL",
        score: 76,
        rationale: ["Meets Tier 1 (placeholder)", "Missing documentation or verification item"],
        is_placeholder: true,
      }),
      makeCandidate({
        title: "Placeholder Candidate C (tempting but rejected)",
        verdict: "REJECT",
        score: 40,
        rationale: ["Violates a hard rejection rule (placeholder)"],
        is_placeholder: true,
      }),
    ];

    const discovery = [
      makeCandidate({
        title: "Discovery Option 1 (adjacent, taste-coherent)",
        verdict: "CONDITIONAL",
        score: 65,
        rationale: ["Shown because it improves availability while preserving taste boundaries"],
        is_placeholder: true,
      }),
    ];

    s.finalists = finalists;
    s.discovery = discovery;

    const msg =
      `S3 Explore\n\n` +
      `I’m returning **placeholder finalists** (no live search wired yet). In v1, these validate filtering + ranking + artifact outputs.\n\n` +
      `Finalists (≤5):\n` +
      s.finalists.map((c, i) => `${i + 1}. [${c.verdict}] ${c.title} (score ${c.score})`).join("\n") +
      `\n\nDiscovery (≤3):\n` +
      s.discovery.map((c, i) => `${i + 1}. [${c.verdict}] ${c.title}`).join("\n") +
      `\n\nNext: Decide (buy now vs watch vs revise).`;

    return { userFacingMessage: msg, session: s };
  }

  if (s.state === "S4_DECIDE") {
    const hasAccept = s.finalists.some((c) => c.verdict === "ACCEPT");
    const msg = hasAccept
      ? `S4 Decide\n\nPrimary recommendation: **ACT NOW** on the top ACCEPTED finalist.\n\nNext actions:\n- Verify title/history\n- Confirm critical proof items (service records / fitment / condition)\n- Do PPI or equivalent verification\n\nIf you prefer to wait, say “watch” and I will generate a watch spec.`
      : `S4 Decide\n\nNo ACCEPTED finalists.\n\nRecommendation: **WAIT + WATCH** with explicit triggers.\nSay “watch” and I will generate a watch spec.`;

    return { userFacingMessage: msg, session: s };
  }

  if (s.state === "S5_WATCH") {
    const must = s.constraints.tier1.length ? s.constraints.tier1 : ["(define must-have constraints)"];
    const acceptable = s.constraints.tier2.length ? s.constraints.tier2 : ["(define strong preferences)"];
    const reject = s.taste.rejection_rules.length ? s.taste.rejection_rules : ["(define rejections)"];

    s.watch = {
      must_have: must,
      acceptable,
      reject,
      sources: ["Bring a Trailer", "Cars & Bids", "AutoTempest", "Enthusiast forums/classifieds"],
      cadence: "twice_weekly",
      budget: (s.intent as any)?.budget?.max ? { max: (s.intent as any).budget.max, notes: (s.intent as any).budget.notes } : undefined,
      search_strings: {
        "Bring a Trailer": ["(query placeholder)"],
        "Cars & Bids": ["(query placeholder)"],
        AutoTempest: ["(query placeholder)"],
      },
    } as any;

    const msg =
      `S5 Watch\n\nCreated a watch spec. You can export the Watch JSON from the Artifacts panel.`;

    return { userFacingMessage: msg, session: s };
  }

  s.state = "S7_CLOSE";
  const msg =
    `S7 Close\n\nSession closed.\n` +
    `- State snapshot saved in artifacts\n` +
    (userImages.length ? `- ${userImages.length} user image(s) attached (v1-lite)\n` : "");

  return { userFacingMessage: msg, session: s };
}

function getOutputText(response: any): string {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const out = response?.output;
  if (Array.isArray(out)) {
    const chunks: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") chunks.push(c.text);
        }
      }
    }
    const joined = chunks.join("").trim();
    if (joined) return joined;
  }
  throw new Error("No output text found in response");
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in model output");

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    } else {
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  throw new Error("Unterminated JSON object in model output");
}

function parseUserCommand(userMessage: string, priorState: AgentState): AgentState | null {
  const t = userMessage.trim().toLowerCase();

  // Confirm in S2 proceeds to explore
  if (priorState === "S2_CONFIRM" && /^confirm\b/.test(t)) return "S3_EXPLORE";

  // Allow watch directly from explore
  if (priorState === "S3_EXPLORE" && /^watch\b/.test(t)) return "S5_WATCH";

  // After explore, any reply can proceed to decide (optional: require "decide")
  if (priorState === "S3_EXPLORE" && (/^act\b/.test(t) || /^decide\b/.test(t) || /^confirm\b/.test(t))) {
    return "S4_DECIDE";
  }

  // Explicit watch request from decide
  if (priorState === "S4_DECIDE" && /^watch\b/.test(t)) return "S5_WATCH";

  // Optional: allow revise to jump back to S1
  if ((priorState === "S2_CONFIRM" || priorState === "S4_DECIDE") && /^revise\b/.test(t)) return "S1_CAPTURE";

  return null;
}