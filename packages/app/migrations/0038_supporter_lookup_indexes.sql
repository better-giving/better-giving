-- two lookups on the supporter tables read through an index rather than a scan: the spend of a
-- supporter's unused links of one purpose, run before every link mailed, and whether a supporter
-- page holds an image as its photo, asked before the image is freed.
-- `src/lib/server/db/schema.ts` argues each index beside it.
--
-- indexes only: no table is rebuilt and no row changes. each is built from the rows already
-- recorded.
CREATE INDEX `supporter_link_unused_idx` ON `supporter_link` (`supporter_id`,`purpose`,`supporter_page_id`) WHERE "supporter_link"."used_at" is null;--> statement-breakpoint
CREATE INDEX `supporter_page_photo_id_idx` ON `supporter_page` (`photo_id`);