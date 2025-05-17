import { addDays } from "date-fns";
import { defineEventHandler, readBody } from "h3";
import { CleanupGraphParams } from "~/lib/jobs/cleanup-graph";
import { batchQueue, DreamJobData, flowProducer } from "~/lib/queues";
import {
  dreamRequestSchema,
  dreamResponseSchema,
} from "~/lib/schemas/dream";

export default defineEventHandler(async (event) => {
  const { userId, assistantId, assistantDescription } =
    dreamRequestSchema.parse(await readBody(event));

  const jobData: DreamJobData = { userId, assistantId, assistantDescription };

  flowProducer.add({
    name: "dream",
    data: jobData,
    queueName: batchQueue.name,
    children: [
      {
        name: "cleanup-graph",
        data: {
          userId,
          since: addDays(new Date(), -1),
          entryNodeLimit: 5,
          semanticNeighborLimit: 10,
          graphHopDepth: 2,
          maxSubgraphNodes: 100,
          maxSubgraphEdges: 150,
          llmModelId: env.MODEL_ID_GRAPH_EXTRACTION,
        } satisfies CleanupGraphParams,
        queueName: batchQueue.name,
      },
    ],
  });

  console.log(
    `Enqueued 'dream' job for user ${userId}, assistant ${assistantId}`,
  );

  return dreamResponseSchema.parse({
    message: `Dream job for user ${userId}, assistant ${assistantId} enqueued successfully.`,
  });
});
