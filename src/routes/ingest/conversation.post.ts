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
import { useDatabase } from "~/utils/db";
import { TypeId, typeIdSchema } from "~/types/typeid";
import { findSimilarNodes } from "~/lib/search";
import { env } from "~/utils/env";
import { EdgeTypeEnum, NodeTypeEnum } from "~/types/graph";
import { generateEmbeddings } from "~/lib/embeddings";

const ingestConversationRequestSchema = z.object({
  userId: typeIdSchema("user"),
  conversation: z.object({
    id: z.string(),
    messages: z.array(
      z.object({
        content: z.string(),
        role: z.string(),
      }),
    ),
  }),
});

/**
 * Converts conversation messages to an XML-like format for LLM processing
 */
function formatConversationAsXml(
  messages: { content: string; role: string }[],
): string {
  return messages
    .map(
      (message, index) =>
        `<message id="${index}" role="${message.role}">
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

  // Store conversation as a source
  const [source] = await db
    .insert(sources)
    .values({
      userId,
      sourceType: "conversation",
      sourceIdentifier: conversation.id,
    })
    .returning();

  if (!source) {
    throw new Error("Failed to store conversation as source");
  }

  // Format conversation as XML for the LLM
  const conversationXml = formatConversationAsXml(conversation.messages);

  // Get similar nodes with their metadata in a single query
  const similarNodes = await findSimilarNodes({
    userId,
    text: conversationXml,
    limit: 10,
    similarityThreshold: 0.7,
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

For each element, create a node with:
- A unique temporary ID (format: "temp_[type]_[number]", e.g., "temp_person_1")
- The appropriate node type
- A concise label (name/title)
- A brief description providing context

${
  existingNodes.length > 0
    ? `
IMPORTANT: I've provided some existing nodes that may be relevant to this conversation. If any of these nodes match entities in the conversation, use them instead of creating new nodes. You can reference these existing nodes by their ID in your edges.
`
    : ""
}

Then create edges between these nodes to represent their relationships using the appropriate edge types.

Focus on extracting the most significant and meaningful information. Quality is more important than quantity.`;

  const completion = await client.beta.chat.completions.parse({
    messages: [{ role: "user", content: prompt }],
    model: "gpt-4o-mini",
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
      (node) =>
        `${node.label}${node.description ? `: ${node.description}` : ""}`,
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
