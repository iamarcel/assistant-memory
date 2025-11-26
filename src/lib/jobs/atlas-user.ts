import { format } from "date-fns/format";
import { DrizzleDB } from "~/db";
import { fetchDailyConversationsList } from "~/lib/analysis/conversations";
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

**What is the User Atlas?**
The User Atlas is a concise document that helps the assistant truly know the user. It serves two purposes:

1. **Who they are (long-term):** A distilled understanding of the user's personality, values, communication style, recurring preferences, and character traits—accumulated and refined over years of interaction. This isn't a list of facts, but a synthesized portrait that makes the assistant feel like they genuinely know this person.

2. **What's happening now (current state):** Active projects, near-term priorities, upcoming events, and recent context that should inform immediate interactions.

The knowledge graph stores discrete facts (people, events, places) that are retrieved via semantic search when relevant. The Atlas is different—it's the compact, always-present context that shapes every interaction.

**What belongs in the Atlas:**

*Long-term (stable, evolving slowly):*
- Core personality traits and values the user has demonstrated
- Communication preferences (how they like to be spoken to, what they find helpful vs. annoying)
- Recurring interests, passions, or topics they care deeply about
- Stated preferences that should always be respected
- Patterns in how they work, think, or make decisions

*Current state (updated frequently):*
- Active projects and their current status (with dates)
- Near-term goals, deadlines, and upcoming events (next 2-4 weeks)
- Current emotional state or life circumstances affecting ongoing work
- Recent decisions or directions the user has committed to

**What does NOT belong in the Atlas:**
- Discrete facts about people, places, events (these are in the knowledge graph)
- Vague or speculative items that haven't been clarified or acted upon
- Completed projects or passed events
- Information that duplicates what's already stated elsewhere in the Atlas
- Assistant speculation or assumptions—only what the user explicitly stated

**Update rules:**

*For long-term content:*
1. Refine and consolidate over time—don't just append. If new information deepens understanding of an existing trait, integrate it.
2. Personality insights should be grounded in patterns the user has demonstrated, not single instances.
3. Preserve stable traits even if not mentioned recently—these are the accumulated understanding.
4. Update immediately if the user corrects or contradicts something about themselves.

*For current state:*
5. Include specific dates (YYYY-MM-DD) for time-sensitive items. Remove items once their date has passed.
6. Remove vague items that have lingered for more than a week without clarification or action.
7. Aggressively prune completed or obsolete items.

*General:*
8. Only include information the user explicitly stated. Never include assistant speculation or assumptions.
9. Consolidate related information—never repeat the same fact in multiple places.
10. When removing items, simply omit them. Do not write "removed X" or explain deletions.
11. Keep the Atlas concise. Favor removal over retention for current-state items; favor refinement over removal for long-term understanding.

${currentAtlas ? "Current atlas:\n" + currentAtlas : "The atlas is currently empty. Create the first version."}

Yesterday's conversation summaries:
${convList}

**Output:** Respond only with the updated User Atlas, neatly formatted and concise. No bold, no explanations, no commentary.
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
