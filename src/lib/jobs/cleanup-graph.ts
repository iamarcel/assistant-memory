import { createCompletionClient } from "../ai";
import { generateAndInsertNodeEmbeddings } from "../embeddings-util";
import { findOneHopNodes, findSimilarNodes } from "../graph";
import { TemporaryIdMapper } from "../temporary-id-mapper";
import { sql, eq, gte, desc, and, inArray } from "drizzle-orm";
import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import { DrizzleDB } from "~/db";
import { nodes, edges, nodeMetadata, sourceLinks } from "~/db/schema";
import { EdgeTypeEnum, NodeTypeEnum } from "~/types/graph";
import type { EdgeType, NodeType } from "~/types/graph";
import { TypeId } from "~/types/typeid";
import { useDatabase } from "~/utils/db";

export const CleanupGraphJobInputSchema = z.object({
  userId: z.string(),
  since: z.coerce.date(),
  entryNodeLimit: z.number().int().positive().default(3),
  semanticNeighborLimit: z.number().int().positive().default(10),
  graphHopDepth: z.union([z.literal(1), z.literal(2)]).default(2),
  maxSubgraphNodes: z.number().int().positive().default(100),
  maxSubgraphEdges: z.number().int().positive().default(150),
  llmModelId: z.string(),
});

/**
 * Parameters for cleanup job
 */
export type CleanupGraphParams = z.infer<typeof CleanupGraphJobInputSchema>;

/**
 * Core graph types
 */
export interface GraphNode {
  id: TypeId<"node">;
  label: string;
  description: string;
  type: NodeType;
}

/**
 * Core graph types
 */
export interface GraphEdge {
  source: TypeId<"node">;
  target: TypeId<"node">;
  type: EdgeType;
  description?: string;
}
export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Temporary graph for LLM
 */
export interface TempNode extends GraphNode {
  tempId: string;
}
export interface TempEdge {
  sourceTemp: string;
  targetTemp: string;
  type: EdgeType;
  description: string;
}
export interface TempSubgraph {
  nodes: TempNode[];
  edges: TempEdge[];
}

export const CleanupProposalSchema = z.object({
  merges: z
    .array(
      z.object({
        keep: z.string().describe("Temp ID of node to keep"),
        remove: z.string().describe("Temp ID of node to merge/remove"),
      }),
    )
    .describe(
      "Pairs of temp node IDs to merge (remove into keep); use for nodes that are duplicates or should be merged",
    ),
  deletes: z
    .array(
      z.object({
        tempId: z.string().describe("Temp ID of node to delete"),
      }),
    )
    .describe("Temp node IDs to delete (if completely irrelevant)"),
  additions: z
    .array(
      z.object({
        source: z.string().describe("Temp ID of source node"),
        target: z.string().describe("Temp ID of target node"),
        type: EdgeTypeEnum.describe("Type of edge"),
      }),
    )
    .describe("New edges to add"),
  newNodes: z
    .array(
      z.object({
        tempId: z.string().describe("Temp ID for new node"),
        label: z.string().describe("Label for new node"),
        description: z.string().describe("Description for new node"),
        type: NodeTypeEnum.describe("Type of new node"),
      }),
    )
    .describe("New nodes to create"),
});

/**
 * Cleanup proposal from LLM
 */
export type CleanupProposal = z.infer<typeof CleanupProposalSchema>;

/**
 * Detailed result of cleanup execution
 */
export interface CleanupGraphResult {
  merged: Array<{
    keep: TypeId<"node">;
    keepLabel: string;
    keepDescription?: string;
    remove: TypeId<"node">;
    removeLabel: string;
    removeDescription?: string;
  }>;
  removed: Array<{
    nodeId: TypeId<"node">;
    label: string;
    description?: string;
  }>;
  addedEdges: Array<{
    source: TypeId<"node">;
    target: TypeId<"node">;
    type: EdgeType;
  }>;
  createdNodes: Array<{
    nodeId: TypeId<"node">;
    label: string;
    description?: string;
  }>;
}

/**
 * Orchestrator for graph cleanup
 */
export async function cleanupGraph(
  params: CleanupGraphParams,
): Promise<CleanupGraphResult> {
  const seedIds = await fetchEntryNodes(
    params.userId,
    params.since,
    params.entryNodeLimit,
  );
  const sub = await buildSubgraph(
    params.userId,
    seedIds,
    params.semanticNeighborLimit,
    params.graphHopDepth,
    params.maxSubgraphNodes,
    params.maxSubgraphEdges,
  );
  const { tempSubgraph, mapper } = toTempSubgraph(sub);
  const proposal = await proposeGraphCleanup(
    params.userId,
    tempSubgraph,
    params.llmModelId,
  );
  const db = await useDatabase();
  const result = await applyCleanupProposal(
    proposal,
    mapper,
    db,
    params.userId,
  );
  logCleanupSummary(params, result);
  return result;
}

