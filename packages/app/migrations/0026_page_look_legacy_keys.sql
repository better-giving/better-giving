-- a page document whose own look was saved by the dashboard's settings sheet, in the release that
-- shipped 0023, holds it as `{shade, corner, brandColour}`, `brandColour` always present as null or
-- a hex, and a look the earlier page rule took may be held as JSON null. the page rule now reads a
-- look as a shade and a corner and nothing else, never null (`src/lib/page/catalog.ts`), so either
-- document is refused on read: donors get the donation box alone, and a campaign whose draft and
-- published copies are both refused has no repair from the dashboard.
--
-- in `draft`, `published` and `last_published` alike, `look.brandColour` is removed wherever it is
-- present, null or not, and a `look` that is JSON null is removed whole, which reads as no look of
-- the page's own. shade, corner, every other key and a null column are left as they are. no other
-- key under `look` was ever stored: the earlier rule parsed a look as a strict object of those three
-- keys on every write.
--
-- data only: no table is rebuilt, and `page`'s look checks still accept a brand colour.
-- `updated_at`, the editor's version, stays: the keys removed are ones nothing reads.
UPDATE `page` SET `draft` = json_remove(`draft`, '$.look.brandColour')
WHERE json_type(`draft`, '$.look.brandColour') IS NOT NULL;
--> statement-breakpoint
UPDATE `page` SET `published` = json_remove(`published`, '$.look.brandColour')
WHERE json_type(`published`, '$.look.brandColour') IS NOT NULL;
--> statement-breakpoint
UPDATE `page` SET `last_published` = json_remove(`last_published`, '$.look.brandColour')
WHERE json_type(`last_published`, '$.look.brandColour') IS NOT NULL;
--> statement-breakpoint
UPDATE `page` SET `draft` = json_remove(`draft`, '$.look')
WHERE json_type(`draft`, '$.look') = 'null';
--> statement-breakpoint
UPDATE `page` SET `published` = json_remove(`published`, '$.look')
WHERE json_type(`published`, '$.look') = 'null';
--> statement-breakpoint
UPDATE `page` SET `last_published` = json_remove(`last_published`, '$.look')
WHERE json_type(`last_published`, '$.look') = 'null';
