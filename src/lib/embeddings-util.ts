import { generateEmbeddings } from "./embeddings";
import { DrizzleDB } from "~/db";
import { nodeEmbeddings, edgeEmbeddings } from "~/db/schema";
import type { EdgeType } from "~/types/graph";
import { TypeId } from "~/types/typeid";

export interface EmbeddableNode {
  id: TypeId<"node">;
  label: string;
  description?: string | null | undefined;
}

export interface EmbeddableEdge {
  edgeId: TypeId<"edge">;
  edgeType: EdgeType;
  description?: string | null | undefined;
  sourceLabel: string;
  targetLabel: string;
}

/**
 * Given an array of nodes with label/description, generates and inserts embeddings for each.
 * Throws if the number of returned embeddings does not match input length.
 * Skips nodes with missing label.
 */
export async function generateAndInsertNodeEmbeddings(
  db: DrizzleDB,
  nodes: EmbeddableNode[],
) {
  const validNodes = nodes.filter((n) => n.label && n.label.trim().length > 0);
  if (validNodes.length === 0) return;

  const embeddingInputs = validNodes.map(
    (n) => `${n.label}: ${n.description ?? ""}`,
  );

  const embeddings = await generateEmbeddings({
    model: "jina-embeddings-v3",
    task: "retrieval.passage",
    input: embeddingInputs,
    truncate: true,
  });

  if (embeddings.data.length !== validNodes.length) {
    throw new Error("Failed to generate embeddings for all nodes");
  }

  for (let i = 0; i < validNodes.length; i++) {
    const embedding = embeddings.data[i]?.embedding;
    if (!embedding) {
      console.warn(`No embedding generated for node: ${validNodes[i]!.label}`);
      continue;
    }
    await db.insert(nodeEmbeddings).values({
      nodeId: validNodes[i]!.id,
      embedding,
      modelName: "jina-embeddings-v3",
    });
  }
}

/**
 * Given an array of edges with descriptions, generates and inserts embeddings for each.
 * Skips edges with missing descriptions.
 */
export async function generateAndInsertEdgeEmbeddings(
  db: DrizzleDB,
  edges: EmbeddableEdge[],
) {
  const validEdges = edges.filter((e) => e.description?.trim());
  if (validEdges.length === 0) return;

  const embeddingInputs = validEdges.map(
    (e) => `${e.sourceLabel} ${e.edgeType} ${e.targetLabel}: ${e.description}`,
  );

  const embeddings = await generateEmbeddings({
    model: "jina-embeddings-v3",
    task: "retrieval.passage",
    input: embeddingInputs,
    truncate: true,
  });

  if (embeddings.data.length !== validEdges.length) {
    throw new Error("Failed to generate embeddings for all edges");
  }

  for (let i = 0; i < validEdges.length; i++) {
    const embedding = embeddings.data[i]?.embedding;
    if (!embedding) {
      console.warn(
        `No embedding generated for edge: ${validEdges[i]!.edgeId} (${validEdges[i]!.edgeType})`,
      );
      continue;
    }
    await db.insert(edgeEmbeddings).values({
      edgeId: validEdges[i]!.edgeId,
      embedding,
      modelName: "jina-embeddings-v3",
    });
  }
}
