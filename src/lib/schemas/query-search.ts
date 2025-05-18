import { NodeTypeEnum } from "../../types/graph.js";
import { z } from "zod";

// Define the request schema
export const querySearchRequestSchema = z.object({
  userId: z.string(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
  excludeNodeTypes: z
    .array(NodeTypeEnum)
    .default([NodeTypeEnum.enum.AssistantDream, NodeTypeEnum.enum.Temporal]),
});

export const querySearchResponseSchema = z.object({
  query: z.string(),
  formattedResult: z.string(),
});

export type QuerySearchRequest = z.infer<typeof querySearchRequestSchema>;
export type QuerySearchResponse = z.infer<typeof querySearchResponseSchema>;
