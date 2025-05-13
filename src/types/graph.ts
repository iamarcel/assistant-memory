import { z } from "zod";

// =============================================================
// BASE ENUMS
// =============================================================

export const NodeTypeEnum = z.enum([
  "Person",
  "Location",
  "Event",
  "Object",
  "Emotion",
  "Concept",
  "Media",
  "Temporal",
  "Conversation",
  "Atlas",
  "AssistantDream",
  "Document",
]);

export type NodeType = z.infer<typeof NodeTypeEnum>;

export const EdgeTypeEnum = z.enum([
  "PARTICIPATED_IN",
  "OCCURRED_AT",
  "OCCURRED_ON",
  "INVOLVED_ITEM",
  "EXHIBITED_EMOTION",
  "TAGGED_WITH",
  "OWNED_BY",
  "MENTIONED_IN",
  "PRECEDES",
  "FOLLOWS",
  "RELATED_TO",
  "CAPTURED_IN",
]);

export type EdgeType = z.infer<typeof EdgeTypeEnum>;

export type SourceType = "conversation" | "conversation_message" | "document";

export type SourceStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "summarized";
