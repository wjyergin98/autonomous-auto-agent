import { NextRequest, NextResponse } from "next/server";
import { AgentApiRequest, AgentApiResponse, AgentSession } from "@/lib/agent/schema";
import { nextExecState, clampDiscovery, clampFinalists } from "@/lib/agent/stateMachine";
import { makeCandidate } from "@/lib/agent/scoring";

export async function POST(req: NextRequest) {
  let payload: AgentApiRequest;
  try {
    payload = (await req.json()) as AgentApiRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { session, userMessage, userImages } = payload;
  const working: AgentSession = {
    ...session,
    last_user_message: userMessage,
    notes: [...(session.notes ?? []), `UserMsg: ${userMessage}`],
  };

  const execState = nextExecState(working);
  working.state = execState;

  // v1 stub behavior: generate deterministic, bounded outputs per state.
  const response: AgentApiResponse = runStubStep(working, userImages ?? []);

  // Enforce caps regardless of stub/model
  response.session.finalists = clampFinalists(response.session.finalists ?? []);
  response.session.discovery = clampDiscovery(response.session.discovery ?? []);

  return NextResponse.json(response);
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
