import { NodeTypeEnum } from "../../types/graph.js";
import { typeIdSchema } from "../../types/typeid.js";
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
  directMatches: z.number(),
  connectedNodes: z.number(),
  formattedResult: z.string(),
  nodes: z.array(
    z.object({
      id: typeIdSchema("node"),
      type: z.string(),
      label: z.string(),
      description: z.string().optional().nullable(),
      isDirectMatch: z.boolean().optional(),
      connectedTo: z.array(typeIdSchema("node")).optional(),
    }),
  ),
});

export type QuerySearchRequest = z.infer<typeof querySearchRequestSchema>;
export type QuerySearchResponse = z.infer<typeof querySearchResponseSchema>;
