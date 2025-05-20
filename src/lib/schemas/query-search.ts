import { NodeTypeEnum } from "../../types/graph.js";
import { z } from "zod";
import type { SearchResults } from "../formatting";

// Define the request schema
export const querySearchRequestSchema = z.object({
  userId: z.string(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
  excludeNodeTypes: z
    .array(NodeTypeEnum)
    .default([NodeTypeEnum.enum.AssistantDream, NodeTypeEnum.enum.Temporal]),
  conversationId: z.string().optional(),
});

export const querySearchResponseSchema = z.object({
  query: z.string(),
  formattedResult: z.string(),
  searchResults: z.any(), // This is a placeholder for the SearchResults type that can't be directly represented in Zod
});

export type QuerySearchRequest = z.infer<typeof querySearchRequestSchema>;
export type QuerySearchResponse = z.infer<typeof querySearchResponseSchema> & {
  searchResults: SearchResults;
};
