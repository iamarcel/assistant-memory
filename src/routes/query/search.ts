import { getDeepResearchResult } from "~/lib/cache/deep-research-cache";
import { formatSearchResultsAsXml } from "~/lib/formatting";
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
  const { searchResults } = await searchMemory({
    userId,
    query,
    limit,
    excludeNodeTypes,
  });

  // If no conversationId is provided, just format and return standard results
  if (!conversationId) {
    return querySearchResponseSchema.parse({
      query,
      searchResults,
      formattedResult: formatSearchResultsAsXml(searchResults),
    });
  }

  // Try to get deep research results from cache
  const deepResults = await getDeepResearchResult(userId, conversationId);

  // If no deep research results, format and return standard results
  if (!deepResults) {
    return querySearchResponseSchema.parse({
      query,
      searchResults,
      formattedResult: formatSearchResultsAsXml(searchResults),
    });
  }

  // Combine standard and deep research results before formatting
  const combinedResults = [...searchResults, ...deepResults.results];

  // Format the combined results
  const formattedResult = formatSearchResultsAsXml(combinedResults);

  return querySearchResponseSchema.parse({
    query,
    searchResults: combinedResults,
    formattedResult,
  } satisfies QuerySearchResponse);
});
