import { debug, debugGraph } from "./debug-utils";
import { generateEmbeddings } from "./embeddings";
import { formatNodesForPrompt } from "./formatting";
import { findSimilarNodes } from "./search";
import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import { edges, nodeEmbeddings, nodeMetadata, nodes } from "~/db/schema";
import { EdgeTypeEnum, NodeTypeEnum, SourceType } from "~/types/graph";
import { TypeId } from "~/types/typeid";

interface ExtractGraphParams {
  userId: string;
  sourceType: SourceType;
  linkedNodeId: TypeId<"node">;
  content: string;
}

export async function extractGraph({
  userId,
  sourceType,
  linkedNodeId,
  content,
}: ExtractGraphParams) {
  const db = await useDatabase();

  // Get similar nodes with their metadata in a single query
  const similarNodes = await findSimilarNodes({
    userId,
    text: content,
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

  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
  });

  // Design prompt for the LLM
  const prompt = `You are a knowledge graph extraction expert. Your task is to analyze the following ${sourceType} and extract entities, concepts, events, and their relationships to create a knowledge graph.

IMPORTANT: Do NOT respond to the content. Instead, analyze it and extract a structured graph representation.

<${sourceType}>
${content}
</${sourceType}>

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

Existing nodes:
${formatNodesForPrompt(existingNodes)}
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

  debug("Parsed subgraph", parsed);

  if (!parsed) {
    throw new Error("Failed to parse LLM response");
  }

  // Deduplicate parsed nodes and edges to prevent duplicate insertions
  const uniqueParsedNodeMap = new Map<string, (typeof parsed.nodes)[0]>();
  for (const node of parsed.nodes) {
    const key = `${node.type}|${node.label}|${node.description ?? ""}`;
    if (!uniqueParsedNodeMap.has(key)) uniqueParsedNodeMap.set(key, node);
  }
  const uniqueParsedNodes = Array.from(uniqueParsedNodeMap.values());
  const seenEdgeKeys = new Set<string>();
  const uniqueParsedEdges = parsed.edges.filter((e) => {
    const key = `${e.sourceId}|${e.targetId}|${e.type}`;
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
    return true;
  });

  // Create a temporary ID to final ID mapping
  const idMap = new Map<string, TypeId<"node">>();

  // First, add all existing node mappings
  for (const [tempId, realId] of existingIdMap.entries()) {
    idMap.set(tempId, realId);
    // Also map real IDs to skip insertion when LLM returns real IDs
    idMap.set(realId.toString(), realId);
  }

  // Insert nodes and create the ID mapping
  const nodeInserts: Array<{
    id: TypeId<"node">;
    label: string;
    description: string | undefined;
    nodeType: z.infer<typeof NodeTypeEnum>;
  }> = [];

  for (const node of uniqueParsedNodes) {
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
      description: node.description,
      nodeType: node.type,
    });

    // Insert node metadata
    await db.insert(nodeMetadata).values({
      nodeId: insertedNode.id,
      label: node.label,
      description: node.description,
      additionalData: {},
    });
  }

  // Insert edges with mapped IDs
  let edgesCreated = 0;
  const edgeInserts: Array<typeof edges.$inferInsert> = nodeInserts.map(
    (n) => ({
      userId,
      edgeType: EdgeTypeEnum.Enum.MENTIONED_IN,
      sourceNodeId: n.id,
      targetNodeId: linkedNodeId,
    }),
  );

  for (const edge of uniqueParsedEdges) {
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

  // Map existing nodes to include nodeType for debug
  const debugNodes = [
    ...existingNodes.map((n) => ({
      id: n.id,
      label: n.label,
      description: n.description ?? undefined,
      nodeType: n.type,
    })),
    ...nodeInserts,
  ];

  // Only pass minimal edge shape to debugGraph
  debugGraph(
    debugNodes,
    edgeInserts.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      edgeType: e.edgeType,
    })),
  );

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

  return {
    newNodesCreated: nodeInserts.length,
    edgesCreated,
  };
}
