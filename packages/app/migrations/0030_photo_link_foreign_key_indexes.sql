-- adds an index on each of `photo_link`'s foreign keys, `page_id` and `connector_key_id`, which a
-- page's deletion, a key's revocation and the connector sweep find a parent's links by;
-- `src/lib/server/db/schema.ts` argues each. indexes only, so no data step.
CREATE INDEX `photo_link_page_id_idx` ON `photo_link` (`page_id`);--> statement-breakpoint
CREATE INDEX `photo_link_connector_key_id_idx` ON `photo_link` (`connector_key_id`);