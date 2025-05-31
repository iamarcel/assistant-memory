import { z } from "zod";

/**
 * Generic Zod schema for RerankResult items
 * Creates a schema for reranked items with group, item, and relevance score
 */
export const rerankResultItemSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    group: z.string(),
    item: itemSchema,
    relevance_score: z.number(),
  });
