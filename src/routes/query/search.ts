import { generateEmbeddings } from "~/lib/embeddings";
import { formatSearchResultsAsXml } from "~/lib/formatting";
import {
  findOneHopNodes,
  findSimilarEdges,
  findSimilarNodes,
} from "~/lib/graph";
import { rerankMultiple } from "~/lib/rerank";
import {
  querySearchRequestSchema,
  QuerySearchResponse,
  querySearchResponseSchema,
} from "~/lib/schemas/query-search";
import { useDatabase } from "~/utils/db";

export default defineEventHandler(async (event) => {
  // Parse the request
  const { userId, query, limit, excludeNodeTypes } =
    querySearchRequestSchema.parse(await readBody(event));
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

  // Sort by similarity in descending order
  const similarities = [
    ...similarNodes.map((n) => n.similarity),
    ...similarEdges.map((e) => e.similarity),
  ].sort((a, b) => b - a);

  const minSimilarity =
    similarities.length > 0
      ? similarities[Math.min(limit - 1, similarities.length - 1)]!
      : 0;

  const nodeIds = new Set([
    ...similarNodes
      .filter((node) => node.similarity >= minSimilarity)
      .map((node) => node.id),
    ...similarEdges
      .filter((edge) => edge.similarity >= minSimilarity)
      .flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
  ]);

  const connections = await findOneHopNodes(db, userId, Array.from(nodeIds));

  // Run reranker so we know the top from the similar nodes, similar edges and connected nodes
  const rerankedResults = await rerankMultiple(
    query,
    {
      similarNodes: {
        items: similarNodes.filter((n) => n.similarity >= minSimilarity),
        toDocument: (n) => `${n.label}: ${n.description}`,
      },
      similarEdges: {
        items: similarEdges.filter((e) => e.similarity >= minSimilarity),
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

  return querySearchResponseSchema.parse({
    query,
    formattedResult: formatSearchResultsAsXml(rerankedResults),
  } satisfies QuerySearchResponse);
});
