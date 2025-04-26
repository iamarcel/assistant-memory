import { subDays } from "date-fns";
import { and, eq, gte } from "drizzle-orm";
import { DrizzleDB } from "~/db";
import { nodes, nodeMetadata } from "~/db/schema";
import { formatLabelDescList } from "~/lib/formatting";
import { NodeTypeEnum } from "~/types/graph";

/**
 * Fetches and formats conversation summaries for the user of the last 24 hours.
 */
export async function fetchDailyConversationsList(
  db: DrizzleDB,
  userId: string,
): Promise<string> {
  const from = subDays(new Date(), 1);
  const convs = await db
    .select({ title: nodeMetadata.label, summary: nodeMetadata.description })
    .from(nodes)
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(nodes.userId, userId),
        eq(nodes.nodeType, NodeTypeEnum.enum.Conversation),
        gte(nodes.createdAt, from),
      ),
    );
  return formatLabelDescList(
    convs.map((n) => ({ label: n.title, description: n.summary })),
  );
}
