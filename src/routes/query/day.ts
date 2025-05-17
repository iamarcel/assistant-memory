import { and, eq, ne, or } from "drizzle-orm";
import { defineEventHandler } from "h3";
import { edges, nodeMetadata, nodes } from "~/db/schema";
import { findDayNode } from "~/lib/graph";
import { EdgeType } from "~/types/graph";
import { useDatabase } from "~/utils/db";
import {
  queryDayRequestSchema,
  queryDayResponseSchema,
} from "~/lib/schemas/query-day";

// TODO Validate to make sure we have one-hop results
// eg., conversation is linked to the day node
//      and what's mentioned inside is one hop further

export default defineEventHandler(async (event) => {
  const { userId, date, includeFormattedResult } = queryDayRequestSchema.parse(
    await readBody(event),
  );
  const db = await useDatabase();

  // Fetch the day node id for the specified date
  const dayNodeId = await findDayNode(db, userId, date);
  if (!dayNodeId) {
    return queryDayResponseSchema.parse({
      date,
      error: `No day node found for ${date}`,
      nodes: [],
    });
  }

  // Single optimized query to get connected nodes with their metadata
  const connectedNodes = await db
    .select({
      id: nodes.id,
      nodeType: nodes.nodeType,
      metadata: {
        label: nodeMetadata.label,
        description: nodeMetadata.description,
      },
      edgeType: edges.edgeType,
    })
    .from(nodes)
    .innerJoin(
      edges,
      or(
        and(
          eq(edges.sourceNodeId, dayNodeId),
          eq(edges.targetNodeId, nodes.id),
        ),
        and(
          eq(edges.targetNodeId, dayNodeId),
          eq(edges.sourceNodeId, nodes.id),
        ),
      ),
    )
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(edges.userId, userId),
        eq(nodes.userId, userId),
        ne(nodes.id, dayNodeId), // Exclude the day node itself
      ),
    );

  // --- Deduplicate nodes based on ID for the final response ---
  const uniqueNodesMap = new Map<string, ConnectedNode>();
  connectedNodes.forEach((node) => {
    if (!uniqueNodesMap.has(node.id)) {
      uniqueNodesMap.set(node.id, node);
    }
    // If node already exists, we keep the first encountered version.
    // Modify this logic if a different version (e.g., based on edge type) is preferred.
  });
  const uniqueConnectedNodes = Array.from(uniqueNodesMap.values());

  type ConnectedNode = (typeof connectedNodes)[number];

  // Format the results as a nice string if requested
  let formattedResult: string | null = null;
  if (includeFormattedResult && connectedNodes.length > 0) {
    formattedResult = `# Memories from ${date}\n\n`;

    // Group nodes by edge type (using the original list with potential duplicates)
    const nodesByEdgeType = connectedNodes.reduce(
      (acc, node) => {
        const type = node.edgeType || "Unknown";
        if (!acc[type]) acc[type] = [];
        acc[type].push(node);
        return acc;
      },
      {} as Record<EdgeType, ConnectedNode[]>,
    );

    // Format each group
    for (const [edgeType, nodes] of Object.entries(nodesByEdgeType)) {
      formattedResult += `## ${edgeType}\n\n`;
      // Deduplicate nodes *within this specific edge type group* for formatting
      const uniqueNodesInGroup = Array.from(
        nodes
          .reduce((map, node) => {
            if (!map.has(node.id)) {
              map.set(node.id, node);
            }
            return map;
          }, new Map<string, ConnectedNode>())
          .values(),
      );

      uniqueNodesInGroup.forEach((node) => {
        const label = node.metadata?.label || "Unnamed";
        const description = node.metadata?.description || "";
        formattedResult += `- **${label}**: ${description}\n`;
      });
      formattedResult += "\n";
    }
  }

  return queryDayResponseSchema.parse({
    date,
    nodeCount: uniqueConnectedNodes.length, // Use count of unique nodes
    ...(includeFormattedResult && formattedResult ? { formattedResult } : {}),
    nodes: uniqueConnectedNodes, // Return the unique list
  });
});
