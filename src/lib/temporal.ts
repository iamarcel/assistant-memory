import { generateEmbeddings } from "./embeddings";
import { format, startOfDay, endOfDay } from "date-fns";
import { and, eq, gte, lte } from "drizzle-orm";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "~/db/schema";
import { nodeEmbeddings, nodeMetadata, nodes } from "~/db/schema";
import { NodeTypeEnum } from "~/types/graph";
import { type TypeId } from "~/types/typeid";

type Database = NodePgDatabase<typeof schema>;

/**
 * Ensures a Temporal node representing the given date exists for the user,
 * creating one if necessary.
 * Finds the node based on the createdAt timestamp falling within the target day.
 *
 * @param db The Drizzle database instance.
 * @param userId The ID of the user.
 * @param targetDate The date for which to ensure a node exists (defaults to today).
 * @returns The TypeId of the existing or newly created day node.
 * @throws Error if embedding generation fails or database insertion fails.
 */
export async function ensureDayNode(
  db: Database,
  userId: TypeId<"user">,
  targetDate: Date = new Date(),
): Promise<TypeId<"node">> {
  const dateLabel = format(targetDate, "yyyy-MM-dd");
  const dayStart = startOfDay(targetDate);
  const dayEnd = endOfDay(targetDate);

  const existingDayNode = await db.query.nodes.findFirst({
    where: and(
      eq(nodes.userId, userId),
      eq(nodes.nodeType, NodeTypeEnum.enum.Temporal),
      gte(nodes.createdAt, dayStart),
      lte(nodes.createdAt, dayEnd),
    ),
    columns: { id: true },
  });

  if (existingDayNode) {
    return existingDayNode.id;
  }

  const nodeDescription = `Represents the day ${dateLabel}`;

  const embeddingContent = `${dateLabel}: ${nodeDescription}`;
  const embeddingsResult = await generateEmbeddings({
    input: [embeddingContent],
    model: "jina-embeddings-v3",
  });

  if (
    !embeddingsResult ||
    !Array.isArray(embeddingsResult.data) ||
    embeddingsResult.data.length === 0 ||
    !embeddingsResult.data[0] ||
    !embeddingsResult.data[0].embedding
  ) {
    throw new Error(
      `Failed to generate valid embedding for day node: ${dateLabel}`,
    );
  }
  const nodeEmbedding = embeddingsResult.data[0].embedding;

  try {
    const [insertedNode] = await db
      .insert(nodes)
      .values({
        userId,
        nodeType: NodeTypeEnum.enum.Temporal,
      })
      .returning({ id: nodes.id });

    if (!insertedNode) {
      throw new Error(
        `Failed to retrieve ID after inserting day node: ${dateLabel}`,
      );
    }

    const actualNodeId = insertedNode.id;

    await db.transaction(async (tx) => {
      await tx.insert(nodeMetadata).values({
        nodeId: actualNodeId,
        label: dateLabel,
        description: nodeDescription,
      });
      await tx.insert(nodeEmbeddings).values({
        nodeId: actualNodeId,
        embedding: nodeEmbedding,
        modelName: "jina-embeddings-v3",
      });
    });

    return actualNodeId;
  } catch (error) {
    console.error(`Failed to create day node ${dateLabel}:`, error);
    throw new Error(`Database operation failed for day node ${dateLabel}`);
  }
}
