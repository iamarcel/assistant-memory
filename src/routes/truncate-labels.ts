import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { truncateLongLabels, generateMissingNodeEmbeddings } from "~/lib/jobs/cleanup-graph";

const truncateLabelsRequestSchema = z.object({
  userId: z.string(),
});

const truncateLabelsResponseSchema = z.object({
  message: z.string(),
  updatedCount: z.number(),
  embeddingsGeneratedCount: z.number(),
});

export default defineEventHandler(async (event) => {
  const params = truncateLabelsRequestSchema.parse(await readBody(event));

  // Run both cleanup operations
  const [truncateResult, embeddingsResult] = await Promise.all([
    truncateLongLabels(params.userId),
    generateMissingNodeEmbeddings(params.userId),
  ]);

  console.log(
    `Cleanup completed for user ${params.userId}: truncated ${truncateResult.updatedCount} labels, generated ${embeddingsResult.generatedCount} embeddings`,
  );

  return truncateLabelsResponseSchema.parse({
    message: `Successfully truncated ${truncateResult.updatedCount} labels and generated ${embeddingsResult.generatedCount} embeddings for user ${params.userId}`,
    updatedCount: truncateResult.updatedCount,
    embeddingsGeneratedCount: embeddingsResult.generatedCount,
  });
});