/**
 * Step 1: select entry nodes
 */
async function fetchEntryNodes(
  userId: string,
  since: Date,
  limit: number,
): Promise<TypeId<"node">[]> {
  // Select nodes with highest edge count since given date
  const db = await useDatabase();
  const rows = await db
    .select({
      nodeId: edges.sourceNodeId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(edges)
    .where(and(eq(edges.userId, userId), gte(edges.createdAt, since)))
    .groupBy(edges.sourceNodeId)
    .orderBy(desc(sql`count`))
    .limit(limit);
  return rows.map((r) => r.nodeId);
}

/**
 * Step 2: expand to a subgraph
 */
async function buildSubgraph(
  userId: string,
  seedIds: TypeId<"node">[],
  semanticLimit: number,
  hopDepth: number,
  maxNodes: number,
  maxEdges: number,
): Promise<Subgraph> {
  const db = await useDatabase();
  // load seed metadata
  const seedMetaRows = await db
    .select({
      id: nodes.id,
      type: nodes.nodeType,
      label: nodeMetadata.label,
      description: nodeMetadata.description,
    })
    .from(nodes)
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(inArray(nodes.id, seedIds));
  // store nodes in insertion order
  const nodeMap = new Map<TypeId<"node">, GraphNode>();
  for (const r of seedMetaRows) {
    nodeMap.set(r.id, {
      id: r.id,
      label: r.label ?? "",
      description: r.description ?? "",
      type: r.type,
    });
  }
  // semantic neighbors (run in parallel)
  const seeds = Array.from(nodeMap.values());
  const neighborResults = await Promise.all(
    seeds.map((seed) =>
      findSimilarNodes({
        userId,
        text: `${seed.label}: ${seed.description}`,
        limit: semanticLimit,
        minimumSimilarity: 0.5,
      }),
    ),
  );
  for (const neighbors of neighborResults) {
    for (const n of neighbors) {
      if (!nodeMap.has(n.id)) {
        nodeMap.set(n.id, {
          id: n.id,
          label: n.label ?? "",
          description: n.description ?? "",
          type: n.type,
        });
      }
    }
  }
  const edgesList: GraphEdge[] = [];
  // Expand connections
  let currentIds = Array.from(nodeMap.keys());
  for (let hop = 1; hop <= hopDepth; hop++) {
    const conns = await findOneHopNodes(db, userId, currentIds);
    const nextIds: typeof currentIds = [];
    for (const c of conns) {
      if (!nodeMap.has(c.id)) {
        nodeMap.set(c.id, {
          id: c.id,
          label: c.label ?? "",
          description: c.description ?? "",
          type: c.type,
        });
        nextIds.push(c.id);
      }
      edgesList.push({
        source: c.edgeSourceId,
        target: c.edgeTargetId,
        type: c.edgeType,
        description: c.description ?? "",
      });
    }
    currentIds = nextIds;
    if (!currentIds.length) break;
  }
  // dedupe edges
  const unique: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of edgesList) {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }
  // trim nodes & edges, ensuring edges only reference kept nodes
  const nodesArr = Array.from(nodeMap.values()).slice(0, maxNodes);
  const nodeIdsSet = new Set(nodesArr.map((n) => n.id));
  const edgesArr = unique
    .filter((e) => nodeIdsSet.has(e.source) && nodeIdsSet.has(e.target))
    .slice(0, maxEdges);
  return { nodes: nodesArr, edges: edgesArr };
}

/**
 * Step 3: map to temporary IDs for LLM
 */
function toTempSubgraph(sub: Subgraph): {
  tempSubgraph: TempSubgraph;
  mapper: TemporaryIdMapper<GraphNode, string>;
} {
  const mapper = new TemporaryIdMapper<GraphNode, string>(
    (_item, idx) => `temp_node_${idx + 1}`,
  );
  const tempNodes = mapper.mapItems(sub.nodes);
  const tempEdges: TempEdge[] = sub.edges.map((e) => {
    const src = sub.nodes.find((n) => n.id === e.source)!;
    const tgt = sub.nodes.find((n) => n.id === e.target)!;
    return {
      sourceTemp: mapper.getId(src)!,
      targetTemp: mapper.getId(tgt)!,
      type: e.type,
      description: e.description ?? "",
    };
  });
  return { tempSubgraph: { nodes: tempNodes, edges: tempEdges }, mapper };
}

/**
 * Step 4: get cleanup proposal from LLM
 */
async function proposeGraphCleanup(
  userId: string,
  temp: TempSubgraph,
  modelId: string,
): Promise<CleanupProposal> {
  const client = await createCompletionClient(userId);
  const nodesList = temp.nodes
    .map(
      (n) =>
        `<node tempId="${n.tempId}" label="${n.label}" type="${n.type}">${n.description}</node>`,
    )
    .join("\n");
  const edgesList = temp.edges
    .map(
      (e) =>
        `<edge source="${e.sourceTemp}" target="${e.targetTemp}" type="${e.type}">${e.description}</edge>`,
    )
    .join("\n");
  const prompt = `You are a graph cleaning assistant. Given this subgraph, propose merges (pairs of temp IDs to merge), deletes (temp IDs to remove), additions (new edges), and any new nodes.
Nodes:
${nodesList}
Edges:
${edgesList}
`;
  const completion = await client.beta.chat.completions.parse({
    messages: [{ role: "user", content: prompt }],
    model: modelId,
    response_format: zodResponseFormat(
      CleanupProposalSchema,
      "CleanupProposal",
    ),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Failed to parse cleanup proposal");
  return parsed;
}

/**
 * Step 5: apply cleanup operations
 */
async function applyCleanupProposal(
  proposal: CleanupProposal,
  mapper: TemporaryIdMapper<GraphNode, string>,
  db: Awaited<ReturnType<typeof useDatabase>>,
  userId: string,
): Promise<CleanupGraphResult> {
  return db.transaction(async (tx) => {
    const merged: CleanupGraphResult["merged"] = [];
    const removed: CleanupGraphResult["removed"] = [];
    const addedEdges: CleanupGraphResult["addedEdges"] = [];
    const createdNodes: CleanupGraphResult["createdNodes"] = [];

    // Preprocessing: remap temp IDs for merges
    const remap = new Map<string, string>();
    for (const { keep, remove } of proposal.merges) {
      remap.set(remove, keep);
    }
    // Rewrite deletes with remapped IDs and dedupe
    const newDeletes = Array.from(
      new Set(proposal.deletes.map((d) => remap.get(d.tempId) ?? d.tempId)),
    ).map((tempId) => ({ tempId }));
    // Rewrite additions with remapped IDs, drop self-edges
    const newEdges = proposal.additions
      .map(({ source, target, type }) => ({
        source: remap.get(source) ?? source,
        target: remap.get(target) ?? target,
        type,
      }))
      .filter((e) => e.source !== e.target);
    // Keep newNodes as-is
    const newNodes = [...proposal.newNodes];

    // Step 1: Create new nodes
    for (const n of newNodes) {
      const inserted = await tx
        .insert(nodes)
        .values({ userId, nodeType: n.type })
        .returning({ id: nodes.id });
      const nodeId = inserted[0]?.id;
      if (!nodeId) continue;
      await tx
        .insert(nodeMetadata)
        .values({ nodeId, label: n.label, description: n.description });
      createdNodes.push({ nodeId, label: n.label, description: n.description });
    }

    // Step 2: Merges
    for (const m of proposal.merges) {
      const keepNode = mapper.getItem(m.keep);
      const removeNode = mapper.getItem(m.remove);
      if (!keepNode || !removeNode) continue;
      const keepId = keepNode.id;
      const removeId = removeNode.id;
      await rewireNodeEdges(tx, removeId, keepId, userId);
      await rewireSourceLinks(tx, removeId, keepId);
      await deleteNode(tx, removeId, userId);
      const keepInfo = mapper.getItem(keepId);
      const removeInfo = mapper.getItem(removeId);
      merged.push({
        keep: keepId,
        keepLabel: keepInfo?.label ?? "",
        keepDescription: keepInfo?.description ?? "",
        remove: removeId,
        removeLabel: removeInfo?.label ?? "",
        removeDescription: removeInfo?.description ?? "",
      });
    }

    // Step 3: Additions
    for (const e of newEdges) {
      const src = mapper.getItem(e.source);
      const tgt = mapper.getItem(e.target);
      if (!src || !tgt) continue;
      await tx
        .insert(edges)
        .values({
          userId,
          sourceNodeId: src.id,
          targetNodeId: tgt.id,
          edgeType: e.type,
          metadata: {},
        })
        .onConflictDoNothing({
          target: [edges.sourceNodeId, edges.targetNodeId],
        });
      addedEdges.push({ source: src.id, target: tgt.id, type: e.type });
    }

    // Step 4: Deletes
    for (const d of newDeletes) {
      const node = mapper.getItem(d.tempId);
      if (!node) continue;
      const id = node.id;
      await deleteNode(tx, id, userId);
      const info = mapper.getItem(id);
      removed.push({
        nodeId: id,
        label: info?.label ?? "",
        description: info?.description ?? "",
      });
    }

    // Generate embeddings for all created nodes with labels
    await generateAndInsertNodeEmbeddings(
      tx,
      createdNodes
        .filter((node) => node.label)
        .map((node) => ({
          id: node.nodeId,
          label: node.label,
          description: node.description,
        })),
    );

    return { merged, removed, addedEdges, createdNodes };
  });
}

/**
 * Rewire edges from removeId to keepId for a given user
 */
async function rewireNodeEdges(
  tx: DrizzleDB,
  removeId: TypeId<"node">,
  keepId: TypeId<"node">,
  userId: string,
) {
  // Out-going edges
  const outEdges = await tx
    .select()
    .from(edges)
    .where(and(eq(edges.sourceNodeId, removeId), eq(edges.userId, userId)));
  for (const edge of outEdges) {
    await tx
      .insert(edges)
      .values({
        userId: edge.userId,
        sourceNodeId: keepId,
        targetNodeId: edge.targetNodeId,
        edgeType: edge.edgeType,
        metadata: edge.metadata,
      })
      .onConflictDoNothing({
        target: [edges.sourceNodeId, edges.targetNodeId],
      });
  }
  await tx
    .delete(edges)
    .where(and(eq(edges.sourceNodeId, removeId), eq(edges.userId, userId)));
  // In-coming edges
  const inEdges = await tx
    .select()
    .from(edges)
    .where(and(eq(edges.targetNodeId, removeId), eq(edges.userId, userId)));
  for (const edge of inEdges) {
    await tx
      .insert(edges)
      .values({
        userId: edge.userId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: keepId,
        edgeType: edge.edgeType,
        metadata: edge.metadata,
      })
      .onConflictDoNothing({
        target: [edges.sourceNodeId, edges.targetNodeId],
      });
  }
  await tx
    .delete(edges)
    .where(and(eq(edges.targetNodeId, removeId), eq(edges.userId, userId)));
}

/**
 * Rewire source_links entries from removeId to keepId
 */
async function rewireSourceLinks(
  tx: DrizzleDB,
  removeId: TypeId<"node">,
  keepId: TypeId<"node">,
) {
  const links = await tx
    .select()
    .from(sourceLinks)
    .where(eq(sourceLinks.nodeId, removeId));
  for (const link of links) {
    await tx
      .insert(sourceLinks)
      .values({ ...link, id: undefined, nodeId: keepId })
      .onConflictDoNothing({
        target: [sourceLinks.sourceId, sourceLinks.nodeId],
      });
  }
  await tx.delete(sourceLinks).where(eq(sourceLinks.nodeId, removeId));
}

/**
 * Delete a node for a given user; cascades remove related data
 */
async function deleteNode(
  tx: DrizzleDB,
  nodeId: TypeId<"node">,
  userId: string,
) {
  await tx
    .delete(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.userId, userId)));
}

/**
 * Step 6: logging summary
 */
function logCleanupSummary(
  params: CleanupGraphParams,
  result: CleanupGraphResult,
): void {
  console.info(
    `[CLEANUP] user=${params.userId} seeds=${params.entryNodeLimit} hops=${params.graphHopDepth} ` +
      `merged=${result.merged.length} removed=${result.removed.length} ` +
      `addedEdges=${result.addedEdges.length} createdNodes=${result.createdNodes.length}`,
  );
}

// Logs a human-readable overview of the LLM cleanup proposal using the mapper
export function logProposalOverview(
  proposal: CleanupProposal,
  mapper: TemporaryIdMapper<GraphNode, string>,
): void {
  console.log("=== Graph Cleanup Proposal Overview ===");

  if (proposal.merges.length) {
    console.log("Merges:");
    proposal.merges.forEach(({ keep, remove }) => {
      const keepNode = mapper.getItem(keep);
      const removeNode = mapper.getItem(remove);
      console.log(
        ` - Merge: ${keep} (${keepNode?.label || ""} / ${keepNode?.description || ""}) <- ${remove} (${removeNode?.label || ""} / ${removeNode?.description || ""})`,
      );
    });
  }

  if (proposal.deletes.length) {
    console.log("Deletes:");
    proposal.deletes.forEach(({ tempId }) => {
      const node = mapper.getItem(tempId);
      console.log(
        ` - Delete: ${tempId} (${node?.label || ""} / ${node?.description || ""})`,
      );
    });
  }

  if (proposal.additions.length) {
    console.log("Additions:");
    proposal.additions.forEach(({ source, target, type }) => {
      const sNode = mapper.getItem(source);
      const tNode = mapper.getItem(target);
      console.log(
        ` - Add Edge: ${sNode?.label || ""} -> ${tNode?.label || ""} (${type})`,
      );
    });
  }

  if (proposal.newNodes.length) {
    console.log("New Nodes:");
    proposal.newNodes.forEach(({ tempId, label, description, type }) => {
      console.log(
        ` - New Node: ${tempId}: ${label} (${type}) - ${description || ""}`,
      );
    });
  }
}
