import { z } from "zod";

/**
 * Model contract (v1):
 * - The model NEVER writes the user-facing chat response directly.
 * - It returns structured outputs only.
 * - The server merges patch -> session and renders the UI message deterministically.
 */

export const PatchSchema = z
  .object({
    intent: z
      .object({
        vehicle: z
          .object({
            make: z.string().optional(),
            model: z.string().optional(),
            gen: z.string().optional(),
            trim: z.string().optional(),
            year_range: z.string().optional(),
            transmission: z.string().optional(),
            color: z.string().optional(),
          })
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
    acceptable_compromises: z.array(z.string()).default([]),
  })
  .passthrough();

export const WatchSchema = z
  .object({
    must_have: z.array(z.string()).default([]),
    acceptable: z.array(z.string()).default([]),
    reject: z.array(z.string()).default([]),
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
    cadence: z.enum(["daily", "twice_weekly", "weekly"]).optional(),
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
