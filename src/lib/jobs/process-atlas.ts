import { fetchDailyConversationsList } from "./atlas-utils";
import { format } from "date-fns/format";
import { DrizzleDB } from "~/db";
import { getAtlas, updateAtlas } from "~/lib/atlas";
import { debug } from "~/lib/debug-utils";
import { env } from "~/utils/env";

/**
 * Job to process the user's Atlas:
 * 1. Fetch yesterday's conversation summaries
 * 2. Fetch current atlas content
 * 3. Prompt LLM to update the atlas
 * 4. Persist updated atlas metadata
 * @param db DrizzleDB instance
 * @param userId User identifier
 * @returns Updated atlas content
 */
export async function processAtlasJob(
  db: DrizzleDB,
  userId: string,
): Promise<string> {
  // 1. Fetch daily conversation summaries
  const convList = await fetchDailyConversationsList(db, userId);

  // 2. Fetch current atlas content
  const { description: currentAtlas } = await getAtlas(db, userId);

  // 3. Build LLM prompt
  const prompt = `
The current date is ${format(new Date(), "yyyy-MM-dd, EEEE MMMM do")}.

**Goal:** Synthesize the past day's inputs to update the User Atlas with relevant factual information, project updates, and expressed user preferences or goals.

**User Atlas Definition & Purpose:**
The User Atlas is the central, persistent repository of structured information *about the user*. It aims to capture factual details (biographical data, stated preferences, key relationships mentioned), track ongoing projects, long-term goals, upcoming events, and significant themes or interests expressed by the user. This Atlas is assistant-independent; it reflects the user's world and stated information objectively, without interpretation or perspective from any assistant. Its purpose is to provide a stable, evolving, and accurate knowledge base about the user for context and continuity.

**Task: Update User Atlas**
Based on the provided summaries or raw inputs from the past day and the current User Atlas state, perform the following:
1.  **Identify Key User Information:** Extract factual statements, updates on projects or goals, newly expressed preferences, mentioned future plans, or significant life events from the day's inputs.
2.  **Integrate Factual Data:** Add new, stable factual information (e.g., mentioning a specific skill, a new important person in their life, a core value stated).
3.  **Update Ongoing Initiatives:** Reflect progress, changes, or newly defined aspects of projects, goals, or upcoming events that the user discussed. Note completions or shifts in priority if mentioned. Write down the dates when things are added, so you can keep track of when it's "expired" and no longer relevant.
4.  **Capture Preferences & Interests:** Record newly stated preferences (e.g., "I prefer X over Y") or recurring topics of deep interest.
5.  **Synthesize & Structure:** Consolidate related information. Integrate new points into the existing structure logically. Avoid simple lists of dialogue; focus on the underlying information.
6.  **Preservation Rule:** Core biographical data and explicitly stated, stable preferences should generally be preserved. Only update or remove these if the user provides explicit, contradictory information or declares a change. For ongoing projects or transient states, update based on the latest information.
7.  **Maintain Clarity & Conciseness:** Ensure the updated Atlas remains clear, well-structured, and avoids unnecessary repetition or excessive detail. Focus on capturing the essence of the information concisely. The output should be the *updated* User Atlas.
  
${currentAtlas ? "The atlas currently contains:\n" + currentAtlas : "The atlas is currently empty, start creating the first version."}

Yesterday's conversation summaries:
${convList}

Please rewrite the atlas to add important information, remove redundant or irrelevant details, and update your current state of mind.
Do not repeat the conversation list in the atlas.
Return only the updated atlas content.
`;

  // 4. Call LLM
  const { createCompletionClient } = await import("../ai");
  const client = await createCompletionClient(userId);
  const completion = await client.chat.completions.create({
    model: env.MODEL_ID_GRAPH_EXTRACTION,
    messages: [{ role: "user", content: prompt }],
  });

  const updated = completion.choices[0]?.message?.content?.trim();
  debug("\n\nprocessAtlasJob - updated atlas", updated);
  if (!updated) throw new Error("Failed to generate updated atlas");

  // 5. Persist updated atlas
  await updateAtlas(db, userId, updated);
  return updated;
}
