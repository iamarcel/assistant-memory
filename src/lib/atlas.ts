import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "~/db/schema";
import { nodes, nodeMetadata, edges } from "~/db/schema";
import { NodeTypeEnum, EdgeTypeEnum } from "~/types/graph";
import { type TypeId } from "~/types/typeid";

// Database instance type
type Database = NodePgDatabase<typeof schema>;

/**
 * Ensures a single Atlas node (and its metadata) exists for the user.
 * Returns the node ID.
 */
export async function ensureAtlasNode(
  db: Database,
  userId: string,
): Promise<TypeId<"node">> {
  // Check for existing atlas node
  const [existing] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(nodes.userId, userId),
        eq(nodes.nodeType, NodeTypeEnum.enum.Atlas),
        eq(nodeMetadata.label, "Atlas"),
      ),
    )
    .limit(1);

  if (existing) {
    return existing.id;
  }

  // Create new atlas node
  const [inserted] = await db
    .insert(nodes)
    .values({ userId, nodeType: NodeTypeEnum.enum.Atlas })
    .returning({ id: nodes.id });

  if (!inserted) {
    throw new Error("Failed to create atlas node");
  }

  const atlasNodeId = inserted.id;
  // Initialize metadata for atlas
  await db.insert(nodeMetadata).values({
    nodeId: atlasNodeId,
    label: "Atlas",
    description: "",
  });

  return atlasNodeId;
}

/**
 * Fetches the current atlas metadata for the user.
 * Ensures the atlas node exists.
 */
export async function getAtlas(
  db: Database,
  userId: string,
): Promise<{
  nodeId: TypeId<"node">;
  label: string | null;
  description: string | null;
}> {
  const atlasNodeId = await ensureAtlasNode(db, userId);
  const [meta] = await db
    .select({
      label: nodeMetadata.label,
      description: nodeMetadata.description,
    })
    .from(nodeMetadata)
    .where(eq(nodeMetadata.nodeId, atlasNodeId))
    .limit(1);

  return {
    nodeId: atlasNodeId,
    label: meta?.label ?? null,
    description: meta?.description ?? null,
  };
}

/**
 * Updates the atlas metadata for the user with new description.
 */
export async function updateAtlas(
  db: Database,
  userId: string,
  newDescription: string,
): Promise<void> {
  const atlasNodeId = await ensureAtlasNode(db, userId);
  await db
    .update(nodeMetadata)
    .set({ description: newDescription })
    .where(eq(nodeMetadata.nodeId, atlasNodeId));
}

// Assistant-specific atlas utilities
/** Ensures a Person node for the assistant exists (label=assistantId) */
export async function ensureAssistantEntity(
  db: Database,
  userId: string,
  assistantId: string,
): Promise<TypeId<"node">> {
  const [existing] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(nodes.userId, userId),
        eq(nodes.nodeType, NodeTypeEnum.enum.Person),
        eq(nodeMetadata.label, assistantId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(nodes)
    .values({ userId, nodeType: NodeTypeEnum.enum.Person })
    .returning({ id: nodes.id });
  if (!inserted) throw new Error("Failed to create assistant entity");
  const assistantNodeId = inserted.id;
  await db
    .insert(nodeMetadata)
    .values({ nodeId: assistantNodeId, label: assistantId, description: "" });
  return assistantNodeId;
}

/** Ensures an assistant-specific Atlas node (label=assistantId) exists and links it */
export async function ensureAssistantAtlasNode(
  db: Database,
  userId: string,
  assistantId: string,
): Promise<TypeId<"node">> {
  const assistantNodeId = await ensureAssistantEntity(db, userId, assistantId);
  const [existing] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(nodes.userId, userId),
        eq(nodes.nodeType, NodeTypeEnum.enum.Atlas),
        eq(nodeMetadata.label, assistantId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(nodes)
    .values({ userId, nodeType: NodeTypeEnum.enum.Atlas })
    .returning({ id: nodes.id });
  if (!inserted) throw new Error("Failed to create assistant atlas");
  const atlasNodeId = inserted.id;
  await db
    .insert(nodeMetadata)
    .values({ nodeId: atlasNodeId, label: assistantId, description: "" });
  await db
    .insert(edges)
    .values({
      userId,
      sourceNodeId: atlasNodeId,
      targetNodeId: assistantNodeId,
      edgeType: EdgeTypeEnum.enum.OWNED_BY,
    });
  return atlasNodeId;
}

/** Fetches the assistant-specific atlas metadata */
export async function getAssistantAtlas(
  db: Database,
  userId: string,
  assistantId: string,
): Promise<{
  nodeId: TypeId<"node">;
  label: string | null;
  description: string | null;
}> {
  const atlasNodeId = await ensureAssistantAtlasNode(db, userId, assistantId);
  const [meta] = await db
    .select({
      label: nodeMetadata.label,
      description: nodeMetadata.description,
    })
    .from(nodeMetadata)
    .where(eq(nodeMetadata.nodeId, atlasNodeId))
    .limit(1);
  return {
    nodeId: atlasNodeId,
    label: meta?.label ?? null,
    description: meta?.description ?? null,
  };
}

/** Updates the assistant-specific atlas metadata */
export async function updateAssistantAtlas(
  db: Database,
  userId: string,
  assistantId: string,
  newDescription: string,
): Promise<void> {
  const atlasNodeId = await ensureAssistantAtlasNode(db, userId, assistantId);
  await db
    .update(nodeMetadata)
    .set({ description: newDescription })
    .where(eq(nodeMetadata.nodeId, atlasNodeId));
}
