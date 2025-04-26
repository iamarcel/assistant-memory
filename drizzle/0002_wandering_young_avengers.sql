ALTER TABLE "sources" RENAME COLUMN "source_type" TO "type";--> statement-breakpoint
ALTER TABLE "sources" RENAME COLUMN "source_identifier" TO "external_id";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "parent_source" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "content_type" varchar(100);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "content_length" integer;--> statement-breakpoint
CREATE INDEX "sources_user_id_idx" ON "sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sources_status_idx" ON "sources" USING btree ("status");--> statement-breakpoint
ALTER TABLE "node_metadata" ADD CONSTRAINT "node_metadata_nodeId_unique" UNIQUE("node_id");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_userId_type_externalId_unique" UNIQUE("user_id","type","external_id");