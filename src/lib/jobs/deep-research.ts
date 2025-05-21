import { performStructuredAnalysis } from "../ai";
import { storeDeepResearchResult } from "../cache/deep-research-cache";
import { generateEmbeddings } from "../embeddings";
import {
  findOneHopNodes,
  findSimilarEdges,
  findSimilarNodes,
  type NodeSearchResult,
  type EdgeSearchResult,
  type OneHopNode,
} from "../graph";
import { type RerankResult } from "../rerank";
import {
  DeepResearchJobInput,
  DeepResearchResult,
} from "../schemas/deep-research";
import { z } from "zod";
import { DrizzleDB } from "~/db";
import { useDatabase } from "~/utils/db";
import { shuffleArray } from "~/utils/shuffle";

// Group definitions for reranked search results
type SearchGroups = {
  similarNodes: NodeSearchResult;
  similarEdges: EdgeSearchResult;
  connections: OneHopNode;
};

// Default TTL for deep research results (24 hours)
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Main job handler for deep research
 * @param data Job parameters including userId, conversationId, messages, and lastNMessages
 */
export async function performDeepResearch(
  data: DeepResearchJobInput,
): Promise<void> {
  const { userId, conversationId, messages, lastNMessages } = data;
  const db = await useDatabase();

  console.log(`Starting deep research for conversation ${conversationId}`);

  try {
    // Get search queries based on recent conversation turns
    // Filter to only include user and assistant messages
    const recentMessages = messages
      .slice(-lastNMessages)
      .filter((m) => m.role === "user" || m.role === "assistant");
    const queries = await generateSearchQueries(userId, recentMessages);

    if (queries.length === 0) {
      console.log("No meaningful search queries generated for deep research");
      return;
    }

    // Execute search queries and aggregate results
    const searchResults = await executeDeepSearchQueries(db, userId, queries);

    // Process results and cache them
    await cacheDeepResearchResults(userId, conversationId, searchResults);

    console.log(`Deep research completed for conversation ${conversationId}`);
  } catch (error) {
    console.error(
      `Deep research failed for conversation ${conversationId}:`,
      error,
    );
  }
}

/**
 * Generate search queries based on recent conversation messages
 */
async function generateSearchQueries(
  userId: string,
  messages: DeepResearchJobInput["messages"],
): Promise<string[]> {
  const schema = z
    .object({ queries: z.array(z.string()).min(1).max(5) })
    .describe("DeepResearchQueries");

  // Format messages for context
  const messageContext = messages
    .map((m) => `<message role="${m.role}">${m.content}</message>`)
    .join("\n");

  // Use structured analysis to generate tangential search queries
  try {
    const res = await performStructuredAnalysis({
      userId,
      systemPrompt:
        "You are an imaginative research assistant generating tangential search queries.",
      prompt: `<system:info>You are processing a conversation and want to find interesting background or related topics that are not necessarily direct continuations.</system:info>

<conversation>
${messageContext}
</conversation>

<system:instruction>
Come up with 1-5 search queries that explore adjacent or less obvious connections to the conversation. Avoid simply rephrasing what was said. Think of historical context, supporting facts or surprising angles that could provide useful background knowledge.
</system:instruction>`,
      schema,
    });

    return res["queries"];
  } catch (error) {
    console.error("Failed to generate search queries:", error);
    return [];
  }
}

/**
 * Execute multiple search queries in parallel with higher limits
 * and return combined results
 */
async function executeDeepSearchQueries(
  db: DrizzleDB,
  userId: string,
  queries: string[],
): Promise<RerankResult<SearchGroups>[]> {
  // Deep search uses higher limits than real-time search
  const deepSearchLimit = 20;

  // Run all search queries in parallel
  const searchResults = await Promise.all(
    queries.map(async (query) => {
      // Reuse same embedding generation from searchMemory function
      const embeddingsResponse = await generateEmbeddings({
        model: "jina-embeddings-v3",
        task: "retrieval.query",
        input: [query],
        truncate: true,
      });
      const embedding = embeddingsResponse.data[0]?.embedding;
      if (!embedding) return null;

      return executeSearchWithEmbedding(
        db,
        userId,
        query,
        embedding,
        deepSearchLimit,
      );
    }),
  );

  // Filter out null results
  return searchResults.filter(Boolean) as RerankResult<SearchGroups>[];
}

/**
 * Execute a single search with the provided embedding
 */
async function executeSearchWithEmbedding(
  db: DrizzleDB,
  userId: string,
  query: string,
  embedding: number[],
  limit: number,
): Promise<RerankResult<SearchGroups> | null> {
  try {
    // Find similar nodes and edges
    const [similarNodes, similarEdges] = await Promise.all([
      findSimilarNodes({
        userId,
        embedding,
        limit,
        minimumSimilarity: 0.35, // Lower threshold for deep search
      }),
      findSimilarEdges({
        userId,
        embedding,
        limit,
        minimumSimilarity: 0.35, // Lower threshold for deep search
      }),
    ]);

    // Get one-hop connections
    const nodeIds = new Set([
      ...similarNodes.map((node) => node.id),
      ...similarEdges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
    ]);

    const connections = await findOneHopNodes(db, userId, Array.from(nodeIds));

    // Build search result items without reranking
    const allResults: RerankResult<SearchGroups> = [
      ...similarNodes.map((n) => ({
        group: "similarNodes",
        item: n,
        relevance_score: n.similarity,
      })),
      ...similarEdges.map((e) => ({
        group: "similarEdges",
        item: e,
        relevance_score: e.similarity,
      })),
      ...connections.map((c) => ({
        group: "connections",
        item: c,
        relevance_score: 0,
      })),
    ];

    // Randomize before applying the limit
    const results = shuffleArray(allResults).slice(0, limit);

    return results;
  } catch (error) {
    console.error("Error in executeSearchWithEmbedding:", error);
    return null;
  }
}

/**
 * Cache the deep research results with TTL
 */
async function cacheDeepResearchResults(
  userId: string,
  conversationId: string,
  results: RerankResult<SearchGroups>[],
): Promise<void> {
  if (!results || results.length === 0) {
    console.log("No results to cache for deep research");
    return;
  }

  // Flatten results
  const validResults = results.flat();

  const ttl = DEFAULT_TTL_SECONDS;
  const now = new Date();

  const result: DeepResearchResult = {
    userId,
    conversationId,
    results: validResults,
    timestamp: now,
    ttl,
  };

  await storeDeepResearchResult(result);
}
