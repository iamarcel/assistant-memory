import { and, eq } from "drizzle-orm";
import { DrizzleDB } from "~/db";
import { edges, nodes, sourceLinks, NodeSelect } from "~/db/schema";
import { EdgeTypeEnum, NodeType } from "~/types/graph";
import { TypeId } from "~/types/typeid";
import { ensureDayNode } from "../temporal";

interface EnsureSourceNodeParams {
  db: DrizzleDB;
  userId: string;
  sourceId: TypeId<"source">;
  timestamp: Date;
  nodeType: NodeType;
}

/**
 * Ensures a graph node of the specified type exists for a given source,
 * links it to the source, and connects it to a day node.
 * If the node already exists for this source, it's returned.
 * Otherwise, a new node is created and linked.
 * @returns The ID of the (existing or new) graph node.
 */
export async function ensureSourceNode({
  db,
  userId,
  sourceId,
  timestamp,
  nodeType,
}: EnsureSourceNodeParams): Promise<TypeId<"node">> {
  let graphNode: NodeSelect | undefined;

  // Check if a node of the given type is already linked to this source
  const existingNodeResult = await db
    .select({
      node: nodes,
    })
    .from(nodes)
    .innerJoin(sourceLinks, eq(sourceLinks.nodeId, nodes.id))
    .where(
      and(
        eq(nodes.userId, userId),
        eq(nodes.nodeType, nodeType),
        eq(sourceLinks.sourceId, sourceId),
      ),
    )
    .limit(1);

  graphNode = existingNodeResult[0]?.node;

  if (!graphNode) {
    // Create the graph node
    const [newNode] = await db
      .insert(nodes)
      .values({
        userId,
        nodeType,
        createdAt: timestamp,
      })
      .returning();

    if (!newNode) {
      throw new Error(`Failed to create ${nodeType} node for source ${sourceId}`);
    }

    // Link to source
    const [newSourceLink] = await db
      .insert(sourceLinks)
      .values({
        sourceId,
        nodeId: newNode.id,
      })
      .returning();

    if (!newSourceLink) {
      throw new Error(
        `Failed to create source link for ${nodeType} node ${newNode.id} and source ${sourceId}`,
      );
    }

    // Link to day node
    const dayNodeId = await ensureDayNode(db, userId, timestamp);
    await db
      .insert(edges)
      .values({
        userId,
        edgeType: EdgeTypeEnum.Enum.OCCURRED_ON,
        sourceNodeId: newNode.id,
        targetNodeId: dayNodeId,
      })
      .onConflictDoNothing(); 

    graphNode = newNode;
  }

  return graphNode.id;
}
