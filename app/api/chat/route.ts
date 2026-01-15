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

  // Advance state FIRST (state machine remains authoritative)
  const execState = nextExecState(working);
  working.state = execState;

  // Build prompt
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
    const userFacing =
      modelData.user_message ??
      modelData.message ??
      "Received a structured update, but no user-facing message was provided.";
    const cleaned = preventEcho(userFacing, userMessage);


    // Merge model output into session (controlled)
    working = {
      ...working,
      intent: {
        ...working.intent,
        ...modelData.intent,
      },
      constraints: {
        tier1: modelData.constraints?.tier1 ?? working.constraints.tier1,
        tier2: modelData.constraints?.tier2 ?? working.constraints.tier2,
        tier3: modelData.constraints?.tier3 ?? working.constraints.tier3,
      },
      taste: {
        ...working.taste,
        rejection_rules:
          modelData.taste?.rejection_rules ?? working.taste.rejection_rules,
      },
    };

    // Enforce caps defensively
    working.finalists = clampFinalists(working.finalists ?? []);
    working.discovery = clampDiscovery(working.discovery ?? []);

    const apiResponse: AgentApiResponse = {
      userFacingMessage: cleaned,
      session: working,
    };

    return NextResponse.json(apiResponse);
  } catch (err) {
    console.error("Model error, falling back:", err);

    return NextResponse.json(runStubStep(working,[]));
  }
}

function runStubStep(session: AgentSession, userImages: string[]): AgentApiResponse {
  const s = structuredClone(session) as AgentSession;

  const goalHint = s.goal_type;

  if (s.state === "S1_CAPTURE") {
    // Minimal prompt: reflect what we have + ask for missing critical fields (max 4)
    const questions: string[] = [];
    if (s.constraints.tier1.length < 3) questions.push("List your Tier 1 deal-breakers (3–6 items).");
    if (!s.intent.vehicle?.make) questions.push("What is the make/model/generation?");
    if (!s.intent.budget?.max) questions.push("What is your max budget (even rough)?");
    if (!s.intent.horizon) questions.push("Is this a short-term buy or long-term keep?");

    const msg =
      `S1 Capture\n\n` +
      `I’ve started a session for **${goalHint}**. To proceed to confirmation, answer:\n` +
      questions.slice(0, 4).map((q, i) => `${i + 1}. ${q}`).join("\n");

    return { userFacingMessage: msg, session: s };
  }

  if (s.state === "S2_CONFIRM") {
    // Construct boundary statement using the current constraints/taste
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
    // Placeholder candidates (until you wire real search)
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
    // Create a structured watch artifact from the constraints
    const must = s.constraints.tier1.length ? s.constraints.tier1 : ["(define must-have constraints)"];
    const acceptable = s.constraints.tier2.length ? s.constraints.tier2 : ["(define strong preferences)"];
    const reject = s.taste.rejection_rules.length ? s.taste.rejection_rules : ["(define rejections)"];

    s.watch = {
      must_have: must,
      acceptable,
      reject,
      sources: ["Bring a Trailer", "Cars & Bids", "AutoTempest", "Enthusiast forums/classifieds"],
      cadence: "twice_weekly",
      budget: s.intent.budget?.max ? { max: s.intent.budget.max, notes: s.intent.budget.notes } : undefined,
      search_strings: {
        "Bring a Trailer": ["(query placeholder)"],
        "Cars & Bids": ["(query placeholder)"],
        AutoTempest: ["(query placeholder)"],
      },
    };

    const msg =
      `S5 Watch\n\nCreated a watch spec with:\n` +
      `- Must-have: ${s.watch.must_have.join("; ")}\n` +
      `- Acceptable: ${s.watch.acceptable.join("; ")}\n` +
      `- Reject: ${s.watch.reject.join("; ")}\n` +
      `- Cadence: ${s.watch.cadence}\n\n` +
      `You can now export the Watch JSON from the Artifacts panel.`;

    return { userFacingMessage: msg, session: s };
  }

  // S7 close (or default)
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
  // Fallback: attempt to extract from response.output structure
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
  // Find the first `{` and the last `}` and parse the enclosed substring.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in model output");
  }
  return text.slice(first, last + 1);
}

function preventEcho(modelMsg: string, userMsg: string): string {
  const a = normalize(modelMsg);
  const b = normalize(userMsg);

  // Simple containment check catches the common case (full copy/paste)
  if (a.length > 0 && (a === b || a.includes(b) || b.includes(a))) {
    return "S1 Capture\n\nI extracted constraints from your message. If anything is wrong, edit it; otherwise reply “confirm” to proceed to boundary confirmation (S2).";
  }

  // Jaccard similarity on word sets (cheap and good enough)
  const sim = jaccardWords(a, b);
  if (sim > 0.85) {
    return "S1 Capture\n\nI extracted constraints from your message. If anything is wrong, edit it; otherwise reply “confirm” to proceed to boundary confirmation (S2).";
  }

  return modelMsg;
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 $.-]/g, "")
    .trim();
}

function jaccardWords(a: string, b: string) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}


