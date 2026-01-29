import { z } from "zod";

/**
 * Model contract (v1):
 * - The model NEVER writes the user-facing chat response directly.
 * - It returns structured outputs only.
 * - The server merges patch -> session and renders the UI message deterministically.
 */

const toStringArray = (val: unknown): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);

  if (typeof val === "object") {
    // Convert object to "key: value" strings
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .filter(Boolean);
  }

  return [String(val)].filter(Boolean);
};

const normalizeCadence = (val: unknown): "daily" | "twice_weekly" | "weekly" | undefined => {
  if (!val) return undefined;
  const s = String(val).toLowerCase().trim();
  if (s === "daily") return "daily";
  if (s === "weekly") return "weekly";
  if (s === "twice_weekly" || s === "twice weekly" || s === "2x weekly") return "twice_weekly";
  if (s === "regular") return "twice_weekly";
  return undefined;
};

const normalizeVehiclePatch = (val: unknown) => {
  if (!val || typeof val !== "object") return val;
  const v = { ...(val as Record<string, unknown>) };

  // Alias keys the model sometimes emits
  if (v.gen == null && typeof v.generation === "string") v.gen = v.generation;
  if (v.color == null && typeof v.exterior_color === "string") v.color = v.exterior_color;

  // Coerce year_range to string if array provided
  if (Array.isArray(v.year_range) && v.year_range.length === 2) {
    const a = Number(v.year_range[0]);
    const b = Number(v.year_range[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      v.year_range = `${a}-${b}`;
    }
  }

  return v;
};

export const PatchSchema = z
  .object({
    intent: z
      .object({
        vehicle: z
            .preprocess(
                normalizeVehiclePatch,
                z.object({
                make: z.string().optional(),
                model: z.string().optional(),
                gen: z.string().optional(),
                trim: z.string().optional(),
                year_range: z.union([
                    z.string(),
                    z.tuple([z.number(), z.number()]).transform(([a, b]) => `${a}-${b}`),
                    z.object({ min: z.number(), max: z.number() }).transform(({ min, max }) => `${min}-${max}`),
                ]).optional(),
                transmission: z.string().optional(),
                color: z.string().optional(),

                // Optional: allow engine without losing it (won’t break anything)
                engine: z.string().optional(),
                })
            )
            .optional(),
        budget: z
          .object({
            max: z.number().optional(),
            notes: z.string().optional(),
          })
          .optional(),
      })
      .optional(),

    constraints: z
      .object({
        tier1: z.array(z.string()).optional(),
        tier2: z.array(z.string()).optional(),
        tier3: z.array(z.string()).optional(),
      })
      .optional(),

    taste: z
      .object({
        rejection_rules: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

export const BoundarySchema = z
  .object({
    tier1: z.array(z.string()).default([]),
    tier2: z.array(z.string()).default([]),
    hard_rejections: z.array(z.string()).default([]),
    acceptable_compromises: z.preprocess(toStringArray, z.array(z.string())).default([]),
  })
  .passthrough();

export const WatchSchema = z
  .object({
    must_have: z.preprocess(toStringArray, z.array(z.string())).default([]),
    acceptable: z.preprocess(toStringArray, z.array(z.string())).default([]),
    reject: z.preprocess(toStringArray, z.array(z.string())).default([]),
    sources: z.array(z.string()).default([]),
    geography: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        deprioritize: z.array(z.string()).optional(),
      })
      .optional(),
    budget: z
      .object({
        max: z.number().optional(),
        notes: z.string().optional(),
      })
      .optional(),
    cadence: z.preprocess(normalizeCadence, z.enum(["daily", "twice_weekly", "weekly"]).optional()),
    search_strings: z.record(z.string(), z.array(z.string())).optional(),
  })
  .passthrough();

export const ModelResponseSchema = z
  .object({
    // Always optional; model returns only what is relevant for the current state.
    patch: PatchSchema.optional(),

    // S1: clarifying questions (max 4)
    questions: z.array(z.string()).max(4).optional(),

    // S2: boundary object
    boundary: BoundarySchema.optional(),

    // S5: watch object
    watch: WatchSchema.optional(),
  })
  .passthrough();

export type ModelResponse = z.infer<typeof ModelResponseSchema>;
