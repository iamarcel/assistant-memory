import { parseISO } from "date-fns";
import { z } from "zod";
import { IngestConversationJobInput } from "~/lib/jobs/ingest-conversation";
import { batchQueue } from "~/lib/queues";

const ingestConversationRequestSchema = z.object({
  userId: z.string(),
  conversation: z.object({
    id: z.string(),
    messages: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        role: z.string(),
        name: z.string().optional(),
        timestamp: z.string().datetime(),
      }),
    ),
  }),
});

export default defineEventHandler(async (event) => {
  const { userId, conversation } = ingestConversationRequestSchema.parse(
    await readBody(event),
  );

  const jobInput: IngestConversationJobInput = {
    userId,
    conversationId: conversation.id,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      content: m.content,
      role: m.role,
      name: m.name,
      timestamp: parseISO(m.timestamp),
    })),
  };

  await batchQueue.add("ingest-conversation", jobInput);
});
