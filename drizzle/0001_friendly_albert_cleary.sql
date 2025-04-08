CREATE TABLE "aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"alias_text" text NOT NULL,
	"canonical_node_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"edge_type" varchar(50) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "edges_sourceNodeId_targetNodeId_unique" UNIQUE("source_node_id","target_node_id")
);
--> statement-breakpoint
CREATE TABLE "node_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model_name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_metadata" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"label" text,
	"description" text,
	"additional_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"node_type" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_links" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"node_id" text NOT NULL,
	"specific_location" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_identifier" text NOT NULL,
	"metadata" jsonb,
	"last_ingested_at" timestamp,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_canonical_node_id_nodes_id_fk" FOREIGN KEY ("canonical_node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_source_node_id_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_target_node_id_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_embeddings" ADD CONSTRAINT "node_embeddings_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_metadata" ADD CONSTRAINT "node_metadata_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edges_user_id_source_node_id_idx" ON "edges" USING btree ("user_id","source_node_id");--> statement-breakpoint
CREATE INDEX "edges_user_id_target_node_id_idx" ON "edges" USING btree ("user_id","target_node_id");--> statement-breakpoint
CREATE INDEX "edges_user_id_edge_type_idx" ON "edges" USING btree ("user_id","edge_type");--> statement-breakpoint
CREATE INDEX "node_embeddings_embedding_idx" ON "node_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "node_embeddings_node_id_idx" ON "node_embeddings" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "node_metadata_node_id_idx" ON "node_metadata" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "nodes_user_id_idx" ON "nodes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nodes_user_id_node_type_idx" ON "nodes" USING btree ("user_id","node_type");--> statement-breakpoint
CREATE INDEX "source_links_source_id_idx" ON "source_links" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "source_links_node_id_idx" ON "source_links" USING btree ("node_id");