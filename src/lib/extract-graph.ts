import { debugGraph } from "./debug-utils";
import {
  generateAndInsertNodeEmbeddings,
  generateAndInsertEdgeEmbeddings,
} from "./embeddings-util";
import { formatNodesForPrompt } from "./formatting";
import { findSimilarNodes, findOneHopNodes } from "./graph";
import { TemporaryIdMapper } from "./temporary-id-mapper";
import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import { type DrizzleDB } from "~/db";
import { edges, nodeMetadata, nodes } from "~/db/schema";
import { EdgeTypeEnum, NodeTypeEnum, SourceType } from "~/types/graph";
import { type TypeId } from "~/types/typeid";
import { useDatabase } from "~/utils/db";

const llmNodeSchema = z.object({
  id: z.string().describe("id to reference in edges"),
  type: NodeTypeEnum.describe("one of the allowed node types"),
  label: z.string().describe("human-readable name/title"),
  description: z.string().describe("longer text description").optional(),
});
type LlmOutputNode = z.infer<typeof llmNodeSchema>;

const llmEdgeSchema = z.object({
  sourceId: z.string().describe("id of staring node"),
  targetId: z.string().describe("id of ending node"),
  type: EdgeTypeEnum.describe("one of the allowed edge types"),
  description: z
    .string()
    .describe("short description of the edge (if it represents a 'fact')")
    .optional(),
});
type LlmOutputEdge = z.infer<typeof llmEdgeSchema>;

interface NodeForLLMPrompt {
  id: string;
  type: z.infer<typeof NodeTypeEnum>;
  label: string | null;
  timestamp: string;
  description?: string | null;
  tempId: string;
}

interface ProcessedNode {
  id: TypeId<"node">;
  label: string;
  description: string | undefined;
  nodeType: z.infer<typeof NodeTypeEnum>;
}

interface SimilarNodeForPrompt {
  id: TypeId<"node">;
  type: z.infer<typeof NodeTypeEnum>;
  label: string | null;
  description: string | null;
  timestamp: string;
}

interface ExtractGraphParams {
  userId: string;
  sourceType: SourceType;
  linkedNodeId: TypeId<"node">;
  content: string;
}

