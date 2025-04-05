import {
  sql,
  eq,
  desc,
  cosineDistance,
  and,
  or,
  inArray,
  isNotNull,
} from "drizzle-orm";
import { nodes, nodeMetadata, nodeEmbeddings, edges } from "~/db/schema";
import { generateEmbeddings } from "~/lib/embeddings";
import { TypeId } from "~/types/typeid";

/**
 * Node result with metadata and similarity score
 */
export type NodeSearchResult = {
  id: TypeId<"node">;
  type: string;
  label: string | null;
  description: string | null;
  similarity: number;
};

/**
 * Node with its connections
 */
export type NodeWithConnections = {
  id: TypeId<"node">;
  type: string;
  label: string;
  description: string | null;
  similarity?: number;
  isDirectMatch?: boolean;
  connectedTo?: TypeId<"node">[];
};

/**
 * Search options for finding similar nodes
 */
export interface FindSimilarNodesOptions {
  userId: TypeId<"user">;
  text: string;
  limit?: number;
  similarityThreshold?: number;
  embeddingTask?: "retrieval.query" | "retrieval.passage" | "text-matching" | "classification" | "separation";
}

/**
 * Generates an embedding for the given text
 */
export async function generateTextEmbedding(
  text: string,
  task: "retrieval.query" | "retrieval.passage" | "text-matching" | "classification" | "separation" = "retrieval.passage",
) {
  const embeddings = await generateEmbeddings({
    model: "jina-embeddings-v3",
    task,
    input: [text],
  });

  if (!embeddings.data[0]?.embedding) {
    throw new Error("Failed to generate embedding");
  }

  return embeddings.data[0].embedding;
}

/**
 * Finds nodes similar to the given text embedding
 */
export async function findSimilarNodes({
  userId,
  text,
  limit = 10,
  similarityThreshold = 0,
  embeddingTask = "retrieval.passage",
}: FindSimilarNodesOptions): Promise<NodeSearchResult[]> {
  // Generate embedding for the text
  const embedding = await generateTextEmbedding(text, embeddingTask);

  // Calculate similarity using cosine distance
  const similarity = sql<number>`1 - (${cosineDistance(
    nodeEmbeddings.embedding,
    embedding,
  )})`;

  // Query the database for similar nodes
  const db = await import("~/utils/db").then((m) => m.useDatabase());
  const similarNodes = await db
    .select({
      id: nodes.id,
      type: nodes.nodeType,
      label: nodeMetadata.label,
      description: nodeMetadata.description,
      similarity,
    })
    .from(nodeEmbeddings)
    .innerJoin(nodes, eq(nodeEmbeddings.nodeId, nodes.id))
    .innerJoin(nodeMetadata, eq(nodes.id, nodeMetadata.nodeId))
    .where(
      and(
        eq(nodes.userId, userId),
        similarityThreshold > 0
          ? sql`${similarity} > ${similarityThreshold}`
          : undefined,
      ),
    )
    .orderBy(desc(similarity))
    .limit(limit);

  return similarNodes;
}

/**
 * Finds one-hop connections for the given node IDs
 */
export async function findOneHopConnections(
  db: Awaited<ReturnType<typeof import("~/utils/db").useDatabase>>,
  userId: TypeId<"user">,
  nodeIds: TypeId<"node">[],
  onlyWithLabels = true,
) {
  if (nodeIds.length === 0) {
    return [];
  }

  const whereConditions = [
    eq(edges.userId, userId),
    or(inArray(edges.sourceNodeId, nodeIds), inArray(edges.targetNodeId, nodeIds)),
  ];

  if (onlyWithLabels) {
    whereConditions.push(isNotNull(nodeMetadata.label));
  }

  return db
    .select({
      // Edge information
      sourceId: edges.sourceNodeId,
      targetId: edges.targetNodeId,
      edgeType: edges.edgeType,
      // Target node information
      nodeId: nodes.id,
      nodeType: nodes.nodeType,
      label: nodeMetadata.label,
      description: nodeMetadata.description,
    })
    .from(edges)
    .innerJoin(
      nodes,
      or(eq(edges.targetNodeId, nodes.id), eq(edges.sourceNodeId, nodes.id)),
    )
    .innerJoin(nodeMetadata, eq(nodes.id, nodeMetadata.nodeId))
    .where(and(...whereConditions));
}

/**
 * Processes search results and their connections into a structured format
 */
