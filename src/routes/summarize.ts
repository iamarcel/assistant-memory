import { defineEventHandler, readBody } from "h3";
import { batchQueue } from "~/lib/queues";
import {
  summarizeRequestSchema,
  summarizeResponseSchema,
} from "~/lib/schemas/summarize";

export default defineEventHandler(async (event) => {
  const { userId } = summarizeRequestSchema.parse(await readBody(event));

  await batchQueue.add("summarize", { userId });

  console.log(`Enqueued 'summarize' job for user: ${userId}`);

  return summarizeResponseSchema.parse({
    message: `Summarization job for user ${userId} enqueued successfully.`,
  });
});
