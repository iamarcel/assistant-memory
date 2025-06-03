import { saveMemory } from "~/lib/ingestion/save-document";
import {
  ingestDocumentRequestSchema,
  ingestDocumentResponseSchema,
} from "~/lib/schemas/ingest-document-request";

export default defineEventHandler(async (event) => {
  const { userId, document, updateExisting } = ingestDocumentRequestSchema.parse(
    await readBody(event),
  );
  return ingestDocumentResponseSchema.parse(
    await saveMemory({ userId, document, updateExisting }),
  );
});
