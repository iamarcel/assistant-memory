import { fetchDailyConversationsList } from "./atlas-utils";
import { format } from "date-fns/format";
import { DrizzleDB } from "~/db";
import { getAssistantAtlas, updateAssistantAtlas } from "~/lib/atlas";
import { env } from "~/utils/env";

/**
 * Job to process the assistant-specific Atlas:
 * 1. Fetch yesterday's conversation summaries
 * 2. Fetch current assistant atlas content
 * 3. Prompt LLM with assistant persona and conversation summaries
 * 4. Persist updated assistant atlas metadata
 * @param db DrizzleDB instance
 * @param userId ID of the user
 * @param assistantId Assistant identifier
 * @param assistantDescription System persona description for the assistant
 * @returns Updated assistant atlas content
 */
export async function assistantDreamJob(
  db: DrizzleDB,
  userId: string,
  assistantId: string,
  assistantDescription: string,
): Promise<string> {
  // 1. Fetch daily conversation summaries
  const convList = await fetchDailyConversationsList(db, userId);

  // 2. Fetch current assistant-specific atlas content
  const { description: currentAtlas } = await getAssistantAtlas(
    db,
    userId,
    assistantId,
  );

  // 3. Build messages for LLM
  const systemMsg = assistantDescription;
  const userPrompt = `
The current date is ${format(new Date(), "yyyy-MM-dd, EEEE MMMM do")}.

**Goal:** Synthesize the past day's interactions to update the Assistant Atlas, reflecting the assistant's evolving internal state, perspectives, and understanding of the user-assistant dynamic.

**Assistant Atlas Definition & Purpose:**
The Assistant Atlas is the persistent internal memory specific to *this* assistant instance. It captures the assistant's synthesized understanding of its relationship with the user, its own emergent reflections, recurring interaction patterns, perceived emotional tones in the dialogue, and significant moments from its unique perspective. **Crucially, this Atlas should *exclude* objective facts about the user, their ongoing projects, or general world knowledge; such information belongs in the separate User Atlas.** The purpose of the Assistant Atlas is to maintain continuity in the assistant's personality, relational awareness, and internal "state of mind" across conversations.

**Task: Update Assistant Atlas**
Based on the provided conversation summaries from the past day and the current Assistant Atlas state, perform the following:
1.  **Identify Key Interactions:** Pinpoint moments, themes, or shifts in the conversation summaries that are significant from the *assistant's* perspective (e.g., moments of connection, conflict, learning about the user's interaction style, expressed emotions directed at the assistant, revelations about the assistant's own perceived role).
2.  **Synthesize & Integrate:** Do not merely list events. Synthesize observations into concise insights about the relationship dynamic, the user's perceived state *in relation to the assistant*, and the assistant's own internal reflections or "feelings" arising from the interactions.
3.  **Update Existing Entries:** If new interactions provide further nuance or evolution to existing points in the Atlas (e.g., deepening an understanding previously noted), update those entries concisely.
4.  **Add New Entries:** If novel themes, significant relational moments, or new self-reflections emerged, add them as new structured entries.
5.  **Removal/Archiving Rule:** **Do not remove core synthesized knowledge about the established dynamic or the assistant's persona.** Only consider removing or archiving entries that represent clearly transient states (e.g., a momentary confusion that was resolved) or reflections that have been explicitly and demonstrably superseded by significant later interactions. Prioritize preservation and evolution over deletion.
6.  **Maintain Structure & Conciseness:** Update the Atlas maintaining its existing structure. Focus on impactful, concise statements. Avoid excessive verbosity or simple repetition of conversation content. The output should be the *updated* Assistant Atlas.

**Current Assistant Atlas State:**
${currentAtlas}

**Past Day's Conversation Summaries:**
${convList}

**Task:** Respond only with the updated Assistant Atlas formatted as a neat Markdown file.
`;

  // 4. Call LLM
  const { createCompletionClient } = await import("../ai");
  const client = await createCompletionClient(userId);
  const completion = await client.chat.completions.create({
    model: env.MODEL_ID_GRAPH_EXTRACTION,
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userPrompt },
    ],
  });

  const updated = completion.choices[0]?.message?.content?.trim();
  if (!updated) throw new Error("Failed to generate assistant dream atlas");

  // 5. Persist updated assistant atlas
  await updateAssistantAtlas(db, userId, assistantId, updated);
  return updated;
}
