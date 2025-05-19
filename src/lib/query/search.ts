import { generateEmbeddings } from "../embeddings";
import { formatSearchResultsAsXml } from "../formatting";
import {
  findOneHopNodes,
  findSimilarEdges,
  findSimilarNodes,
} from "../graph";
import { getDeepResearchResult } from "../jobs/deep-research";
import { batchQueue } from "../queues";
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
): Promise<QuerySearchResponse> {
  const { userId, query, limit, excludeNodeTypes, conversationId } = params;
  const db = await useDatabase();

  // Regular search process
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

  // Check for any previous deep research results
  let formattedResult = formatSearchResultsAsXml(rerankedResults);
  
  if (conversationId) {
    try {
      const deepResearch = await getDeepResearchResult(userId, conversationId);
      
      if (deepResearch) {
        // Integrate deep research results directly into the main formatted results
        formattedResult = formattedResult.replace("</search_results>", 
          `<deep_research query="${deepResearch.query}">${deepResearch.formattedResult}</deep_research></search_results>`);
      }
      
      // Queue a new deep research job for the next turn
      await batchQueue.add("deep-research", {
        userId,
        conversationId,
        query,
      });
    } catch (error) {
      console.error("Error processing deep research:", error);
      // Don't fail the main search if deep research has issues
    }
  }

  return {
    query,
    formattedResult,
  };
}
