import { defineEventHandler } from "h3";
import { z } from "zod";
import { findDayNode, findOneHopConnections } from "~/lib/graph";
import { NodeTypeEnum } from "~/types/graph";
import { useDatabase } from "~/utils/db";

const nodeTypeRequestSchema = z.object({
  userId: z.string(),
  types: z.array(NodeTypeEnum),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  includeFormattedResult: z.boolean().default(true),
});

const nodeTypeResponseSchema = z.object({
  date: z.string(),
  types: z.array(NodeTypeEnum),
  nodeCount: z.number().optional(),
  formattedResult: z.string().optional(),
  nodes: z.array(
    z.object({
      id: z.string(),
      nodeType: NodeTypeEnum,
      metadata: z.object({
        label: z.string(),
        description: z.string().optional(),
      }),
    }),
  ),
});

export default defineEventHandler(async (event) => {
  const { userId, types, date, includeFormattedResult } =
    nodeTypeRequestSchema.parse(await readBody(event));
  const db = await useDatabase();

  // Get the day node ID
  const dayNodeId = await findDayNode(db, userId, date);
  if (!dayNodeId) {
    return { date, error: `No day node found for ${date}`, nodes: [] };
  }

  // Fetch one-hop connections (only nodes with labels)
  const connections = await findOneHopConnections(
    db,
    userId,
    [dayNodeId],
    true,
  );

  // Filter by requested types
  const filtered = connections.filter((rec) => types.includes(rec.nodeType));

  // Deduplicate by nodeId
  const uniqueMap = new Map<string, (typeof filtered)[0]>();
  filtered.forEach((rec) => uniqueMap.set(rec.nodeId, rec));
  const uniqueRecords = Array.from(uniqueMap.values()).map((rec) => ({
    id: rec.nodeId,
    nodeType: rec.nodeType,
    metadata: { label: rec.label!, description: rec.description || undefined },
  }));

  // Optional markdown formatting
  let formattedResult: string | undefined;
  if (includeFormattedResult && uniqueRecords.length) {
    formattedResult = `# Nodes of types ${types.join(", ")} on ${date}\n\n`;
    const byType = uniqueRecords.reduce(
      (acc, n) => {
        (acc[n.nodeType] = acc[n.nodeType] || []).push(n);
        return acc;
      },
      {} as Record<string, typeof uniqueRecords>,
    );
    for (const [type, group] of Object.entries(byType)) {
      formattedResult += `## ${type}\n`;
      group.forEach((n) => {
        formattedResult += `- ${n.metadata.label}\n`;
      });
      formattedResult += `\n`;
    }
  }

  return nodeTypeResponseSchema.parse({
    date,
    types,
    nodeCount: uniqueRecords.length,
    ...(formattedResult && { formattedResult }),
    nodes: uniqueRecords,
  });
});
