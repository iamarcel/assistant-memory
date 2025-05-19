import { searchMemory } from "~/lib/query/search";
import {
  querySearchRequestSchema,
  QuerySearchResponse,
  querySearchResponseSchema,
} from "~/lib/schemas/query-search";

export default defineEventHandler(async (event) => {
  // Parse the request
  const { userId, query, limit, excludeNodeTypes } =
    querySearchRequestSchema.parse(await readBody(event));
  return querySearchResponseSchema.parse(
    await searchMemory({ userId, query, limit, excludeNodeTypes }),
  );
});
