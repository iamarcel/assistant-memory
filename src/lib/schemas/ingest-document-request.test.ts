import { ingestDocumentRequestSchema } from "./ingest-document-request";
import { describe, it, expect } from "vitest";

describe("ingestDocumentRequestSchema", () => {
  it("defaults updateExisting to false", () => {
    const parsed = ingestDocumentRequestSchema.parse({
      userId: "u1",
      document: { id: "d1", content: "text" },
    });
    expect(parsed.updateExisting).toBe(false);
  });

  it("allows updateExisting true", () => {
    const parsed = ingestDocumentRequestSchema.parse({
      userId: "u1",
      updateExisting: true,
      document: { id: "d1", content: "text" },
    });
    expect(parsed.updateExisting).toBe(true);
  });
});
