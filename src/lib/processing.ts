import { subDays } from "date-fns";
import { and, eq, or, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "~/db/schema";
import { nodes, edges, nodeMetadata } from "~/db/schema";
import {
  getAtlas,
  updateAtlas,
  getAssistantAtlas,
  updateAssistantAtlas,
} from "~/lib/atlas";
import { formatLabelDescList } from "~/lib/formatting";
import { ensureDayNode } from "~/lib/temporal";
import { NodeTypeEnum } from "~/types/graph";
import { env } from "~/utils/env";

// Database instance type
type Database = NodePgDatabase<typeof schema>;

/**
 * Processes the User Atlas, which is a permanent description of information about
 * the user and current important information. This uses the previous day's nodes
 * to make any necessary updates to the User Atlas.
 */
export async function processAtlas(
  db: Database,
  userId: string,
): Promise<string> {
  // Determine yesterday's date
  const yesterday = subDays(new Date(), 1);

  // Ensure day node exists and get its ID
  const dayNodeId = await ensureDayNode(db, userId, yesterday);

  // Fetch nodes linked to yesterday's node
  const connected = await db
    .select({
      id: nodes.id,
      label: nodeMetadata.label,
      description: nodeMetadata.description,
    })
    .from(nodes)
    .innerJoin(
      edges,
      or(
        and(
          eq(edges.sourceNodeId, dayNodeId),
          eq(edges.targetNodeId, nodes.id),
        ),
        and(
          eq(edges.targetNodeId, dayNodeId),
          eq(edges.sourceNodeId, nodes.id),
        ),
      ),
    )
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(edges.userId, userId),
        eq(nodes.userId, userId),
        // Exclude the day node itself
        ne(nodes.id, dayNodeId),
      ),
    );

  // Prepare memory list for prompt
  const memoriesList = formatLabelDescList(
    connected.map((n) => ({ label: n.label, description: n.description })),
  );

  // Fetch current atlas
  const { description: currentScratch } = await getAtlas(db, userId);

  // Construct prompt for LLM
  const prompt = `You are an AI assistant updating your long-term atlas.
The atlas currently contains:
${currentScratch}

Yesterday's important memories:
${memoriesList}

Please rewrite the atlas to add important information, remove redundant or irrelevant details, and update your current state of mind. Return only the updated atlas content.`;

  // Call LLM
  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
  });
  const completion = await client.chat.completions.create({
    model: env.MODEL_ID_GRAPH_EXTRACTION,
    messages: [{ role: "user", content: prompt }],
  });

  const updated = completion.choices[0]?.message?.content?.trim();
  if (!updated) {
    throw new Error("Failed to generate updated atlas");
  }

  // Update atlas metadata
  await updateAtlas(db, userId, updated);

  return updated;
}

/**
 * Runs the assistant-dream phase: retrieves yesterday's conversation summaries and the assistant's atlas,
 * prompts the LLM with the assistant persona, and updates the assistant-specific atlas.
 */
export async function assistantDream(
  db: Database,
  userId: string,
  assistantId: string,
  assistantDescription: string,
): Promise<string> {
  // Determine yesterday's date
  const yesterday = subDays(new Date(), 1);

  // Ensure day node exists and get its ID
  const dayNodeId = await ensureDayNode(db, userId, yesterday);

  // Fetch conversation nodes linked to yesterday
  const convs = await db
    .select({ title: nodeMetadata.label, summary: nodeMetadata.description })
    .from(nodes)
    .innerJoin(
      edges,
      or(
        and(
          eq(edges.sourceNodeId, dayNodeId),
          eq(edges.targetNodeId, nodes.id),
        ),
        and(
          eq(edges.targetNodeId, dayNodeId),
          eq(edges.sourceNodeId, nodes.id),
        ),
      ),
    )
    .innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodes.id))
    .where(
      and(
        eq(edges.userId, userId),
        eq(nodes.userId, userId),
        eq(nodes.nodeType, NodeTypeEnum.enum.Conversation),
        ne(nodes.id, dayNodeId),
      ),
    );

  // Prepare conversation list for prompt
  const convList = formatLabelDescList(
    convs.map((n) => ({ label: n.title, description: n.summary })),
  );

  // Fetch current assistant-specific atlas
  const { description: currentAtlas } = await getAssistantAtlas(
    db,
    userId,
    assistantId,
  );

  // Construct messages with system persona and user prompt
  const systemMsg = assistantDescription;
  const userPrompt = `Your assistant-specific atlas currently contains:
${currentAtlas}

Yesterday's conversation summaries:
${convList}

Please reflect on these conversations: articulate your thoughts, longer-term mood and plans. Return only the updated atlas content.`;

  // Call LLM
  const { OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
  });
  const completion = await client.chat.completions.create({
    model: env.MODEL_ID_GRAPH_EXTRACTION,
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userPrompt },
    ],
  });

  const updated = completion.choices[0]?.message?.content?.trim();
  if (!updated) {
    throw new Error("Failed to generate assistant dream atlas");
  }

  // Update assistant-specific atlas metadata
  await updateAssistantAtlas(db, userId, assistantId, updated);

  return updated;
}
