import { z } from "zod";
import { MessageSchema } from "../jobs/ingest-conversation";

export const DeepResearchJobInputSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  messages: z.array(MessageSchema),
  lastNMessages: z.number().int().positive().default(3),
});

export type DeepResearchJobInput = z.infer<typeof DeepResearchJobInputSchema>;

// Since we can't define a circular type directly in Zod, we use a more generic structure
// that can represent our RerankResult<SearchGroups> type
const RerankResultItemSchema = z.object({
  group: z.string(),
  item: z.any(),
  relevance_score: z.number(),
});

export const DeepResearchResultSchema = z.object({
  conversationId: z.string(),
  userId: z.string(),
  results: z.array(RerankResultItemSchema),
  timestamp: z.date(),
  ttl: z.number().int().positive(),
});

export type DeepResearchResult = z.infer<typeof DeepResearchResultSchema>;