CREATE TABLE "edge_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"edge_id" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model_name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edges" DROP CONSTRAINT "edges_sourceNodeId_targetNodeId_unique";--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "edge_embeddings" ADD CONSTRAINT "edge_embeddings_edge_id_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."edges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edge_embeddings_embedding_idx" ON "edge_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "edge_embeddings_edge_id_idx" ON "edge_embeddings" USING btree ("edge_id");--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_sourceNodeId_targetNodeId_edge_type_unique" UNIQUE("source_node_id","target_node_id","edge_type");