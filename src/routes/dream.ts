import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { assistantDream } from "~/lib/processing";
import { useDatabase } from "~/utils/db";

const AssistantDreamRequestSchema = z.object({
  userId: z.string(),
  assistantId: z.string(),
  assistantDescription: z.string(),
});

export default defineEventHandler(async (event) => {
  const { userId, assistantId, assistantDescription } =
    AssistantDreamRequestSchema.parse(await readBody(event));
  const db = await useDatabase();
  // Run assistant-dream phase: update assistant-specific atlas
  const updatedAtlas = await assistantDream(
    db,
    userId,
    assistantId,
    assistantDescription,
  );
  return { atlas: updatedAtlas };
});
