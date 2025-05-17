import { z } from "zod";

export const cleanupRequestSchema = z.object({
  userId: z.string().startsWith("user_"), // Assuming typeIdSchema might be relevant here if user_ IDs have a prefix_ part
  since: z.coerce.date(),
  entryNodeLimit: z.number().int().positive().default(5),
  semanticNeighborLimit: z.number().int().positive().default(15),
  graphHopDepth: z.union([z.literal(1), z.literal(2)]).default(2),
  maxSubgraphNodes: z.number().int().positive().default(200),
  maxSubgraphEdges: z.number().int().positive().default(200),
});

export const cleanupResponseSchema = z.object({
  message: z.string(),
});

export type CleanupRequest = z.infer<typeof cleanupRequestSchema>;
export type CleanupResponse = z.infer<typeof cleanupResponseSchema>;
