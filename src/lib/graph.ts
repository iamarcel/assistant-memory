import {
  sql,
  eq,
  desc,
  cosineDistance,
  and,
  or,
  inArray,
  isNotNull,
  not,
} from "drizzle-orm";
import { DrizzleDB } from "~/db";
import { nodes, nodeMetadata, nodeEmbeddings, edges } from "~/db/schema";
import { generateEmbeddings } from "~/lib/embeddings";
import { formatAsMarkdown } from "~/lib/formatting";
import { type NodeType, type EdgeType, NodeTypeEnum } from "~/types/graph";
import type { TypeId } from "~/types/typeid";
import { useDatabase } from "~/utils/db";

/** Node metadata with similarity */
export interface NodeSearchResult {
  id: TypeId<"node">;
  type: NodeType;
  label: string | null;
  description: string | null;
  similarity: number;
}

/** One-hop edge plus neighbor metadata */
export interface ConnectionRecord {
  sourceId: TypeId<"node">;
  targetId: TypeId<"node">;
  edgeType: EdgeType;
  nodeId: TypeId<"node">;
  nodeType: NodeType;
  label: string | null;
  description: string | null;
}

/** Node enriched with connections */
export interface NodeWithConnections {
  id: TypeId<"node">;
  type: NodeType;
  label: string;
  description: string | null;
  similarity?: number;
  isDirectMatch?: boolean;
  connectedTo?: TypeId<"node">[];
}

/** Combined search and graph results */
export interface GraphResults {
  directMatches: NodeWithConnections[];
  connectedNodes: NodeWithConnections[];
  allNodes: NodeWithConnections[];
}

/** Options for semantic search */
export interface FindSimilarNodesOptions {
  userId: string;
  text: string;
  limit?: number;
  /** Minimum similarity score (0-1) filter */
  similarityThreshold?: number;
}

// Internal helper to get an embedding
async function generateTextEmbedding(text: string): Promise<number[]> {
  const res = await generateEmbeddings({
    model: "jina-embeddings-v3",
    task: "retrieval.query",
    input: [text],
    truncate: true,
  });
  const embedding = res.data[0]?.embedding;
  if (!embedding) throw new Error("Failed to generate embedding");
  return embedding;
}

/** Semantic search via embeddings */
export async function findSimilarNodes(
  opts: FindSimilarNodesOptions,
): Promise<NodeSearchResult[]> {
  const { userId, text, limit = 10, similarityThreshold } = opts;
  const emb = await generateTextEmbedding(text);
  const similarity = sql<number>`1 - (${cosineDistance(nodeEmbeddings.embedding, emb)})`;
  const db = await useDatabase();
  // Combine base and optional threshold conditions
  const baseCondition = and(
    eq(nodes.userId, userId),
    sql`${similarity} IS NOT NULL`,
  );
  const whereCondition =
    similarityThreshold != null
      ? and(baseCondition, sql`${similarity} >= ${similarityThreshold}`)
      : baseCondition;
  return db
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
    .where(whereCondition)
    .orderBy(desc(similarity))
    .limit(limit);
}

/** One-hop neighbor lookup */
export async function findOneHopConnections(
  db: DrizzleDB,
  userId: string,
  nodeIds: TypeId<"node">[],
  onlyWithLabels = true,
): Promise<ConnectionRecord[]> {
  if (nodeIds.length === 0) return [];
  const sub = db
    .select({
      sourceId: edges.sourceNodeId,
      targetId: edges.targetNodeId,
      edgeType: edges.edgeType,
      nodeId: sql<
        TypeId<"node">
      >`CASE WHEN ${inArray(edges.sourceNodeId, nodeIds)} THEN ${edges.targetNodeId} ELSE ${edges.sourceNodeId} END`.as(
        "nodeId",
      ),
    })
    .from(edges)
    .where(
      and(
        eq(edges.userId, userId),
        or(
          inArray(edges.sourceNodeId, nodeIds),
          inArray(edges.targetNodeId, nodeIds),
        ),
      ),
    )
    .as("e");

  return db
    .selectDistinctOn([nodes.id], {
      sourceId: sub.sourceId,
      targetId: sub.targetId,
      edgeType: sub.edgeType,
      nodeId: nodes.id,
      nodeType: nodes.nodeType,
      label: nodeMetadata.label,
      description: nodeMetadata.description,
    })
    .from(sub)
    .innerJoin(nodes, eq(nodes.id, sub.nodeId))
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        not(inArray(nodes.id, nodeIds)),
        onlyWithLabels ? isNotNull(nodeMetadata.label) : undefined,
      ),
    )
    .orderBy(nodes.id)
    .limit(50);
}

/** Merge matches and neighbors */
export function processSearchResultsWithConnections(
  direct: NodeSearchResult[],
  neighbors: ConnectionRecord[],
): GraphResults {
  const directMatches: NodeWithConnections[] = direct.map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label ?? "",
    description: n.description,
    similarity: n.similarity,
    isDirectMatch: true,
    connectedTo: [],
  }));
  const linkMap = new Map<TypeId<"node">, Set<TypeId<"node">>>();
  directMatches.forEach((d) => linkMap.set(d.id, new Set()));
  const connectedMap = new Map<TypeId<"node">, NodeWithConnections>();
  for (const c of neighbors) {
    const isSrc = linkMap.has(c.sourceId);
    const src = isSrc ? c.sourceId : c.targetId;
    const other = isSrc ? c.targetId : c.sourceId;
    if (linkMap.has(other)) continue;
    linkMap.get(src)!.add(other);
    connectedMap.set(other, {
      id: other,
      type: c.nodeType,
      label: c.label ?? "",
      description: c.description,
      isDirectMatch: false,
      connectedTo: [src],
    });
  }
  directMatches.forEach(
    (d) => (d.connectedTo = Array.from(linkMap.get(d.id)!)),
  );
  const connectedNodes = Array.from(connectedMap.values());
  return {
    directMatches,
    connectedNodes,
    allNodes: [...directMatches, ...connectedNodes],
  };
}

/** Helper to fetch the Temporal day node id for a given userId and date */
export async function findDayNode(
  db: DrizzleDB,
  userId: string,
  date: string,
): Promise<TypeId<"node"> | null> {
  const [day] = await db
    .select({ id: nodes.id })
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
  return day?.id ?? null;
}

// Formatting helper
export { formatAsMarkdown };
