import { eq } from "drizzle-orm";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  edges,
  nodeEmbeddings,
  nodeMetadata,
  nodes,
  sources,
  sourceLinks,
  users,
} from "~/db/schema";
import { generateEmbeddings } from "~/lib/embeddings";
import { findSimilarNodes } from "~/lib/search";
import { ensureDayNode } from "~/lib/temporal";
import { EdgeTypeEnum, NodeTypeEnum } from "~/types/graph";
import { TypeId } from "~/types/typeid";
import { useDatabase } from "~/utils/db";
import { env } from "~/utils/env";

const ingestConversationRequestSchema = z.object({
  userId: z.string(),
  conversation: z.object({
    id: z.string(),
    messages: z.array(
      z.object({
        content: z.string(),
        role: z.string(),
        name: z.string().optional(),
        timestamp: z.string().datetime(),
      }),
    ),
  }),
});

type IngestConversationRequest = z.infer<
  typeof ingestConversationRequestSchema
>;

/**
 * Converts conversation messages to an XML-like format for LLM processing
 */
function formatConversationAsXml(
  messages: IngestConversationRequest["conversation"]["messages"],
): string {
  return messages
    .map(
      (message, index) =>
        `<message id="${index}" role="${message.role}" ${message.name ? `name="${message.name}"` : ""} timestamp="${message.timestamp}>
      <content>${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</content>
    </message>`,
    )
    .join("\n");
}

/**
 * Formats nodes for inclusion in the LLM prompt
 */
function formatExistingNodesForPrompt(
  existingNodes: Array<{
    id: TypeId<"node">;
    type: string;
    label: string;
    description: string | null;
    tempId: string;
  }>,
): string {
  if (existingNodes.length === 0) {
    return "";
  }

  const nodesJson = existingNodes.map((node) => ({
    id: node.tempId,
    type: node.type,
    label: node.label,
    description: node.description || "",
  }));

  return `
<existing_nodes>
${JSON.stringify(nodesJson, null, 2)}
</existing_nodes>
`;
}

