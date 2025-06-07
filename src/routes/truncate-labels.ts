import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { truncateLongLabels } from "~/lib/jobs/cleanup-graph";

const truncateLabelsRequestSchema = z.object({
  userId: z.string(),
});

const truncateLabelsResponseSchema = z.object({
  message: z.string(),
  updatedCount: z.number(),
});

export default defineEventHandler(async (event) => {
  const params = truncateLabelsRequestSchema.parse(await readBody(event));

  const result = await truncateLongLabels(params.userId);

  console.log(
    `Truncated ${result.updatedCount} labels for user ${params.userId}`,
  );

  return truncateLabelsResponseSchema.parse({
    message: `Successfully truncated ${result.updatedCount} labels for user ${params.userId}`,
    updatedCount: result.updatedCount,
  });
});