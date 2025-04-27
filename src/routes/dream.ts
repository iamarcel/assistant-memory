import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { batchQueue } from "~/lib/queues";

const AssistantDreamRequestSchema = z.object({
  userId: z.string().startsWith("user_"),
  assistantId: z.string(),
  assistantDescription: z.string(),
});

export default defineEventHandler(async (event) => {
  const { userId, assistantId, assistantDescription } =
    AssistantDreamRequestSchema.parse(await readBody(event));

  const jobData = { userId, assistantId, assistantDescription };
  await batchQueue.add("dream", jobData);

  console.log(
    `Enqueued 'dream' job for user ${userId}, assistant ${assistantId}`,
  );

  return {
    message: `Dream job for user ${userId}, assistant ${assistantId} enqueued successfully.`,
  };
});
