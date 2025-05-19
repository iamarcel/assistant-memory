import { DrizzleDB } from "~/db";
import { performStructuredAnalysis } from "~/lib/ai";
import { formatSearchResultsAsXml } from "~/lib/formatting";
import { findSimilarNodes, findSimilarEdges, findOneHopNodes } from "~/lib/graph";
import { rerankMultiple } from "~/lib/rerank";
import { z } from "zod";
import { DeepResearchJobInput } from "../schemas/deep-research";
import { redisClient } from "~/utils/redis";

interface DeepResearchParams extends DeepResearchJobInput {
  db: DrizzleDB;
}

// Redis key pattern for storing deep research results
const DEEP_RESEARCH_KEY_PREFIX = "deep_research:";

/**
 * Perform deep research by generating multiple queries and searching for connections
 */
export async function performDeepResearch({
  db,
  userId,
  conversationId,
  query,
}: DeepResearchParams): Promise<{ formattedResult: string }> {
  // 1. Generate multiple related queries using LLM
  const queries = await generateRelatedQueries(userId, query);
  console.log(`Generated ${queries.length} related queries for deep research`);

  // 2. Run searches for all generated queries
  const allNodes = new Map();
  const allEdges = new Map();

  // Execute parallel searches for each query
  await Promise.all(
    queries.map(async (q) => {
      const [nodes, edges] = await Promise.all([
        findSimilarNodes({
          userId,
          text: q,
          limit: 15,
          minimumSimilarity: 0.4,
        }),
        findSimilarEdges({
          userId,
          text: q,
          limit: 15,
          minimumSimilarity: 0.4,
        }),
      ]);

      // Deduplicate results across queries
      nodes.forEach((node) => allNodes.set(node.id, node));
      edges.forEach((edge) => allEdges.set(edge.id, edge));
    })
  );

  // Convert maps to arrays
  const similarNodes = Array.from(allNodes.values());
  const similarEdges = Array.from(allEdges.values());

  // 3. Find connections between nodes
  const nodeIds = new Set([
    ...similarNodes.map((node) => node.id),
    ...similarEdges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
  ]);

  const connections = await findOneHopNodes(db, userId, Array.from(nodeIds));

  // 4. Rerank results
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
    20 // Get more results for deep research
  );

  // 5. Store result in Redis with expiration time (24 hours)
  const formattedResult = formatSearchResultsAsXml(rerankedResults);
  
  await storeDeepResearchResult({
    userId,
    conversationId,
    query,
    formattedResult
  });

  return { formattedResult };
}

/**
 * Generate related search queries using LLM
 */
async function generateRelatedQueries(
  userId: string,
  originalQuery: string
): Promise<string[]> {
  const schema = z
    .object({ queries: z.array(z.string()).min(1).max(5) })
    .describe("RelatedQueries");

  const result = await performStructuredAnalysis({
    userId,
    systemPrompt: "You are an expert at analyzing user queries and generating related search terms.",
    prompt: `<system:instruction>
Given this original query: 

<original_query>${originalQuery}</original_query>

Generate 1-5 additional search queries that would help retrieve more comprehensive information from a knowledge graph. These queries should:
1. Capture different aspects or interpretations of the original query
2. Use different but semantically related terminology
3. Focus on potential connections or related concepts
4. Be specific enough to yield relevant results

The goal is to broaden the search to find related information that might not be captured by the original query alone.
</system:instruction>`,
    schema,
  });

  return result["queries"];
}

/**
 * Store deep research result in Redis
 */
export async function storeDeepResearchResult({
  userId,
  conversationId,
  query,
  formattedResult,
}: {
  userId: string;
  conversationId: string;
  query: string;
  formattedResult: string;
}): Promise<void> {
  const key = `${DEEP_RESEARCH_KEY_PREFIX}${userId}:${conversationId}`;
  const value = JSON.stringify({
    query,
    formattedResult,
    timestamp: new Date().toISOString(),
  });

  // Store with 24-hour expiration
  await redisClient.set(key, value, 'EX', 86400); // 24 hours in seconds
}

/**
 * Retrieve deep research result from Redis
 */
export async function getDeepResearchResult(
  userId: string,
  conversationId: string
): Promise<{ formattedResult: string; query: string } | null> {
  const key = `${DEEP_RESEARCH_KEY_PREFIX}${userId}:${conversationId}`;
  const data = await redisClient.get(key);
  
  if (!data) return null;
  
  try {
    const parsedData = JSON.parse(data);
    return {
      formattedResult: parsedData.formattedResult,
      query: parsedData.query,
    };
  } catch (error) {
    console.error("Error parsing deep research data:", error);
    return null;
  }
}