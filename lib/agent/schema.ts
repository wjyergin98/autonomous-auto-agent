export type GoalType = "vehicle_hunt" | "part_sourcing" | "styling_package";

export type AgentState =
  | "S0_INIT"
  | "S1_CAPTURE"
  | "S2_CONFIRM"
  | "S3_EXPLORE"
  | "S4_DECIDE"
  | "S5_WATCH"
  | "S6_ITERATE"
  | "S7_CLOSE";

export type Verdict = "ACCEPT" | "CONDITIONAL" | "REJECT";

export type ConstraintTier = {
  tier1: string[];
  tier2: string[];
  tier3: string[];
};

export type Taste = {
  era_correctness: "strict" | "medium" | "flexible";
  materials_allowed: string[];
  materials_excluded: string[];
  aesthetics: {
    aggression: "low" | "medium" | "high";
    branding: "subtle" | "medium" | "loud";
  };
  authenticity: {
    oem: "required" | "preferred";
    repro: "no" | "conditional";
  };
  rejection_rules: string[];
};

export type Intent = {
  goal_type: GoalType;
  vehicle?: {
    make?: string;
    model?: string;
    gen?: string;
    trim?: string;
    year_range?: string;
    body_style?: string;
    transmission?: string;
    color?: string;
  };
  goal?: {
    category?: string;
    description?: string;
  };
  usage?: {
    street_bias?: "low" | "medium" | "high";
    track_bias?: "low" | "medium" | "high";
    show_bias?: "low" | "medium" | "high";
  };
  horizon?: "short_term" | "long_term";
  budget?: {
    max?: number;
    notes?: string;
  };
};

export type Candidate = {
  id: string;
  title: string;
  url?: string;
  verdict: Verdict;
  score: number; // 0–100
  rationale: string[];
  images?: string[];
  is_placeholder?: boolean;
};

export type WatchSpec = {
  must_have: string[];
  acceptable: string[];
  reject: string[];
  sources: string[];
  geography?: {
    include?: string[];
    exclude?: string[];
    deprioritize?: string[];
  };
  budget?: { max?: number; notes?: string };
  cadence?: "daily" | "twice_weekly" | "weekly";
  search_strings?: Record<string, string[]>;
};

export type AgentSession = {
  id: string;
  state: AgentState;
  goal_type: GoalType;
  intent: Intent;
  constraints: ConstraintTier;
  taste: Taste;
  finalists: Candidate[];
  discovery: Candidate[];
  watch?: WatchSpec;
  last_user_message?: string;
  notes?: string[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[]; // base64 data URLs for v1
  timestamp: number;
};

export type AgentApiRequest = {
  session: AgentSession;
  userMessage: string;
  userImages?: string[];
};

export type AgentApiResponse = {
  userFacingMessage: string;
  session: AgentSession;
};
