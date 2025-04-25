import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { processAtlas } from "~/lib/processing";
import { useDatabase } from "~/utils/db";

const DreamRequestSchema = z.object({
  userId: z.string(),
});

export default defineEventHandler(async (event) => {
  const { userId } = DreamRequestSchema.parse(await readBody(event));
  const db = await useDatabase();
  // Run dream phase: update scratchpad
  const updatedAtlas = await processAtlas(db, userId);
  return { atlas: updatedAtlas };
});
