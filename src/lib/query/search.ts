import { generateEmbeddings } from "../embeddings";
import { findOneHopNodes, findSimilarEdges, findSimilarNodes } from "../graph";
import { rerankMultiple } from "../rerank";
import {
  QuerySearchRequest,
  QuerySearchResponse,
} from "../schemas/query-search";
import { useDatabase } from "~/utils/db";

/**
 * Search stored memories based on a query string.
 */
export async function searchMemory(
  params: QuerySearchRequest,
): Promise<Pick<QuerySearchResponse, "query" | "searchResults">> {
  const { userId, query, limit, excludeNodeTypes } = params;
  const db = await useDatabase();

  const embeddingsResponse = await generateEmbeddings({
    model: "jina-embeddings-v3",
    task: "retrieval.query",
    input: [query],
    truncate: true,
  });
  const embedding = embeddingsResponse.data[0]?.embedding;
  if (!embedding) throw new Error("Failed to generate embedding");

  const [similarNodes, similarEdges] = await Promise.all([
    findSimilarNodes({
      userId,
      embedding,
      limit,
      excludeNodeTypes,
      minimumSimilarity: 0.4,
    }),
    findSimilarEdges({
      userId,
      embedding,
      limit,
      minimumSimilarity: 0.4,
    }),
  ]);

  const nodeIds = new Set([
    ...similarNodes.map((node) => node.id),
    ...similarEdges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
  ]);

  const connections = await findOneHopNodes(db, userId, Array.from(nodeIds));

  const rerankedResults = await rerankMultiple(
    query,
    {
      similarNodes: {
        items: similarNodes,
        toDocument: (n) => `${n.label}: ${n.description}`,
      },
      similarEdges: {
        items: similarEdges,
        toDocument: (e) =>
          `${e.sourceLabel ?? ""} -> ${e.targetLabel ?? ""}: ${e.edgeType}` +
          (e.description ? `: ${e.description}` : ""),
      },
      connections: {
        items: connections,
        toDocument: (c) => `${c.label}: ${c.description}`,
      },
    },
    limit,
  );

  return {
    query,
    searchResults: rerankedResults,
  };
}
