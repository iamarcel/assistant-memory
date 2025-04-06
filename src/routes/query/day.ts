import { and, eq, ne, or } from "drizzle-orm";
import { defineEventHandler } from "h3";
import { z } from "zod";
import { edges, nodeMetadata, nodes } from "~/db/schema";
import { EdgeType, NodeTypeEnum } from "~/types/graph";
import { typeIdSchema } from "~/types/typeid";
import { useDatabase } from "~/utils/db";

// Define the request schema
const dayNodesRequestSchema = z.object({
  userId: typeIdSchema("user"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  includeFormattedResult: z.boolean().default(true),
});

export default defineEventHandler(async (event) => {
  const { userId, date, includeFormattedResult } = dayNodesRequestSchema.parse(
    await readBody(event),
  );
  const db = await useDatabase();

  // Find the day node for the specified date
  const [dayNode] = await db
    .select({
      id: nodes.id,
    })
    .from(nodes)
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(nodes.userId, userId),
        eq(nodes.nodeType, NodeTypeEnum.enum.Temporal),
        eq(nodeMetadata.label, date),
      ),
    )
    .limit(1);

  if (!dayNode) {
    return {
      date,
      error: `No day node found for ${date}`,
      nodes: [],
    };
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
          eq(edges.sourceNodeId, dayNode.id),
          eq(edges.targetNodeId, nodes.id),
        ),
        and(
          eq(edges.targetNodeId, dayNode.id),
          eq(edges.sourceNodeId, nodes.id),
        ),
      ),
    )
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(edges.userId, userId),
        eq(nodes.userId, userId),
        ne(nodes.id, dayNode.id), // Exclude the day node itself
      ),
    );

  type ConnectedNode = (typeof connectedNodes)[number];

  // Format the results as a nice string if requested
  let formattedResult: string | null = null;
  if (includeFormattedResult && connectedNodes.length > 0) {
    formattedResult = `# Memories from ${date}\n\n`;

    // Group nodes by edge type
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
      nodes.forEach((node) => {
        const label = node.metadata?.label || "Unnamed";
        const description = node.metadata?.description || "";
        formattedResult += `- **${label}**: ${description}\n`;
      });
      formattedResult += "\n";
    }
  }

  return {
    date,
    nodeCount: connectedNodes.length,
    ...(includeFormattedResult && formattedResult ? { formattedResult } : {}),
    nodes: connectedNodes,
  };
});
