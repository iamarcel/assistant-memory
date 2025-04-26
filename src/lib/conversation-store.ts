import { formatISO } from "date-fns";
import { z } from "zod";
import { DrizzleDB } from "~/db";
import { sources } from "~/db/schema";
import { TypeId } from "~/types/typeid";

// Schema to parse stored metadata for conversation messages
const recordMetadataSchema = z
  .object({
    rawContent: z.string(),
    role: z.string(),
    name: z.string().optional(),
    timestamp: z.string(),
  })
  .catchall(z.unknown());

/** A turn in a conversation, with external message identifier. */
export interface ConversationTurn {
  /** External message id from chat system */
  id: string;
  role: string;
  content: string;
  name: string | undefined;
  timestamp: Date;
}

/** Result of saving conversation turns: only newly inserted rows. */
export interface SaveConversationTurnsResult {
  /** Inserted rows info: internal PK and external id */
  successes: Array<{
    /** Internal Drizzle PK for the source row */
    internalId: TypeId<"source">;
    /** External message id */
    externalId: string;
  }>;
}

/**
 * Persist only new conversation message sources.
 * Each ConversationTurn.id is used as external id.
 * On conflict (existing message), does nothing.
 * @param db DrizzleDB instance
 * @param userId ID of the user owning the conversation
 * @param parentSourceId Internal PK of the parent conversation source
 * @param turns Array of ConversationTurn with external IDs
 * @returns SaveConversationTurnsResult with `successes`: newly inserted rows
 */
export async function saveConversationTurns(
  db: DrizzleDB,
  userId: string,
  parentSourceId: TypeId<"source">,
  turns: ConversationTurn[],
): Promise<SaveConversationTurnsResult> {
  const rowsToInsert = turns.map((t) => ({
    userId,
    type: "conversation_message" as const,
    externalId: t.id,
    parentSource: parentSourceId,
    lastIngestedAt: t.timestamp,
    content: t.content,
    metadata: {
      rawContent: t.content,
      role: t.role,
      name: t.name,
      timestamp: formatISO(t.timestamp),
    },
  }));
  const inserted = await db
    .insert(sources)
    .values(rowsToInsert)
    .onConflictDoNothing()
    .returning({ internalId: sources.id, externalId: sources.externalId });
  return { successes: inserted };
}

/**
 * Load and parse all conversation messages for a parent source.
 */
export async function loadConversationTurns(
  db: DrizzleDB,
  userId: string,
  parentSourceId: TypeId<"source">,
): Promise<ConversationTurn[]> {
  const rows = await db.query.sources.findMany({
    where: (src, { and, eq }) =>
      and(
        eq(src.userId, userId),
        eq(src.parentSource, parentSourceId),
        eq(src.type, "conversation_message"),
      ),
    orderBy: (src, { asc }) => asc(src.lastIngestedAt),
  });
  return rows.map((r) => {
    const meta = recordMetadataSchema.parse(r.metadata ?? {});
    return {
      id: r.externalId,
      role: meta.role,
      name: meta.name,
      content: meta.rawContent,
      timestamp: new Date(meta.timestamp),
    };
  });
}
