import { z } from "zod";

export const DeepResearchJobInputSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  query: z.string(),
});

export type DeepResearchJobInput = z.infer<typeof DeepResearchJobInputSchema>;

export interface DeepResearchResult {
  conversationId: string;
  query: string;
  formattedResult: string;
  timestamp: Date;
}