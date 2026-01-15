import { z } from "zod";

// Allow either `user_message` or `message` and normalize later.
export const ModelResponseSchema = z
  .object({
    // Model should return one user-facing message field (either name)
    user_message: z.string().optional(),
    message: z.string().optional(),

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

