import { z } from "zod";

export const summarizeRequestSchema = z.object({
  userId: z.string(),
});

export const summarizeResponseSchema = z.object({
  message: z.string(),
});

export type SummarizeRequest = z.infer<typeof summarizeRequestSchema>;
export type SummarizeResponse = z.infer<typeof summarizeResponseSchema>;
