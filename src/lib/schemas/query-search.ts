import { EdgeTypeEnum, NodeTypeEnum } from "../../types/graph.js";
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

// Define schemas for the search result types
const nodeSearchResultSchema = z.object({
  id: z.string(),
  type: NodeTypeEnum,
  timestamp: z.date(),
  label: z.string().nullable(),
  description: z.string().nullable(),
  similarity: z.number(),
});

const edgeSearchResultSchema = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  sourceLabel: z.string().nullable(),
  targetLabel: z.string().nullable(),
  edgeType: EdgeTypeEnum,
  description: z.string().nullable(),
  similarity: z.number(),
  timestamp: z.date(),
});

const oneHopNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeEnum,
  timestamp: z.date(),
  label: z.string().nullable(),
  description: z.string().nullable(),
  edgeSourceId: z.string(),
  edgeTargetId: z.string(),
  edgeType: EdgeTypeEnum,
  sourceLabel: z.string().nullable(),
  targetLabel: z.string().nullable(),
});

// Define the discriminated union for search results
const searchResultItemSchema = z.discriminatedUnion("group", [
  z.object({
    group: z.literal("similarNodes"),
    item: nodeSearchResultSchema,
    relevance_score: z.number(),
  }),
  z.object({
    group: z.literal("similarEdges"),
    item: edgeSearchResultSchema,
    relevance_score: z.number(),
  }),
  z.object({
    group: z.literal("connections"),
    item: oneHopNodeSchema,
    relevance_score: z.number(),
  }),
]);

// Define the search results array schema
export const searchResultsSchema = z.array(searchResultItemSchema);

export const querySearchResponseSchema = z.object({
  query: z.string(),
  formattedResult: z.string(),
  searchResults: searchResultsSchema,
});

export type QuerySearchRequest = z.infer<typeof querySearchRequestSchema>;
export type QuerySearchResponse = z.infer<typeof querySearchResponseSchema>;