export default defineEventHandler(async (event) => {
  const { userId, conversation } = ingestConversationRequestSchema.parse(
    await readBody(event),
  );
  const db = await useDatabase();

  // Ensure user exists
  await db
    .insert(users)
    .values({
      id: userId,
    })
    .onConflictDoNothing();

  // --- Ensure Day Node Exists ---
  const dayNodeId = await ensureDayNode(db, userId);

  // Check if this conversation source already exists
  const existingSource = await db.query.sources.findFirst({
    where: (sources, { and, eq }) =>
      and(
        eq(sources.userId, userId),
        eq(sources.sourceType, "conversation"),
        eq(sources.sourceIdentifier, conversation.id),
      ),
  });

  // Filter messages based on lastIngestedAt if the source exists
  let messagesToProcess = conversation.messages;
  if (existingSource?.lastIngestedAt) {
    const lastIngestedDate = new Date(existingSource.lastIngestedAt);
    messagesToProcess = conversation.messages.filter((message) => {
      // If message has no timestamp, include it (conservative approach)
      if (!message.timestamp) return true;

      const messageDate = new Date(message.timestamp);
      return messageDate > lastIngestedDate;
    });

    // If no new messages, return early with success
    if (messagesToProcess.length === 0) {
      return {
        success: true,
        stats: {
          existingNodesReused: 0,
          newNodesCreated: 0,
          edgesCreated: 0,
          sourceId: existingSource.id,
          skipped: true,
          reason: "No new messages since last ingestion",
        },
      };
    }
  }

  // Store or update conversation as a source
  const currentTimestamp = new Date();
  let source;

  if (existingSource) {
    // Update the existing source with new timestamp
    [source] = await db
      .update(sources)
      .set({
        lastIngestedAt: currentTimestamp,
        status: "completed",
      })
      .where(eq(sources.id, existingSource.id))
      .returning();
  } else {
    // Create a new source
    [source] = await db
      .insert(sources)
      .values({
        userId,
        sourceType: "conversation",
        sourceIdentifier: conversation.id,
        lastIngestedAt: currentTimestamp,
        status: "completed",
      })
      .returning();
  }

  if (!source) {
    throw new Error("Failed to store or update conversation as source");
  }

  // Format conversation as XML for the LLM
  const conversationXml = formatConversationAsXml(messagesToProcess);

  // Get similar nodes with their metadata in a single query
  const similarNodes = await findSimilarNodes({
    userId,
    text: conversationXml,
    limit: 50,
    similarityThreshold: 0.2,
  });

  // Create a mapping from real node IDs to temporary IDs for the prompt
  const existingNodes = similarNodes.map((node, index) => ({
    id: node.id,
    type: node.type,
    label: node.label ?? "",
    description: node.description,
    tempId: `existing_${node.type.toLowerCase()}_${index + 1}`,
  }));

  // Create a mapping from temporary IDs to real node IDs
  const existingIdMap = new Map<string, TypeId<"node">>();
  for (const node of existingNodes) {
    existingIdMap.set(node.tempId, node.id);
  }

  // Also create a mapping to track which real nodes we've already processed
  // so we don't fetch their metadata again
  const processedNodeIds = new Set<TypeId<"node">>();
  for (const node of existingNodes) {
    processedNodeIds.add(node.id);
  }

  // Process conversation text to subgraph
  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
  });

  // Design prompt for the LLM
  const prompt = `You are a knowledge graph extraction expert. Your task is to analyze the following conversation and extract entities, concepts, events, and their relationships to create a knowledge graph.

IMPORTANT: Do NOT respond to the conversation content. Instead, analyze it and extract a structured graph representation.

<conversation>
${conversationXml}
</conversation>
${formatExistingNodesForPrompt(existingNodes)}

Extract the following elements:
1. People mentioned (real or fictional)
2. Locations discussed
3. Events that occurred or were mentioned
4. Objects or items of significance
5. Emotions expressed or discussed
6. Concepts or ideas explored
7. Media mentioned (books, movies, articles, etc.)
8. Temporal references (dates, times, periods)
9. The assistant's emotions and feelings
10. The assistant's internal insights or discoveries about the user

For each element, create a node with:
- A unique temporary ID (format: "temp_[type]_[number]", e.g., "temp_person_1")
- The appropriate node type
- A concise label (name/title)
- A brief description providing context

${
  existingNodes.length > 0
    ? `
