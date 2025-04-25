import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import { nodeMetadata, sources } from "~/db/schema";
import { formatConversationAsXml } from "~/lib/formatting";
import { eq, and, isNotNull, ne } from "drizzle-orm";
import { useDatabase } from "~/utils/db";
import { env } from "~/utils/env";

const SummarizeConversationRequestSchema = z.object({
  userId: z.string(),
});

export default defineEventHandler(async (event) => {
  const { userId } = SummarizeConversationRequestSchema.parse(
    await readBody(event),
  );

  const db = await useDatabase();

  const sourcesToSummarize = await db.query.sources.findMany({
    where: and(
      eq(sources.userId, userId),
      eq(sources.sourceType, "conversation"),
      isNotNull(sources.conversationNodeId),
      ne(sources.status, 'summarized')
    ),
  });

  if (sourcesToSummarize.length === 0) {
    return { message: "No conversations found to summarize.", summarizedCount: 0 };
  }

  let summarizedCount = 0;
  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
  });

  for (const source of sourcesToSummarize) {
    if (!source.conversationNodeId) {
      console.warn(`Source ${source.id} is missing conversationNodeId, skipping.`);
      continue;
    }

    // Fetch raw chat_message records for this conversation
    const rawRecords = await db.query.sources.findMany({
      where: and(
        eq(sources.sourceType, "chat_message"),
        eq(sources.conversationNodeId, source.conversationNodeId!),
      ),
    });
    // Parse, sort by timestamp, and format messages
    const recordMetadataSchema = z.object({
      content: z.string(),
      role: z.string(),
      name: z.string().optional(),
      timestamp: z.string(),
    });
    const formattedMessages = rawRecords
      .map((rec) => recordMetadataSchema.parse(rec.metadata))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((md) => ({
        content: md.content,
        role: md.role,
        name: md.name ?? undefined,
        timestamp: md.timestamp,
      }));

    if (formattedMessages.length === 0) {
      console.warn(`No messages found for source ${source.id}, skipping summary.`);
      await db.update(sources).set({ status: 'summarized' }).where(eq(sources.id, source.id));
      continue;
    }

    const prompt = `You are a conversation summarizer. Your task is to analyze the following conversation and extract the most important information to create a summary.

Return (a) a title and (b) a summary, which is a set of concise, information-dense bullet point lists with important information to remember. Write down:

<conversation>
${formatConversationAsXml(formattedMessages)}
</conversation>
`;

    try {
      const completion = await client.beta.chat.completions.parse({
        messages: [{ role: "user", content: prompt }],
        model: env.MODEL_ID_GRAPH_EXTRACTION,
        response_format: zodResponseFormat(
          z.object({
            title: z.string().max(255),
            summary: z.string(),
          }),
          "summary",
        ),
      });

      const parsed = completion.choices[0]?.message.parsed;

      if (!parsed) {
        console.error(`Failed to parse LLM response for source ${source.id}`);
        await db.update(sources).set({ status: 'failed' }).where(eq(sources.id, source.id));
        continue;
      }

      const metadataInsert = {
        nodeId: source.conversationNodeId,
        label: parsed.title,
        description: parsed.summary,
      };
      await db.insert(nodeMetadata)
        .values(metadataInsert)
        .onConflictDoUpdate({
          target: nodeMetadata.nodeId,
          set: {
            label: parsed.title,
            description: parsed.summary,
          }
        });

      await db
        .update(sources)
        .set({
          status: 'summarized'
        })
        .where(eq(sources.id, source.id));

      summarizedCount++;

    } catch (error) {
      console.error(`Error summarizing source ${source.id}:`, error);
      await db
        .update(sources)
        .set({ status: 'failed' })
        .where(eq(sources.id, source.id));
    }
  }

  return { message: `Successfully summarized ${summarizedCount} out of ${sourcesToSummarize.length} conversations.`, summarizedCount };
});
