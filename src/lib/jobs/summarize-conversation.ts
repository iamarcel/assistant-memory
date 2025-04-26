import { eq, and, ne } from "drizzle-orm";
import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import { DrizzleDB } from "~/db";
import { nodeMetadata, sources, sourceLinks, nodes } from "~/db/schema";
import {
  loadConversationTurns,
  type ConversationTurn,
} from "~/lib/conversation-store";
import { debug } from "~/lib/debug-utils";
import { formatConversationAsXml } from "~/lib/formatting";
import { env } from "~/utils/env";

// Job input schema
export const SummarizeConversationJobInputSchema = z.object({
  userId: z.string(),
});
export type SummarizeConversationJobInput = z.infer<
  typeof SummarizeConversationJobInputSchema
>;

// Define the expected output/result of the job
export interface SummarizeConversationJobResult {
  message: string;
  summarizedCount: number;
}

/**
 * Summarizes conversations for a given user.
 * Fetches conversations needing summarization, calls OpenAI, and updates metadata.
 */
export async function summarizeUserConversations(
  db: DrizzleDB,
  userId: string,
): Promise<SummarizeConversationJobResult> {
  const convsToSummarize = await db
    .select({ sourceId: sources.id, conversationNodeId: sourceLinks.nodeId })
    .from(sources)
    .innerJoin(sourceLinks, eq(sourceLinks.sourceId, sources.id))
    .innerJoin(nodes, eq(nodes.id, sourceLinks.nodeId))
    .where(
      and(
        eq(sources.userId, userId),
        eq(sources.type, "conversation"),
        ne(sources.status, "summarized"),
      ),
    );

  if (convsToSummarize.length === 0) {
    return {
      message: "No new conversations found to summarize.",
      summarizedCount: 0,
    };
  }

  let summarizedCount = 0;
  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
  });

  for (const { sourceId, conversationNodeId } of convsToSummarize) {
    // load conversation turns
    let turns: ConversationTurn[];
    try {
      turns = await loadConversationTurns(db, userId, sourceId);
    } catch (err: unknown) {
      console.error(`Error loading turns for source ${sourceId}:`, err);
      await db
        .update(sources)
        .set({ status: "failed" })
        .where(eq(sources.id, sourceId));
      continue;
    }
    if (turns.length === 0) {
      await db
        .update(sources)
        .set({ status: "summarized" })
        .where(eq(sources.id, sourceId));
      continue;
    }

    const prompt = `You are a conversation summarizer. Your task is to analyze the following conversation and extract the most important information to create a summary.

Return (a) a title and (b) a summary, which is a set of concise, information-dense bullet point lists with important information to remember. Write down:

- Key people mentioned (outside of the participants)
- Key events, experiences, or observations
- The evolution throughout the conversation
- The user's emotions and feelings
- The assistant's internal insights or discoveries
- The assistant's internal decisions, realizations and conclusions for later

Do not include any irrelevant information. Do not mention things like "not explicitly stated"—just omit the point or even the full header altogether.

<conversation>
${formatConversationAsXml(turns)}
</conversation>
`;

    debug(`Summarize - prompt for source ${sourceId}:`, prompt);
    try {
      const completion = await client.beta.chat.completions.parse({
        messages: [{ role: "user", content: prompt }],
        model: env.MODEL_ID_GRAPH_EXTRACTION,
        response_format: zodResponseFormat(
          z.object({
            title: z
              .string()
              .describe(
                "A concise title for the summary, max length 255 characters",
              ),
            summary: z
              .string()
              .describe("A concise summary of the conversation"),
          }),
          "summary",
        ),
      });

      const parsed = completion.choices[0]?.message.parsed;
      debug(`Summarize - parsed result for source ${sourceId}:`, parsed);

      if (!parsed) {
        console.error(`Failed to parse LLM response for source ${sourceId}`);
        await db
          .update(sources)
          .set({ status: "failed" })
          .where(eq(sources.id, sourceId));
        continue;
      }

      const metadataInsert = {
        nodeId: conversationNodeId,
        label: parsed.title,
        description: parsed.summary,
      };
      await db
        .insert(nodeMetadata)
        .values(metadataInsert)
        .onConflictDoUpdate({
          target: nodeMetadata.nodeId,
          set: {
            label: parsed.title,
            description: parsed.summary,
          },
        });

      await db
        .update(sources)
        .set({
          status: "summarized",
        })
        .where(eq(sources.id, sourceId));

      summarizedCount++;
    } catch (error) {
      console.error(`Error summarizing source ${sourceId}:`, error);
      await db
        .update(sources)
        .set({ status: "failed" })
        .where(eq(sources.id, sourceId));
      // Do not re-throw here, allow the loop to continue with other sources
    }
  }

  return {
    message: `Finished summarizing. Processed ${summarizedCount} out of ${convsToSummarize.length} conversations requiring summary.`,
    summarizedCount,
  };
}
