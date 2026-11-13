-- a campaign's address (`page.slug`, served at `/<slug>`) and a supporter's fundraiser's
-- (`supporter_page.slug`, served at `/f/<slug>`) are never the same word. each table's unique index
-- covers only its own rows, so the four triggers below refuse a row taking a word the other table
-- holds, with `RAISE(ABORT)`: the statement and its whole `batch()` roll back with
-- `SQLITE_CONSTRAINT_TRIGGER`, and a writer that read the address free retries as it does on
-- `SQLITE_CONSTRAINT_UNIQUE`. each probe is one lookup in the other table's unique slug index.
--
-- an update fires only where the slug changes, so a pair of rows that already share a word keeps
-- both addresses and goes on saving and publishing: a rewrite here would break a link already
-- shared. no row changes and no back-fill is needed: the triggers read the tables as they stand.
--
-- a trigger is dropped with its table, and drizzle-kit neither emits nor tracks one: a rebuild of
-- `page` or `supporter_page` recreates the two triggers on that table by hand.
--
-- `supporter_link_supporter_page_id_idx` is the index `supporter_link.supporter_page_id`'s foreign
-- key is checked by, which every `supporter_page` delete runs. it is built from the links stored.
CREATE INDEX `supporter_link_supporter_page_id_idx` ON `supporter_link` (`supporter_page_id`);
--> statement-breakpoint
CREATE TRIGGER `supporter_page_slug_insert_guard` BEFORE INSERT ON `supporter_page`
WHEN EXISTS (SELECT 1 FROM `page` WHERE `page`.`slug` = NEW.`slug`)
BEGIN
	SELECT RAISE(ABORT, 'supporter_page.slug is a campaign''s address');
END;
--> statement-breakpoint
CREATE TRIGGER `supporter_page_slug_update_guard` BEFORE UPDATE OF `slug` ON `supporter_page`
WHEN NEW.`slug` IS NOT OLD.`slug`
	AND EXISTS (SELECT 1 FROM `page` WHERE `page`.`slug` = NEW.`slug`)
BEGIN
	SELECT RAISE(ABORT, 'supporter_page.slug is a campaign''s address');
END;
--> statement-breakpoint
CREATE TRIGGER `page_slug_insert_guard` BEFORE INSERT ON `page`
WHEN NEW.`slug` IS NOT NULL
	AND EXISTS (SELECT 1 FROM `supporter_page` WHERE `supporter_page`.`slug` = NEW.`slug`)
BEGIN
	SELECT RAISE(ABORT, 'page.slug is a supporter fundraiser''s address');
END;
--> statement-breakpoint
CREATE TRIGGER `page_slug_update_guard` BEFORE UPDATE OF `slug` ON `page`
WHEN NEW.`slug` IS NOT NULL
	AND NEW.`slug` IS NOT OLD.`slug`
	AND EXISTS (SELECT 1 FROM `supporter_page` WHERE `supporter_page`.`slug` = NEW.`slug`)
BEGIN
	SELECT RAISE(ABORT, 'page.slug is a supporter fundraiser''s address');
END;
