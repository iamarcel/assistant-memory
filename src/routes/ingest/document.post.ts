import { z } from "zod";
import { IngestDocumentJobInput } from "~/lib/jobs/ingest-document";
import { batchQueue } from "~/lib/queues";

const ingestDocumentRequestSchema = z.object({
  userId: z.string(),
  document: z.object({
    id: z.string(),
    content: z.string(),
    timestamp: z.string().datetime().pipe(z.coerce.date()).optional(), // Timestamp is optional
  }),
});

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

  return {
    message: "Document ingestion job accepted",
    jobId: jobInput.documentId,
  }; // Returning a job ID might be useful
});
