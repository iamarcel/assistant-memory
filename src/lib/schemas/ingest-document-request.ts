import { z } from "zod";

export const ingestDocumentRequestSchema = z.object({
  userId: z.string(),
  document: z.object({
    id: z.string(),
    content: z.string(),
    timestamp: z.string().datetime().pipe(z.coerce.date()).optional(), // Timestamp is optional
  }),
});

export const ingestDocumentResponseSchema = z.object({
  message: z.string(),
  jobId: z.string(),
});

export type IngestDocumentRequest = z.infer<typeof ingestDocumentRequestSchema>;
export type IngestDocumentResponse = z.infer<typeof ingestDocumentResponseSchema>;
