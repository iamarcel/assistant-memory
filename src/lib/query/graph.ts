import { and, aliasedTable, eq, inArray, isNotNull } from "drizzle-orm";
import { generateEmbeddings } from "../embeddings";
import { findOneHopNodes, findSimilarNodes } from "../graph";
import {
  QueryGraphRequest,
  QueryGraphResponse,
} from "../schemas/query-graph";
import { nodes, nodeMetadata, edges } from "~/db/schema";
import type { EdgeType, NodeType } from "~/types/graph";
import type { TypeId } from "~/types/typeid";
import { useDatabase } from "~/utils/db";

interface GraphNodeResult {
  id: TypeId<"node">;
  nodeType: NodeType;
  label: string;
  description: string | null;
}

interface GraphEdgeResult {
  source: TypeId<"node">;
  target: TypeId<"node">;
  edgeType: EdgeType;
  description: string | null;
}

export async function queryKnowledgeGraph(
  params: QueryGraphRequest,
): Promise<QueryGraphResponse> {
  const { userId, query, maxNodes } = params;
  const db = await useDatabase();

  // If no query -> return full labeled graph
  if (!query) {
    const nodeRows = await db
      .select({
        id: nodes.id,
        nodeType: nodes.nodeType,
        label: nodeMetadata.label,
        description: nodeMetadata.description,
      })
      .from(nodes)
      .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
      .where(and(eq(nodes.userId, userId), isNotNull(nodeMetadata.label)));

    const nodeIds = nodeRows.map((n) => n.id);

    if (nodeIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    const src = aliasedTable(nodeMetadata, "src");
    const tgt = aliasedTable(nodeMetadata, "tgt");
    const edgeRows = await db
      .select({
        source: edges.sourceNodeId,
        target: edges.targetNodeId,
        edgeType: edges.edgeType,
        description: edges.description,
      })
      .from(edges)
      .innerJoin(src, eq(src.nodeId, edges.sourceNodeId))
      .innerJoin(tgt, eq(tgt.nodeId, edges.targetNodeId))
      .where(
        and(
          eq(edges.userId, userId),
          inArray(edges.sourceNodeId, nodeIds),
          inArray(edges.targetNodeId, nodeIds),
          isNotNull(src.label),
          isNotNull(tgt.label),
        ),
      );

    return { nodes: nodeRows, edges: edgeRows };
  }

  // Query-based subgraph
  const emb = await generateEmbeddings({
    model: "jina-embeddings-v3",
    task: "retrieval.query",
    input: [query],
    truncate: true,
  });
  const embedding = emb.data[0]?.embedding;
  if (!embedding) throw new Error("Failed to generate embedding");

  const seeds = (
    await findSimilarNodes({
      userId,
      embedding,
      limit: Math.min(maxNodes, 5),
      minimumSimilarity: 0.4,
    })
  ).filter((n) => n.label);

  const nodeMap = new Map<TypeId<"node">, GraphNodeResult>();
  seeds.forEach((s) => {
    nodeMap.set(s.id, {
      id: s.id,
      nodeType: s.type,
      label: s.label ?? "",
      description: s.description,
    });
  });

  let currentIds = seeds.map((s) => s.id);
  while (nodeMap.size < maxNodes && currentIds.length) {
    const conns = await findOneHopNodes(db, userId, currentIds);
    const nextIds: TypeId<"node">[] = [];
    for (const c of conns) {
      if (!nodeMap.has(c.id) && nodeMap.size < maxNodes) {
        nodeMap.set(c.id, {
          id: c.id,
          nodeType: c.type,
          label: c.label ?? "",
          description: c.description,
        });
        nextIds.push(c.id);
      }
    }
    currentIds = nextIds;
  }

  const nodeIds = Array.from(nodeMap.keys());
  if (nodeIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  const src = aliasedTable(nodeMetadata, "srcMeta");
  const tgt = aliasedTable(nodeMetadata, "tgtMeta");
  const edgeRows = await db
    .select({
      source: edges.sourceNodeId,
      target: edges.targetNodeId,
      edgeType: edges.edgeType,
      description: edges.description,
    })
    .from(edges)
    .innerJoin(src, eq(src.nodeId, edges.sourceNodeId))
    .innerJoin(tgt, eq(tgt.nodeId, edges.targetNodeId))
    .where(
      and(
        eq(edges.userId, userId),
        inArray(edges.sourceNodeId, nodeIds),
        inArray(edges.targetNodeId, nodeIds),
        isNotNull(src.label),
        isNotNull(tgt.label),
      ),
    );

  return { nodes: Array.from(nodeMap.values()), edges: edgeRows };
}
