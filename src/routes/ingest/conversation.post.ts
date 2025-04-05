import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  sources,
  nodes,
  nodeMetadata,
  edges,
  nodeEmbeddings,
  sourceLinks,
  users,
} from "~/db/schema";
import { generateEmbeddings } from "~/lib/embeddings";
import { EdgeTypeEnum, NodeTypeEnum } from "~/types/graph";
import { TypeId, typeIdSchema } from "~/types/typeid";
import { useDatabase } from "~/utils/db";
import { env } from "~/utils/env";

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

  // Insert nodes and create the ID mapping
  const nodeInserts: Array<{
    id: TypeId<"node">;
    label: string;
    description: string;
  }> = [];

  for (const node of parsed.nodes) {
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
  for (const edge of parsed.edges) {
    const sourceNodeId = idMap.get(edge.sourceId);
    const targetNodeId = idMap.get(edge.targetId);

    if (!sourceNodeId || !targetNodeId) {
      console.warn(
        `Skipping edge with invalid node references: ${edge.sourceId} -> ${edge.targetId}`,
      );
      continue;
    }

    await db.insert(edges).values({
      userId,
      sourceNodeId,
      targetNodeId,
      edgeType: edge.type,
    });

    edgesCreated++;
  }

  // Generate embeddings for nodes
  const embeddingInputs = nodeInserts.map(
    (node) => `${node.label}${node.description ? `: ${node.description}` : ""}`,
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
      console.warn(`No embedding generated for node: ${nodeInserts[i]!.label}`);
      continue;
    }

    await db.insert(nodeEmbeddings).values({
      nodeId: nodeInserts[i]!.id,
      embedding,
      modelName: "jina-embeddings-v3",
    });
  }

  // Link nodes to the source - ensure source exists
  if (source && source.id) {
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
      nodesCreated: nodeInserts.length,
      edgesCreated,
      sourceId: source?.id || "unknown",
    },
  };
});
