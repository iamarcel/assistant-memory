import { redisConnection } from "../queues";
import {
  DeepResearchResult,
  DeepResearchResultSchema,
} from "../schemas/deep-research";

// Redis client from shared connection
const redisClient = redisConnection;

/**
 * Prefix for deep research cache keys to avoid collisions
 */
const DEEP_RESEARCH_PREFIX = "deep-research:";

/**
 * Build a consistent Redis key for deep research results
 */
function buildDeepResearchKey(userId: string, conversationId: string): string {
  return `${DEEP_RESEARCH_PREFIX}${userId}:${conversationId}`;
}

/**
 * Store deep research results in Redis with TTL
 */
export async function storeDeepResearchResult(
  result: DeepResearchResult,
): Promise<void> {
  const { userId, conversationId, ttl } = result;
  const key = buildDeepResearchKey(userId, conversationId);

  try {
    // Serialize with JSON
    await redisClient.set(key, JSON.stringify(result), "EX", ttl);
    console.log(
      `Stored deep research results for conversation ${conversationId}, expires in ${ttl}s`,
    );
  } catch (error) {
    console.error("Failed to store deep research results:", error);
  }
}

/**
 * Retrieve deep research results from Redis
 * Returns null if not found or expired
 */
export async function getDeepResearchResult(
  userId: string,
  conversationId: string,
): Promise<DeepResearchResult | null> {
  const key = buildDeepResearchKey(userId, conversationId);

  try {
    const data = await redisClient.get(key);
    if (!data) return null;

    // Parse the data and validate through schema to ensure correct structure
    const parsedData = JSON.parse(data);

    // Use Zod to validate and convert data (timestamp conversion happens automatically)
    return DeepResearchResultSchema.parse(parsedData);
  } catch (error) {
    console.error("Failed to retrieve deep research results:", error);
    return null;
  }
}
