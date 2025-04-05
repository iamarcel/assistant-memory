import {
  pgTable,
  varchar,
  timestamp,
  text,
  jsonb,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { typeId } from "./typeid";
import { EdgeType, NodeType } from "~/types/graph";
// --- Core Ontology & Structure ---

// Optional: Define the allowed types for nodes and edges
// pgTable('ontology_node_types', { ... name: string, description: string ... });
// pgTable('ontology_edge_types', { ... name: string, description: string, allowed_source_types: string[], allowed_target_types: string[] ... });

export const users = pgTable("users", {
  id: typeId("user")().primaryKey().notNull(),
});

export const nodes = pgTable(
  "nodes",
  {
    id: typeId("node")().primaryKey().notNull(),
    userId: typeId("user")()
      .references(() => users.id)
      .notNull(),
    nodeType: varchar(undefined, { length: 50 }).notNull().$type<NodeType>(),
    createdAt: timestamp().defaultNow().notNull(),
    // Index on (userId, nodeType) might be useful
  },
  (table) => [
    index("nodes_user_id_idx").on(table.userId),
    index("nodes_user_id_node_type_idx").on(table.userId, table.nodeType),
  ]
);

export const nodeMetadata = pgTable(
  "node_metadata",
  {
    id: typeId("node_metadata")().primaryKey().notNull(),
    nodeId: typeId("node")()
      .references(() => nodes.id)
      .notNull(),
    label: text(), // Human-readable name/title
    description: text(), // Longer text description
    // Maybe add timestamps for when this metadata was last updated
    // Temporal aspect - can be added here or via edges
    // validFrom: timestamp('valid_from'),
    // validTo: timestamp('valid_to'), // Null means currently valid
    additionalData: jsonb(), // For type-specific structured data
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Index on nodeId
  },
  (table) => [index("node_metadata_node_id_idx").on(table.nodeId)]
);

export const edges = pgTable(
  "edges",
  {
    id: typeId("edge")().primaryKey().notNull(),
    userId: typeId("user")()
      .references(() => users.id)
      .notNull(),
    sourceNodeId: typeId("node")()
      .references(() => nodes.id)
      .notNull(),
    targetNodeId: typeId("node")()
      .references(() => nodes.id)
      .notNull(),
    edgeType: varchar(undefined, { length: 50 }).notNull().$type<EdgeType>(), // FK to ontology_edge_types if defined
    // Optional: Metadata for the edge itself (e.g., confidence score, properties of the relationship)
    metadata: jsonb(),
    // Temporal aspect for relationships
    // validFrom: timestamp('valid_from'),
    // validTo: timestamp('valid_to'),
    createdAt: timestamp().defaultNow().notNull(),
    // Indexes on (userId, sourceNodeId), (userId, targetNodeId), (userId, edgeType)
  },
  (table) => [
    index("edges_user_id_source_node_id_idx").on(
      table.userId,
      table.sourceNodeId
    ),
    index("edges_user_id_target_node_id_idx").on(
      table.userId,
      table.targetNodeId
    ),
    index("edges_user_id_edge_type_idx").on(table.userId, table.edgeType),
  ]
);

// --- Embeddings & Search ---

export const nodeEmbeddings = pgTable(
  "node_embeddings",
  {
    id: typeId("node_embedding")().primaryKey().notNull(),
    nodeId: typeId("node")()
      .references(() => nodes.id)
      .notNull(),
    embedding: vector(undefined, { dimensions: 1536 }).notNull(), // Dimension depends on model
    modelName: varchar(undefined, { length: 100 }).notNull(),
    createdAt: timestamp().defaultNow().notNull(),
    // Unique constraint on (nodeId, modelName)? Or allow multiple embeddings per node? Let's start with unique.
  },
  (table) => [
    index("node_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    index("node_embeddings_node_id_idx").on(table.nodeId),
  ]
);

// --- Aliases & Identity Resolution ---

export const aliases = pgTable("aliases", {
  id: typeId("alias")().primaryKey().notNull(),
  userId: typeId("user")()
    .references(() => users.id)
    .notNull(),
  aliasText: text().notNull(), // The alias string (e.g., "I", "MW", "Mom")
  canonicalNodeId: typeId("node")()
    .references(() => nodes.id)
    .notNull(), // The node this alias refers to
  createdAt: timestamp().defaultNow().notNull(),
  // Index on (userId, aliasText) for fast lookups
  // Index on (userId, canonicalNodeId)
});

// --- Source Tracking & Traceability ---

export const sources = pgTable("sources", {
  id: typeId("source")().primaryKey().notNull(),
  userId: typeId("user")()
    .references(() => users.id)
    .notNull(),
  sourceType: varchar(undefined, { length: 50 }).notNull(), // e.g., 'chat_session', 'notion_page', 'obsidian_note', 'audio_file'
  sourceIdentifier: text().notNull(), // e.g., session ID, page URL/ID, file path
  metadata: jsonb(), // e.g., Notion page title, chat participants
  lastIngestedAt: timestamp(),
  status: varchar("status", { length: 20 }).default("pending"), // e.g., 'pending', 'processing', 'completed', 'failed'
  createdAt: timestamp().defaultNow().notNull(),
  // Unique constraint on (userId, sourceType, sourceIdentifier)
  // Index on (userId, status)
});

export const sourceLinks = pgTable(
  "source_links",
  {
    id: typeId("source_link")().primaryKey().notNull(),
    sourceId: typeId("source")()
      .references(() => sources.id)
      .notNull(),
    nodeId: typeId("node")()
      .references(() => nodes.id)
      .notNull(), // The ID of the node or edge
    // Optional: more specific location within the source (e.g., block ID, line number, timestamp in audio)
    specificLocation: text(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    index("source_links_source_id_idx").on(table.sourceId),
    index("source_links_node_id_idx").on(table.nodeId),
  ]
);

// --- Specialized Data ---

export const userProfiles = pgTable("user_profiles", {
  id: typeId("user_profile")().primaryKey().notNull(),
  userId: typeId("user")()
    .references(() => users.id)
    .notNull(),
  content: text().notNull(), // The descriptive text
  lastUpdatedAt: timestamp().defaultNow().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
  // Index on (userId)
});
