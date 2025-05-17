import {
  findSimilarNodes,
  findOneHopConnections,
  processSearchResultsWithConnections,
  formatAsMarkdown,
} from "~/lib/graph";
import { useDatabase } from "~/utils/db";
import {
  querySearchRequestSchema,
  querySearchResponseSchema,
} from "~/lib/schemas/query-search";

export default defineEventHandler(async (event) => {
  // Parse the request
  const { userId, query, limit } = querySearchRequestSchema.parse(
    await readBody(event),
  );
  const db = await useDatabase();

  // Find similar nodes based on embedding similarity
  const similarNodes = await findSimilarNodes({
    userId,
    text: query,
    limit,
  });

  // Get the IDs of the direct matches
  const directMatchIds = similarNodes.map((node) => node.id);

  // Find one-hop connections (nodes connected to the direct matches)
  const oneHopConnections = await findOneHopConnections(
    db,
    userId,
    directMatchIds,
    true, // Only include nodes with labels
  );

  // Process the results
  const { directMatches, connectedNodes, allNodes } =
    processSearchResultsWithConnections(similarNodes, oneHopConnections);

  // Format the results as a nice string
  const formattedResult = formatAsMarkdown(
    query,
    allNodes,
    directMatches,
  );

  return querySearchResponseSchema.parse({
    query,
    directMatches: directMatches.length,
    connectedNodes: connectedNodes.length,
    formattedResult,
    nodes: allNodes,
  });
});
