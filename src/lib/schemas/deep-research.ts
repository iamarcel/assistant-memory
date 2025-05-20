import { z } from "zod";
import { MessageSchema } from "../jobs/ingest-conversation";

export const DeepResearchJobInputSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  messages: z.array(MessageSchema),
  lastNMessages: z.number().int().positive().default(3),
});

export type DeepResearchJobInput = z.infer<typeof DeepResearchJobInputSchema>;

export const DeepResearchResultSchema = z.object({
  conversationId: z.string(),
  userId: z.string(),
  formattedResult: z.string(),
  timestamp: z.date(),
  ttl: z.number().int().positive(),
});

export type DeepResearchResult = z.infer<typeof DeepResearchResultSchema>;