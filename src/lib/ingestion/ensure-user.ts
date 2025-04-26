import type { DrizzleDB } from "~/db";
import { users } from "~/db/schema";

export async function ensureUser(db: DrizzleDB, userId: string) {
  await db
    .insert(users)
    .values({
      id: userId,
    })
    .onConflictDoNothing();
}
