import { batchQueue } from "../queues";
import {
  IngestDocumentRequest,
  IngestDocumentResponse,
} from "../schemas/ingest-document-request";

/**
 * Queue a document ingestion job.
 */
export async function saveMemory(
  req: IngestDocumentRequest,
): Promise<IngestDocumentResponse> {
  await batchQueue.add("ingest-document", {
    userId: req.userId,
    documentId: req.document.id,
    content: req.document.content,
    timestamp: req.document.timestamp ?? new Date(),
    updateExisting: req.updateExisting ?? false,
  });

  return {
    message: "Document ingestion job accepted",
    jobId: req.document.id,
  };
}
