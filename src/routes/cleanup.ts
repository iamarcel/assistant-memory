import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { batchQueue } from "~/lib/queues";

const CleanupGraphRequestSchema = z.object({
  userId: z.string().startsWith("user_"),
  since: z.coerce.date(),
  entryNodeLimit: z.number().int().positive().default(5),
  semanticNeighborLimit: z.number().int().positive().default(15),
  graphHopDepth: z.union([z.literal(1), z.literal(2)]).default(2),
  maxSubgraphNodes: z.number().int().positive().default(200),
  maxSubgraphEdges: z.number().int().positive().default(200),
});

export default defineEventHandler(async (event) => {
  const params = CleanupGraphRequestSchema.parse(await readBody(event));

  await batchQueue.add("cleanup-graph", params);

  console.log(
    `Enqueued 'cleanup-graph' job for user ${params.userId} with params since=${params.since.toISOString()} hopDepth=${params.graphHopDepth}`,
  );

  return {
    message: `Cleanup-graph job for user ${params.userId} enqueued successfully.`,
  };
});
