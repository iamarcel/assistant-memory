import { getDeepResearchResult } from "~/lib/cache/deep-research-cache";
import { searchMemory } from "~/lib/query/search";
import {
  querySearchRequestSchema,
  QuerySearchResponse,
  querySearchResponseSchema,
} from "~/lib/schemas/query-search";

export default defineEventHandler(async (event) => {
  // Parse the request
  const { userId, query, limit, excludeNodeTypes, conversationId } =
    querySearchRequestSchema.parse(await readBody(event));

  // Get the standard search results
  const standardResults = await searchMemory({ 
    userId, 
    query, 
    limit, 
    excludeNodeTypes 
  });

  // If no conversationId is provided, just return standard results
  if (!conversationId) {
    return querySearchResponseSchema.parse(standardResults);
  }

  // Try to get deep research results from cache
  const deepResults = await getDeepResearchResult(userId, conversationId);

  // If no deep research results, return standard results
  if (!deepResults) {
    return querySearchResponseSchema.parse(standardResults);
  }

  // Merge standard and deep research results
  // If both have content, combine them with standard results first
  const combinedResults: QuerySearchResponse = {
    query,
    formattedResult: standardResults.formattedResult
      ? standardResults.formattedResult + "\n" + deepResults.formattedResult
      : deepResults.formattedResult,
  };

  return querySearchResponseSchema.parse(combinedResults);
});
