import { and, eq, ne, or } from "drizzle-orm";
import { edges, nodeMetadata, nodes } from "~/db/schema";
import { findDayNode } from "../graph";
import { EdgeType } from "~/types/graph";
import { useDatabase } from "~/utils/db";
import {
  QueryDayRequest,
  QueryDayResponse,
} from "../schemas/query-day";

/**
 * Retrieve memories linked to a given day.
 */
export async function queryDayMemories(
  params: QueryDayRequest,
): Promise<QueryDayResponse> {
  const { userId, date, includeFormattedResult } = params;
  const db = await useDatabase();

  const dayNodeId = await findDayNode(db, userId, date);
  if (!dayNodeId) {
    return {
      date,
      nodes: [],
      error: `No day node found for ${date}`,
    };
  }

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
        and(eq(edges.sourceNodeId, dayNodeId), eq(edges.targetNodeId, nodes.id)),
        and(eq(edges.targetNodeId, dayNodeId), eq(edges.sourceNodeId, nodes.id)),
      ),
    )
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(edges.userId, userId),
        eq(nodes.userId, userId),
        ne(nodes.id, dayNodeId),
      ),
    );

  const uniqueNodesMap = new Map<string, (typeof connectedNodes)[number]>();
  connectedNodes.forEach((node) => {
    if (!uniqueNodesMap.has(node.id)) uniqueNodesMap.set(node.id, node);
  });
  const uniqueConnectedNodes = Array.from(uniqueNodesMap.values());

  let formattedResult: string | undefined;
  if (includeFormattedResult && connectedNodes.length > 0) {
    const nodesByEdge = connectedNodes.reduce<Record<EdgeType, (typeof connectedNodes)[number][]>>(
      (acc, node) => {
        const type = (node.edgeType ?? "Unknown") as EdgeType;
        (acc[type] ??= []).push(node);
        return acc;
      },
      {} as Record<EdgeType, (typeof connectedNodes)[number][]>,
    );

    let formatted = `# Memories from ${date}\n\n`;
    for (const [edgeType, nodes] of Object.entries(nodesByEdge)) {
      formatted += `## ${edgeType}\n\n`;
      const map = new Map<string, (typeof connectedNodes)[number]>();
      nodes.forEach((n) => {
        if (!map.has(n.id)) map.set(n.id, n);
      });
      Array.from(map.values()).forEach((node) => {
        const label = node.metadata?.label ?? "Unnamed";
        const description = node.metadata?.description ?? "";
        formatted += `- **${label}**: ${description}\n`;
      });
      formatted += "\n";
    }
    formattedResult = formatted;
  }

  return {
    date,
    nodeCount: uniqueConnectedNodes.length,
    formattedResult,
    nodes: uniqueConnectedNodes,
  };
}
