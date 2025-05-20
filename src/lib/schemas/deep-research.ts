import { z } from "zod";
import { MessageSchema } from "../jobs/ingest-conversation";

export const DeepResearchJobInputSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  messages: z.array(MessageSchema),
  lastNMessages: z.number().int().positive().default(3),
});

export type DeepResearchJobInput = z.infer<typeof DeepResearchJobInputSchema>;

// Since we can't define a circular type directly in Zod, we use a more specific structure
// that represents our RerankResult item structure
const ItemSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  timestamp: z.date().or(z.string()).optional(),
  sourceNodeId: z.string().optional(),
  targetNodeId: z.string().optional(),
  sourceLabel: z.string().nullable().optional(),
  targetLabel: z.string().nullable().optional(),
  edgeType: z.string().optional(),
}).passthrough(); // Allow additional properties for flexibility

const RerankResultItemSchema = z.object({
  group: z.string(),
  item: ItemSchema,
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