import { IngestDocumentJobInput } from "~/lib/jobs/ingest-document";
import { batchQueue } from "~/lib/queues";
import {
  ingestDocumentRequestSchema,
  ingestDocumentResponseSchema,
} from "~/lib/schemas/ingest-document-request";

export default defineEventHandler(async (event) => {
  const { userId, document } = ingestDocumentRequestSchema.parse(
    await readBody(event),
  );

  const jobInput: IngestDocumentJobInput = {
    userId,
    documentId: document.id,
    content: document.content,
    // Use provided timestamp or current time if not provided
    timestamp: document.timestamp ?? new Date(),
  };

  await batchQueue.add("ingest-document", jobInput);

  return ingestDocumentResponseSchema.parse({
    message: "Document ingestion job accepted",
    jobId: jobInput.documentId,
  });
});
