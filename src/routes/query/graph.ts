import { defineEventHandler } from "h3";
import { queryKnowledgeGraph } from "~/lib/query/graph";
import {
  queryGraphRequestSchema,
  queryGraphResponseSchema,
} from "~/lib/schemas/query-graph";

export default defineEventHandler(async (event) => {
  const params = queryGraphRequestSchema.parse(await readBody(event));
  const result = await queryKnowledgeGraph(params);
  return queryGraphResponseSchema.parse(result);
});