// --- Main extractGraph function ---
export async function extractGraph({
  userId,
  sourceType,
  linkedNodeId,
  content,
}: ExtractGraphParams) {
  const db = await useDatabase();

  const similarNodesRaw = (
    await Promise.all([
      findSimilarNodes({
        userId,
        text: content,
        limit: 50,
        minimumSimilarity: 0.3,
      }),
      findOneHopNodes(db, userId, [linkedNodeId]),
    ])
  ).flat();

  const similarNodesForProcessing = similarNodesRaw.map((node) => ({
    id: node.id,
    type: node.type,
    label: node.label,
    description: node.description,
    timestamp: node.timestamp.toISOString(),
  }));

  const { nodesForPromptFormatting, idMap, nodeLabels } =
    _prepareInitialNodeMappings(similarNodesForProcessing);

  const { createCompletionClient } = await import("./ai");
  const client = await createCompletionClient(userId);

  const prompt = `You are a knowledge graph extraction expert. Your task is to analyze the following ${sourceType} and extract entities, concepts, events, and their relationships to create a knowledge graph.

IMPORTANT:
- Do NOT respond to the content. Instead, analyze it and extract a structured graph representation.
${
  nodesForPromptFormatting.length > 0
    ? `
- Do NOT extract anything from the context—only from the ${sourceType} given at the end. The context is only provided to help you understand the ${sourceType} better.
- I've provided some existing nodes that may be relevant to this ${sourceType}. If any of these nodes match entities in the ${sourceType}, use their 'tempId' (e.g., existing_person_1) in your 'nodes' or 'edges' if you refer to them. DO NOT create new nodes for these if they match.

<context>
${formatNodesForPrompt(nodesForPromptFormatting)}
</context>
`
    : ""
}

Extract the graph from the following ${sourceType}:

<${sourceType}>
${content}
</${sourceType}>

Extract, for example, the following elements:
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
- A unique temporary ID (format: "temp_[type]_[number]", e.g., "temp_person_1") if it's a NEW node.
- The appropriate node type
- A concise label (name/title)
- A brief description providing context (optional)

Then, link these nodes with edges.
- Edges are mainly used to represent "facts" about nodes. For example, if you have a Person node and an Event node, you can create an edge from the Person node to the Event node to represent the fact that the person participated in the event.
- Edges are unique by source node, target node, and edge type
- In the edge description for facts, give a succinct description of the fact. Add some minimal context to aid retrieval, but keep it concise.
- Ideally, edges link to already-existing nodes. If the node isn't existing, create it.

Rules of the graph:
- Nodes are unique by type and label
- Never create new nodes for a node that already exists
- In node names use full names, eg. "John Doe" instead of "John"
- Omit unnecessary details in node names, eg. "John Doe" instead of "John Doe (person)"
- Nodes are independent of context and represent a *single* thing. Bad example: "John - the person taking a walk". Good example: "John" (Person node, no description) linked to [PARTICIPATED_IN] "John's walk on 2025-05-18" (Event node), linked to [OCCURRED_ON] "2025-05-18" (Temporal node).
- Don't create nodes for things that should be represented by edges.


Then create edges between these nodes to represent their relationships using the appropriate edge types.

Focus on extracting the most significant and meaningful information. Quality is more important than quantity.`;

  const completion = await client.beta.chat.completions.parse({
    messages: [{ role: "user", content: prompt }],
    model: env.MODEL_ID_GRAPH_EXTRACTION,
    response_format: zodResponseFormat(
      z.object({
        nodes: z.array(llmNodeSchema),
        edges: z.array(llmEdgeSchema),
      }),
      "subgraph",
    ),
  });

  const parsedLlmOutput = completion.choices[0]?.message.parsed;
  if (!parsedLlmOutput) {
    throw new Error("Failed to parse LLM response");
  }

  const uniqueParsedLlmNodes = _deduplicateLlmNodes(parsedLlmOutput.nodes);
  const uniqueParsedLlmEdges = _deduplicateLlmEdges(parsedLlmOutput.edges);

  const detailsOfNewlyCreatedNodes = await _processAndInsertNewNodes(
    db,
    userId,
    uniqueParsedLlmNodes,
    idMap,
    nodeLabels,
  );

  // Create edges linking new nodes to the provided linkedNodeId
  if (linkedNodeId && detailsOfNewlyCreatedNodes.length > 0) {
    await db
      .insert(edges)
      .values(
        detailsOfNewlyCreatedNodes.map((newNode) => ({
          userId,
          sourceNodeId: newNode.id,
          targetNodeId: linkedNodeId,
          edgeType: EdgeTypeEnum.enum.MENTIONED_IN,
          description: null,
        })),
      )
      .onConflictDoNothing();
  }

  const insertedEdgeRecords = await _processAndInsertLlmEdges(
    db,
    userId,
    uniqueParsedLlmEdges,
    idMap,
  );

  const edgesToEmbed = insertedEdgeRecords
    .map((edgeRecord) => {
      const sourceLabel = nodeLabels.get(edgeRecord.sourceNodeId);
      const targetLabel = nodeLabels.get(edgeRecord.targetNodeId);

      if (!sourceLabel || !targetLabel || !edgeRecord.description) return null;

      return {
        edgeId: edgeRecord.id,
        edgeType: edgeRecord.edgeType,
        description: edgeRecord.description,
        sourceLabel,
        targetLabel,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  await Promise.all([
    generateAndInsertEdgeEmbeddings(db, edgesToEmbed),
    generateAndInsertNodeEmbeddings(db, detailsOfNewlyCreatedNodes),
  ]);

  debugGraph(detailsOfNewlyCreatedNodes, insertedEdgeRecords);

  return {
    newNodesCreated: detailsOfNewlyCreatedNodes.length,
    edgesCreated: insertedEdgeRecords.length,
  };
}

function _deduplicateLlmNodes(llmNodes: LlmOutputNode[]): LlmOutputNode[] {
  const seen = new Set<string>();
  return llmNodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function _deduplicateLlmEdges(llmEdges: LlmOutputEdge[]): LlmOutputEdge[] {
  const seenEdgeKeys = new Set<string>();
  return llmEdges.filter((e) => {
    const key = `${e.sourceId}|${e.targetId}|${e.type}`;
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
    return true;
  });
}

function _prepareInitialNodeMappings(similarNodes: SimilarNodeForPrompt[]) {
  const existingNodeMapper = new TemporaryIdMapper<
    SimilarNodeForPrompt,
    string
  >((item, index) => `existing_${item.type.toLowerCase()}_${index + 1}`);

  const mappedExistingNodes = existingNodeMapper.mapItems(similarNodes);

  const idMap = new Map<string, TypeId<"node">>();
  const nodeLabels = new Map<TypeId<"node">, string>();

  for (const mappedNode of mappedExistingNodes) {
    idMap.set(mappedNode.tempId, mappedNode.id);
    idMap.set(mappedNode.id.toString(), mappedNode.id);
    if (mappedNode.label) {
      nodeLabels.set(mappedNode.id, mappedNode.label);
    }
  }

  const nodesForPromptFormatting: NodeForLLMPrompt[] = mappedExistingNodes.map(
    (mappedNode) => ({
      id: mappedNode.id.toString(),
      type: mappedNode.type,
      label: mappedNode.label,
      description: mappedNode.description,
      tempId: mappedNode.tempId,
      timestamp: mappedNode.timestamp,
    }),
  );

  return { nodesForPromptFormatting, idMap, nodeLabels };
}

async function _processAndInsertNewNodes(
  db: DrizzleDB,
  userId: string,
  uniqueParsedLlmNodes: LlmOutputNode[],
  idMap: Map<string, TypeId<"node">>,
  nodeLabels: Map<TypeId<"node">, string>,
): Promise<ProcessedNode[]> {
  const detailsOfNewlyCreatedNodes: ProcessedNode[] = [];

  for (const llmNode of uniqueParsedLlmNodes) {
    if (idMap.has(llmNode.id)) {
      continue;
    }

    const [insertedNodeRecord] = await db
      .insert(nodes)
      .values({
        userId,
        nodeType: llmNode.type,
      })
      .returning();

    if (!insertedNodeRecord) {
      console.warn(`Failed to insert node: ${llmNode.label}`);
      continue;
    }

    await db.insert(nodeMetadata).values({
      nodeId: insertedNodeRecord.id,
      label: llmNode.label,
      description: llmNode.description,
      additionalData: {},
    });

    idMap.set(llmNode.id, insertedNodeRecord.id);
    nodeLabels.set(insertedNodeRecord.id, llmNode.label);

    detailsOfNewlyCreatedNodes.push({
      id: insertedNodeRecord.id,
      label: llmNode.label,
      description: llmNode.description,
      nodeType: llmNode.type,
    });
  }
  return detailsOfNewlyCreatedNodes;
}

async function _processAndInsertLlmEdges(
  db: DrizzleDB,
  userId: string,
  uniqueParsedLlmEdges: LlmOutputEdge[],
  idMap: Map<string, TypeId<"node">>,
): Promise<Array<typeof edges.$inferSelect>> {
  const edgeInserts: Array<typeof edges.$inferInsert> = [];

  for (const llmEdge of uniqueParsedLlmEdges) {
    const sourceNodeId = idMap.get(llmEdge.sourceId);
    const targetNodeId = idMap.get(llmEdge.targetId);

    if (!sourceNodeId || !targetNodeId) {
      console.warn(
        `Skipping edge with invalid node references: ${llmEdge.sourceId} -> ${llmEdge.targetId}`,
      );
      continue;
    }

    edgeInserts.push({
      userId,
      sourceNodeId,
      targetNodeId,
      edgeType: llmEdge.type,
      description: llmEdge.description,
    });
  }

  if (edgeInserts.length === 0) {
    return [];
  }

  const insertedEdgeRecords = await db
    .insert(edges)
    .values(edgeInserts)
    .onConflictDoNothing({
      target: [edges.sourceNodeId, edges.targetNodeId, edges.edgeType],
    })
    .returning();

  return insertedEdgeRecords;
}
