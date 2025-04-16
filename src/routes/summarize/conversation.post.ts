import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import { edges, nodeMetadata, nodes, users } from "~/db/schema";
import { formatConversationAsXml } from "~/lib/formatting";
import { ensureDayNode } from "~/lib/temporal";
import { EdgeTypeEnum } from "~/types/graph";

const SummarizeConversationRequestSchema = z.object({
  userId: z.string(),
  conversation: z.object({
    id: z.string(),
    messages: z.array(
      z.object({
        content: z.string(),
        role: z.string(),
        name: z.string().optional(),
        timestamp: z.string().datetime(),
      }),
    ),
  }),
});

export default defineEventHandler(async (event) => {
  const { userId, conversation } = SummarizeConversationRequestSchema.parse(
    await readBody(event),
  );

  const db = await useDatabase();

  // Ensure user exists
  await db
    .insert(users)
    .values({
      id: userId,
    })
    .onConflictDoNothing();

  // --- Ensure Day Node Exists ---
  const dayNodeId = await ensureDayNode(db, userId);

  const prompt = `You are a conversation summarizer. Your task is to analyze the following conversation and extract the most important information to create a summary.

Return (a) a title and (b) a summary, which is a set of concise, information-dense bullet point lists with important information to remember. Write down:

- Key people mentioned
- Key events, experiences, or observations
- The evolution throughout the conversation
- The user's emotions and feelings
- The assistant's internal insights or discoveries
- The assistant's internal decisions, realizations and conclusions for later

<conversation>
${formatConversationAsXml(conversation.messages)}
</conversation>
`;

  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
  });

  const completion = await client.beta.chat.completions.parse({
    messages: [{ role: "user", content: prompt }],
    model: env.MODEL_ID_GRAPH_EXTRACTION,
    response_format: zodResponseFormat(
      z.object({
        title: z.string(),
        summary: z.string(),
      }),
      "summary",
    ),
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("Failed to parse LLM response");
  }

  // Create summary node
  const [conversationNode] = await db
    .insert(nodes)
    .values({
      userId,
      nodeType: "Conversation",
      createdAt: new Date(),
    })
    .returning();

  if (!conversationNode) {
    throw new Error("Failed to create conversation node");
  }

  await Promise.all([
    // Link to day node
    db.insert(edges).values({
      userId,
      sourceNodeId: dayNodeId,
      targetNodeId: conversationNode.id,
      edgeType: EdgeTypeEnum.enum.OCCURRED_ON,
    }),
    // Store in metadata
    db.insert(nodeMetadata).values({
      nodeId: conversationNode.id,
      label: parsed.title,
      description: parsed.summary,
    }),
  ]);

  return { title: parsed.title, summary: parsed.summary };
});
