import { extractGraph } from "../extract-graph";
import { formatConversationAsXml } from "../formatting";
import { ensureUser } from "../ingestion/ensure-user";
import { insertNewSources } from "../ingestion/insert-new-sources";
import { ensureSourceNode } from "../ingestion/ensure-source-node";
import { batchQueue } from "../queues";
import { z } from "zod";
import { DrizzleDB } from "~/db";
import { type ConversationTurn } from "~/lib/conversation-store";
import { NodeTypeEnum } from "~/types/graph";
import { TypeId } from "~/types/typeid";
import { redisClient } from "~/utils/redis";

export const MessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.string(),
  name: z.string().optional(),
  timestamp: z.string().datetime().pipe(z.coerce.date()),
});

type Message = z.infer<typeof MessageSchema>;

export const IngestConversationJobInputSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  messages: z.array(MessageSchema),
});

export type IngestConversationJobInput = z.infer<
  typeof IngestConversationJobInputSchema
>;

interface IngestConversationParams extends IngestConversationJobInput {
  db: DrizzleDB;
}

/**
 * Ingest conversation by persisting only new turns
 * and extracting graph on them.
 * Returns `insertedTurns` (empty if none new).
 */
export async function ingestConversation({
  db,
  userId,
  conversationId,
  messages,
}: IngestConversationParams): Promise<{ insertedTurns: ConversationTurn[] }> {
  const { sourceNodeId, insertedTurns } = await initializeConversation(
    db,
    userId,
    conversationId,
    messages,
  );
  if (insertedTurns.length === 0) {
    return { insertedTurns };
  }
  // Safe: insertedTurns non-empty after guard
  const firstTurn = insertedTurns[0]!;
  const conversationNodeId = await ensureSourceNode({
    db,
    userId,
    sourceId: sourceNodeId,
    timestamp: firstTurn.timestamp,
    nodeType: NodeTypeEnum.enum.Conversation,
  });
  await extractGraph({
    userId,
    sourceType: "conversation",
    linkedNodeId: conversationNodeId,
    content: formatConversationAsXml(insertedTurns),
  });
  
  // If there are user messages, trigger deep research in the background
  const conversationMessages = insertedTurns.filter(turn => turn.role === "user" || turn.role === "assistant");
  if (conversationMessages.length > 0) {
    // Use the 4 most recent user and assistant messages for context
    const recentMessages = conversationMessages.slice(-4);
    const combinedQuery = recentMessages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join("\n\n");
    
    try {
      // Check if we've recently triggered a deep research job for this conversation
      const throttleKey = `deep_research_throttle:${userId}:${conversationId}`;
      const lastTriggered = await redisClient.get(throttleKey);
      
      if (!lastTriggered) {
        await batchQueue.add("deep-research", {
          userId,
          conversationId,
          query: combinedQuery,
        });
        
        // Set throttling key with 1-minute expiration
        await redisClient.set(throttleKey, Date.now().toString(), 'EX', 60);
        console.log(`Queued deep research job for conversation ${conversationId}`);
      } else {
        console.log(`Deep research job throttled for conversation ${conversationId}`);
      }
    } catch (error) {
      console.error(`Failed to queue deep research job: ${error}`);
      // Don't fail the main ingestion if queuing the deep research job fails
    }
  }
  return { insertedTurns };
}

/**
 * Initialize conversation ingestion:
 * - Ensure the user record exists
 * - Lookup the conversation source by external ID
 * - Map and persist only new message turns
 * @param db DrizzleDB instance
 * @param userId ID of the user
 * @param conversationId External conversation identifier
 * @param messages Array of incoming messages
 * @returns `sourceNodeId` (internal PK) and `insertedTurns` (only newly created turns)
 */
async function initializeConversation(
  db: DrizzleDB,
  userId: string,
  conversationId: string,
  messages: Message[],
): Promise<{
  sourceNodeId: TypeId<"source">;
  insertedTurns: ConversationTurn[];
}> {
  await ensureUser(db, userId);
  const { sourceNodeId, newSourceSourceIds } = await insertNewSources({
    db,
    userId,
    parentSourceType: "conversation",
    parentSourceId: conversationId,
    childSourceType: "conversation_message",
    childSources: messages.map((m) => ({
      externalId: m.id,
      timestamp: m.timestamp,
      content: m.content,
      metadata: {
        rawContent: m.content,
        role: m.role,
        name: m.name,
        timestamp: m.timestamp.toISOString(),
      },
    })),
  });
  const insertedTurns = messages
    .filter((m) => newSourceSourceIds.includes(m.id))
    .map((m) => ({
      id: m.id,
      content: m.content,
      role: m.role,
      name: m.name,
      timestamp: m.timestamp,
    }));
  return { sourceNodeId, insertedTurns };
}