IMPORTANT: I've provided some existing nodes that may be relevant to this conversation. If any of these nodes match entities in the conversation, use them instead of creating new nodes. You can reference these existing nodes by their ID in your edges.
Never create new nodes for a node that already exists.
`
    : ""
}

Then create edges between these nodes to represent their relationships using the appropriate edge types.

Focus on extracting the most significant and meaningful information. Quality is more important than quantity.`;

  const completion = await client.beta.chat.completions.parse({
    messages: [{ role: "user", content: prompt }],
    model: env.MODEL_ID_GRAPH_EXTRACTION,
    response_format: zodResponseFormat(
      z.object({
        nodes: z.array(
          z.object({
            id: z.string().describe("temp id to reference in edges"),
            type: NodeTypeEnum.describe("one of the allowed node types"),
            label: z.string().describe("human-readable name/title"),
            description: z
              .string()
              .describe("longer text description")
              .optional(),
          }),
        ),
        edges: z.array(
          z.object({
            sourceId: z.string().describe("id or temp id of staring node"),
            targetId: z.string().describe("id or temp id of ending node"),
            type: EdgeTypeEnum.describe("one of the allowed edge types"),
          }),
        ),
      }),
      "subgraph",
    ),
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("Failed to parse LLM response");
  }

  // Create a temporary ID to final ID mapping
  const idMap = new Map<string, TypeId<"node">>();

  // First, add all existing node mappings
  for (const [tempId, realId] of existingIdMap.entries()) {
    idMap.set(tempId, realId);
  }

  // Insert nodes and create the ID mapping
  const nodeInserts: Array<{
    id: TypeId<"node">;
    label: string;
    description: string;
    nodeType: z.infer<typeof NodeTypeEnum>;
  }> = [];

  for (const node of parsed.nodes) {
    // Skip if this is an existing node (already in idMap)
    if (idMap.has(node.id)) {
      continue;
    }

    // Insert node
    const [insertedNode] = await db
      .insert(nodes)
      .values({
        userId,
        nodeType: node.type,
      })
      .returning();

    if (!insertedNode) {
      throw new Error(`Failed to insert node: ${node.label}`);
    }

    // Map temporary ID to actual ID
    idMap.set(node.id, insertedNode.id);

    // Store node for later use
    nodeInserts.push({
      id: insertedNode.id,
      label: node.label,
      description: node.description || "",
      nodeType: node.type,
    });

    // Insert node metadata
    await db.insert(nodeMetadata).values({
      nodeId: insertedNode.id,
      label: node.label,
      description: node.description || "",
      additionalData: {},
    });
  }

  // Insert edges with mapped IDs
  let edgesCreated = 0;
  const edgeInserts = [];

  for (const edge of parsed.edges) {
    const sourceNodeId = idMap.get(edge.sourceId);
    const targetNodeId = idMap.get(edge.targetId);

    if (!sourceNodeId || !targetNodeId) {
      console.warn(
        `Skipping edge with invalid node references: ${edge.sourceId} -> ${edge.targetId}`,
      );
      continue;
    }

    edgeInserts.push({
      userId,
      sourceNodeId,
      targetNodeId,
      edgeType: edge.type,
    });
  }

  // Create edges linking new nodes to the day node
  const newEdgesToDayNode: Array<typeof edges.$inferInsert> = [];
  for (const node of nodeInserts) {
    // Only link non-Temporal nodes to the day node
    if (node.nodeType !== NodeTypeEnum.enum.Temporal && node.id !== dayNodeId) {
      newEdgesToDayNode.push({
        userId,
        sourceNodeId: node.id, // Corrected from sourceId
        targetNodeId: dayNodeId,
        edgeType:
          node.nodeType === NodeTypeEnum.enum.Event
            ? EdgeTypeEnum.enum.OCCURRED_ON
            : EdgeTypeEnum.enum.MENTIONED_IN,
        metadata: { createdBy: "ingestion" }, // Add relevant metadata
      });
    }
  }

  // Add day node links to the edges to insert
  edgeInserts.push(...newEdgesToDayNode);

  // Batch insert all edges with onConflictDoNothing to handle duplicates
  if (edgeInserts.length > 0) {
    const result = await db
      .insert(edges)
      .values(edgeInserts)
      .onConflictDoNothing({ target: [edges.sourceNodeId, edges.targetNodeId] })
      .returning();

    edgesCreated = result.length;
  }

  // Generate embeddings for new nodes
  if (nodeInserts.length > 0) {
    const embeddingInputs = nodeInserts.map(
      (n) => `${n.label}: ${n.description}`,
    );

    const embeddings = await generateEmbeddings({
      model: "jina-embeddings-v3",
      task: "retrieval.passage",
      input: embeddingInputs,
    });

    if (embeddings.data.length !== nodeInserts.length) {
      throw new Error("Failed to generate embeddings for all nodes");
    }

    // Insert embeddings one by one to ensure type safety
    for (let i = 0; i < nodeInserts.length; i++) {
      const embedding = embeddings.data[i]?.embedding;
      if (!embedding) {
        console.warn(
          `No embedding generated for node: ${nodeInserts[i]!.label}`,
        );
        continue;
      }

      await db.insert(nodeEmbeddings).values({
        nodeId: nodeInserts[i]!.id,
        embedding,
        modelName: "jina-embeddings-v3",
      });
    }
  }

  // Link new nodes to the source - ensure source exists
  if (source && source.id && nodeInserts.length > 0) {
    for (const node of nodeInserts) {
      await db.insert(sourceLinks).values({
        nodeId: node.id,
        sourceId: source.id,
      });
    }
  }

  // Return success with stats
  return {
    success: true,
    stats: {
      existingNodesReused: existingNodes.length,
      newNodesCreated: nodeInserts.length,
      edgesCreated,
      sourceId: source?.id || "unknown",
    },
  };
});
