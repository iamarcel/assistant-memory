import { z } from "zod";
import { useDatabase } from "~/utils/db";
import { typeIdSchema } from "~/types/typeid";
import {
  findSimilarNodes,
  findOneHopConnections,
  processSearchResultsWithConnections,
  formatSearchResultsAsString,
} from "~/lib/search";

// Define the request schema
const queryRequestSchema = z.object({
  userId: typeIdSchema("user"),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

export default defineEventHandler(async (event) => {
  // Parse the request
  const { userId, query, limit } = queryRequestSchema.parse(
    await readBody(event),
  );
  const db = await useDatabase();

  // Find similar nodes based on embedding similarity
  const similarNodes = await findSimilarNodes({
    userId,
    text: query,
    limit,
    embeddingTask: "retrieval.query", // Important: use query embedding, not document
  });

  // Get the IDs of the direct matches
  const directMatchIds = similarNodes.map((node) => node.id);

  // Find one-hop connections (nodes connected to the direct matches)
  const oneHopConnections = await findOneHopConnections(
    db,
    userId,
    directMatchIds,
    true // Only include nodes with labels
  );

  // Process the results
  const { directMatches, connectedNodes, allNodes } = processSearchResultsWithConnections(
    similarNodes,
    oneHopConnections
  );

  // Format the results as a nice string
  const formattedResult = formatSearchResultsAsString(query, allNodes, directMatches);

  return {
    query,
    directMatches: directMatches.length,
    connectedNodes: connectedNodes.length,
    formattedResult,
    nodes: allNodes,
  };
});
