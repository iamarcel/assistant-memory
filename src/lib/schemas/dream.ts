import { z } from "zod";

export const dreamRequestSchema = z.object({
  userId: z.string().startsWith("user_"), // Consider typeIdSchema if applicable
  assistantId: z.string(), // Consider typeIdSchema if applicable
  assistantDescription: z.string(),
});

export const dreamResponseSchema = z.object({
  message: z.string(),
});

export type DreamRequest = z.infer<typeof dreamRequestSchema>;
export type DreamResponse = z.infer<typeof dreamResponseSchema>;
