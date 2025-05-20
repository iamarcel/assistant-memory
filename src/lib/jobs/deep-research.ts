import { addHours, formatISO } from "date-fns";
import { storeDeepResearchResult } from "../cache/deep-research-cache";
import { generateEmbeddings } from "../embeddings";
import { formatSearchResultsAsXml } from "../formatting";
import {
  findOneHopNodes,
  findSimilarEdges,
  findSimilarNodes,
  type NodeSearchResult,
} from "../graph";
import { performStructuredAnalysis } from "../ai";
import { rerankMultiple } from "../rerank";
import { DeepResearchJobInput, DeepResearchResult } from "../schemas/deep-research";
import { z } from "zod";
import { DrizzleDB } from "~/db";
import { useDatabase } from "~/utils/db";
import { env } from "~/utils/env";

// Default TTL for deep research results (24 hours)
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Main job handler for deep research
 * @param data Job parameters including userId, conversationId, messages, and lastNMessages
 */
export async function performDeepResearch(
  data: DeepResearchJobInput
): Promise<void> {
  const { userId, conversationId, messages, lastNMessages } = data;
  const db = await useDatabase();

  console.log(`Starting deep research for conversation ${conversationId}`);

  try {
    // Get search queries based on recent conversation turns
    // Filter to only include user and assistant messages
    const recentMessages = messages
      .slice(-lastNMessages)
      .filter(m => m.role === 'user' || m.role === 'assistant');
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
    console.error(`Deep research failed for conversation ${conversationId}:`, error);
  }
}

/**
 * Generate search queries based on recent conversation messages
 */
async function generateSearchQueries(
  userId: string,
  messages: DeepResearchJobInput["messages"]
): Promise<string[]> {
  const schema = z
    .object({ queries: z.array(z.string()).min(1).max(5) })
    .describe("DeepResearchQueries");

  // Format messages for context
  const messageContext = messages
    .map((m) => `<message role="${m.role}">${m.content}</message>`)
    .join("\n");

  // Use structured analysis to generate meaningful search queries
  try {
    const res = await performStructuredAnalysis({
      userId,
      systemPrompt: "You are a helpful research assistant tasked with generating search queries based on a conversation.",
      prompt: `<system:info>You are processing a conversation to identify important topics or questions that should be researched in depth.</system:info>

<conversation>
${messageContext}
</conversation>

<system:instruction>
Based on the conversation above, generate 1-5 search queries that would be useful for retrieving relevant information from a knowledge base. Focus on the most important topics, questions, or information needs expressed in the conversation.

Make the queries diverse and specific enough to retrieve focused results, but general enough to capture relevant information.
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
  queries: string[]
): Promise<string> {
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
      
      return executeSearchWithEmbedding(db, userId, query, embedding, deepSearchLimit);
    })
  );
  
  // Combine all search results
  const combinedResult = searchResults
    .filter(Boolean)
    .join("\n");
    
  return combinedResult || "";
}



/**
 * Execute a single search with the provided embedding
 */
async function executeSearchWithEmbedding(
  db: DrizzleDB,
  userId: string,
  query: string,
  embedding: number[],
  limit: number
): Promise<string | null> {
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

    // Rerank results
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

    return formatSearchResultsAsXml(rerankedResults);
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
  formattedResult: string
): Promise<void> {
  if (!formattedResult) {
    console.log("No results to cache for deep research");
    return;
  }

  const ttl = DEFAULT_TTL_SECONDS;
  const now = new Date();
  
  const result: DeepResearchResult = {
    userId,
    conversationId,
    formattedResult,
    timestamp: now,
    ttl,
  };
  
  await storeDeepResearchResult(result);
}