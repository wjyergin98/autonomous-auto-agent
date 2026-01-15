import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/agent/model";
import { ModelResponseSchema } from "@/lib/agent/modelSchema";
import { buildPrompt } from "@/lib/agent/statePrompt";
import { nextExecState, clampFinalists, clampDiscovery } from "@/lib/agent/stateMachine";
import { makeCandidate } from "@/lib/agent/scoring";
import type { AgentApiRequest, AgentApiResponse, AgentSession } from "@/lib/agent/schema";

export async function POST(req: NextRequest) {
  const { session, userMessage }: AgentApiRequest = await req.json();

  let working: AgentSession = {
    ...session,
    last_user_message: userMessage,
  };

  // 1) Advance state deterministically (authoritative)
  working.state = nextExecState(working);

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

    // 4) Enforce caps defensively (if any candidates already exist)
    working.finalists = clampFinalists(working.finalists ?? []);
    working.discovery = clampDiscovery(working.discovery ?? []);

    // 5) Deterministic user message rendering (no model-written chat)
    const userFacingMessage = renderMessage(working, modelData);

    // 6) For states not yet model-driven in v1, keep stub outputs
    // (S3/S4/S5 can be handled by model later; currently S3/S4 are placeholders)
    if (working.state === "S3_EXPLORE" || working.state === "S4_DECIDE" || working.state === "S5_WATCH") {
      const stubbed = runStubStep(working, []);
      // But preserve any watch produced by the model in S5
      return NextResponse.json({
        userFacingMessage: userFacingMessage || stubbed.userFacingMessage,
        session: stubbed.session,
      } satisfies AgentApiResponse);
    }

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

    const tier1 = (b?.tier1?.length ? b.tier1 : session.constraints.tier1) ?? [];
    const tier2 = (b?.tier2?.length ? b.tier2 : session.constraints.tier2) ?? [];
    const rejects = (b?.hard_rejections?.length ? b.hard_rejections : session.taste.rejection_rules) ?? [];
    const compromises = b?.acceptable_compromises ?? [];

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
  if (!v.make || !v.model || !v.gen) {
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
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in model output");
  }
  return text.slice(first, last + 1);
}
