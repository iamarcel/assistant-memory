import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { batchQueue } from "~/lib/queues";

const EnqueueSummarizeRequestSchema = z.object({
  userId: z.string(),
});

export default defineEventHandler(async (event) => {
  const { userId } = EnqueueSummarizeRequestSchema.parse(await readBody(event));

  await batchQueue.add("summarize", { userId });

  console.log(`Enqueued 'summarize' job for user: ${userId}`);

  return { message: `Summarization job for user ${userId} enqueued successfully.` };
});
