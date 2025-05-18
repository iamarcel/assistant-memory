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

  const nodeIds = new Set([
    ...similarNodes.map((node) => node.id),
    ...similarEdges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
  ]);

  const connections = await findOneHopNodes(db, userId, Array.from(nodeIds));

  // Run reranker so we know the top from the similar nodes, similar edges and connected nodes
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

  return querySearchResponseSchema.parse({
    query,
    formattedResult: formatSearchResultsAsXml(rerankedResults),
  } satisfies QuerySearchResponse);
});
