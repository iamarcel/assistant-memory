ALTER TABLE "aliases" DROP CONSTRAINT "aliases_canonical_node_id_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "source_links" DROP CONSTRAINT "source_links_source_id_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "source_links" DROP CONSTRAINT "source_links_node_id_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_canonical_node_id_nodes_id_fk" FOREIGN KEY ("canonical_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;