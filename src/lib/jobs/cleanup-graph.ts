import { createCompletionClient } from "../ai";
import { generateAndInsertNodeEmbeddings } from "../embeddings-util";
import { findSimilarNodes, findOneHopConnections } from "../search";
import { TemporaryIdMapper } from "../temporary-id-mapper";
import { sql, eq, gte, desc, and, inArray } from "drizzle-orm";
import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import { nodes, edges, nodeMetadata } from "~/db/schema";
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
export interface GraphNode {
  id: TypeId<"node">;
  label: string;
  description: string;
  type: NodeType;
}
export interface GraphEdge {
  source: TypeId<"node">;
  target: TypeId<"node">;
  type: EdgeType;
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
        similarityThreshold: 0.5,
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
    const conns = await findOneHopConnections(db, userId, currentIds);
    const nextIds: typeof currentIds = [];
    for (const c of conns) {
      if (!nodeMap.has(c.nodeId)) {
        nodeMap.set(c.nodeId, {
          id: c.nodeId,
          label: c.label ?? "",
          description: c.description ?? "",
          type: c.nodeType,
        });
        nextIds.push(c.nodeId);
      }
      edgesList.push({
        source: c.sourceId,
        target: c.targetId,
        type: c.edgeType,
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
        `<edge source="${e.sourceTemp}" target="${e.targetTemp}" type="${e.type}"></edge>`,
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
    // merges: rewire edges then delete nodes
    for (const m of proposal.merges) {
      const keepNode = mapper.getItem(m.keep);
      const removeNode = mapper.getItem(m.remove);
      if (!keepNode || !removeNode) continue;
      const keepId = keepNode.id;
      const removeId = removeNode.id;
      // rewire edges (only for this user), avoid unique constraint errors
      // Upsert: if (keepId, targetId) or (sourceId, keepId) already exists, skip
      // Out-edges
      const outEdges = await tx
        .select()
        .from(edges)
        .where(and(eq(edges.sourceNodeId, removeId), eq(edges.userId, userId)));
      for (const edge of outEdges) {
        await tx
          .insert(edges)
          .values({
            ...edge,
            id: undefined,
            sourceNodeId: keepId,
          })
          .onConflictDoNothing({
            target: [edges.sourceNodeId, edges.targetNodeId],
          });
      }
      await tx
        .delete(edges)
        .where(and(eq(edges.sourceNodeId, removeId), eq(edges.userId, userId)));
      // In-edges
      const inEdges = await tx
        .select()
        .from(edges)
        .where(and(eq(edges.targetNodeId, removeId), eq(edges.userId, userId)));
      for (const edge of inEdges) {
        await tx
          .insert(edges)
          .values({
            ...edge,
            id: undefined,
            targetNodeId: keepId,
          })
          .onConflictDoNothing({
            target: [edges.sourceNodeId, edges.targetNodeId],
          });
      }
      await tx
        .delete(edges)
        .where(and(eq(edges.targetNodeId, removeId), eq(edges.userId, userId)));
      // Only delete the node; cascading will handle metadata, embeddings, and edges
      await tx
        .delete(nodes)
        .where(and(eq(nodes.id, removeId), eq(nodes.userId, userId)));
      // Retrieve labels/descriptions for debugging from mapper
      const keepNodeInfo = mapper.getItem(keepId);
      const removeNodeInfo = mapper.getItem(removeId);
      const item: CleanupGraphResult["merged"][0] = {
        keep: keepId,
        keepLabel: keepNodeInfo?.label ?? "",
        keepDescription: keepNodeInfo?.description ?? "",
        remove: removeId,
        removeLabel: removeNodeInfo?.label ?? "",
        removeDescription: removeNodeInfo?.description ?? "",
      };
      merged.push(item);
    }

    const removed: CleanupGraphResult["removed"] = [];
    for (const d of proposal.deletes) {
      const node = mapper.getItem(d.tempId);
      if (!node) continue;
      const nodeId = node.id;
      // Only delete the node; cascading will handle metadata, embeddings, and edges
      await tx
        .delete(nodes)
        .where(and(eq(nodes.id, nodeId), eq(nodes.userId, userId)));
      // Retrieve label/description for debugging from mapper
      const nodeInfo = mapper.getItem(nodeId);
      const rem: CleanupGraphResult["removed"][0] = {
        nodeId,
        label: nodeInfo?.label ?? "",
        description: nodeInfo?.description ?? "",
      };
      removed.push(rem);
    }

    const addedEdges: CleanupGraphResult["addedEdges"] = [];
    for (const e of proposal.additions) {
      const srcNode = mapper.getItem(e.source);
      const tgtNode = mapper.getItem(e.target);
      if (!srcNode || !tgtNode) continue;
      await tx
        .insert(edges)
        .values({
          userId,
          sourceNodeId: srcNode.id,
          targetNodeId: tgtNode.id,
          edgeType: e.type,
          metadata: {},
        })
        .onConflictDoNothing({
          target: [edges.sourceNodeId, edges.targetNodeId],
        });
      addedEdges.push({ source: srcNode.id, target: tgtNode.id, type: e.type });
    }

    const createdNodes: CleanupGraphResult["createdNodes"] = [];
    // Create new nodes from proposal
    for (const n of proposal.newNodes) {
      // Insert node
      const inserted = await tx
        .insert(nodes)
        .values({
          userId,
          nodeType: n.type,
        })
        .returning({ id: nodes.id });
      const nodeId = inserted[0]?.id;
      if (!nodeId) continue;
      await tx
        .insert(nodeMetadata)
        .values({ nodeId, label: n.label, description: n.description });
      createdNodes.push({ nodeId, label: n.label, description: n.description });
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
