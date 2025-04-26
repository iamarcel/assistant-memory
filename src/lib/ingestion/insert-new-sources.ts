import { DrizzleDB } from "~/db";
import { sources } from "~/db/schema";
import { sourceService, type SourceCreateInput } from "~/lib/sources";
import { SourceType } from "~/types/graph";
import { TypeId } from "~/types/typeid";

export interface SourceInput {
  externalId: string;
  timestamp: Date;
  content?: string;
  fileBuffer?: Buffer;
  contentType?: string;
}

export async function insertNewSources(params: {
  db: DrizzleDB;
  userId: string;
  parentSourceType: SourceType;
  parentSourceId: string;
  childSourceType: SourceType;
  childSources: SourceInput[];
}): Promise<{ sourceNodeId: TypeId<"node">; newSourceSourceIds: string[] }> {
  const {
    db,
    userId,
    parentSourceType,
    parentSourceId,
    childSourceType,
    childSources,
  } = params;

  // Upsert parent source
  const [parentSource] = await db
    .insert(sources)
    .values({
      userId,
      type: parentSourceType,
      externalId: parentSourceId,
      lastIngestedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: { lastIngestedAt: new Date() },
      target: [sources.type, sources.externalId],
    })
    .returning();

  if (!parentSource) {
    throw new Error("Failed to upsert parent source");
  }

  // Map to SourceService inputs
  const childInputs: SourceCreateInput[] = childSources.map((cs) => {
    const input: SourceCreateInput = {
      userId,
      sourceType: childSourceType,
      externalId: cs.externalId,
      parentId: parentSource.id,
      timestamp: cs.timestamp,
    };
    if (cs.content !== undefined) input.content = cs.content;
    if (cs.fileBuffer !== undefined) input.fileBuffer = cs.fileBuffer;
    if (cs.contentType !== undefined) input.contentType = cs.contentType;
    return input;
  });

  // Delegate insertion & storage
  const { successes: newSourceSourceIds, failures } =
    await sourceService.insertMany(childInputs);
  if (failures.length) {
    console.warn("Some sources failed to archive:", failures);
  }

  return { sourceNodeId: parentSource.id, newSourceSourceIds };
}