export function processSearchResultsWithConnections(
  directMatches: NodeSearchResult[],
  connections: Awaited<ReturnType<typeof findOneHopConnections>>,
): {
  directMatches: NodeWithConnections[];
  connectedNodes: NodeWithConnections[];
  allNodes: NodeWithConnections[];
} {
  // Process the results to ensure proper typing
  const formattedDirectMatches: NodeWithConnections[] = directMatches.map(
    (node) => ({
      id: node.id,
      type: node.type,
      label: node.label ?? "",
      description: node.description,
      similarity: node.similarity,
      isDirectMatch: true,
      connectedTo: [],
    }),
  );

  // Get the IDs of the direct matches
  const directMatchIds = formattedDirectMatches.map((node) => node.id);

  // Process one-hop connections
  const oneHopNodes = new Map<TypeId<"node">, NodeWithConnections>();
  const connectionMap = new Map<TypeId<"node">, Set<TypeId<"node">>>();

  // Initialize connection map for direct matches
  for (const node of formattedDirectMatches) {
    connectionMap.set(node.id, new Set());
  }

  // Process each connection
  for (const connection of connections) {
    const isSource = directMatchIds.includes(connection.sourceId);
    const directNodeId = isSource ? connection.sourceId : connection.targetId;
    const connectedNodeId = isSource ? connection.targetId : connection.sourceId;

    // Skip if the connected node is already a direct match
    if (directMatchIds.includes(connectedNodeId)) {
      continue;
    }

    // Add to one-hop nodes if not already present
    if (!oneHopNodes.has(connectedNodeId)) {
      oneHopNodes.set(connectedNodeId, {
        id: connectedNodeId,
        type: connection.nodeType,
        label: connection.label ?? "",
        description: connection.description,
        isDirectMatch: false,
        connectedTo: [],
      });
    }

    // Update connection maps
    if (connectionMap.has(directNodeId)) {
      connectionMap.get(directNodeId)!.add(connectedNodeId);
    }

    // Add the direct node to the connected node's connections
    const connectedNode = oneHopNodes.get(connectedNodeId);
    if (
      connectedNode &&
      !connectedNode.connectedTo!.includes(directNodeId)
    ) {
      connectedNode.connectedTo!.push(directNodeId);
    }
  }

  // Update direct matches with their connections
  for (const node of formattedDirectMatches) {
    const connections = connectionMap.get(node.id);
    if (connections) {
      node.connectedTo = Array.from(connections);
    }
  }

  // Convert the one-hop nodes map to an array
  const connectedNodes = Array.from(oneHopNodes.values());

  // Combine direct and one-hop nodes
  const allNodes = [...formattedDirectMatches, ...connectedNodes];

  return {
    directMatches: formattedDirectMatches,
    connectedNodes,
    allNodes,
  };
}

/**
 * Formats search results as a readable string
 */
export function formatSearchResultsAsString(
  query: string,
  allNodes: NodeWithConnections[],
  directMatches: NodeWithConnections[],
): string {
  let result = `Results for query: "${query}"\n\n`;

  // Add direct matches section
  result += `Found ${directMatches.length} direct matches:\n`;
  directMatches.forEach((node, index) => {
    const similarityPercentage = Math.round((node.similarity || 0) * 100);
    result += `${index + 1}. ${node.label} (${node.type}, ${similarityPercentage}% match)\n`;
    if (node.description) {
      result += `   ${node.description}\n`;
    }
    if (node.connectedTo && node.connectedTo.length > 0) {
      result += `   Connected to ${node.connectedTo.length} other nodes\n`;
    }
    result += "\n";
  });

  // Add connected nodes section if there are any
  const connectedNodes = allNodes.filter((node) => !node.isDirectMatch);
  if (connectedNodes.length > 0) {
    result += `\nRelated nodes (one hop away):\n`;
    connectedNodes.forEach((node, index) => {
      result += `${index + 1}. ${node.label} (${node.type})\n`;
      if (node.description) {
        result += `   ${node.description}\n`;
      }
      if (node.connectedTo && node.connectedTo.length > 0) {
        // Find the labels of the connected nodes
        const connectedLabels = node.connectedTo
          .map((id) => {
            const connectedNode = directMatches.find((n) => n.id === id);
            return connectedNode ? connectedNode.label : null;
          })
          .filter(Boolean);

        result += `   Connected to: ${connectedLabels.join(", ")}\n`;
      }
      result += "\n";
    });
  }

  return result;
}
