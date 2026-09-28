-- images: what is known about one in `image`, and its bytes in `image_bytes`, a table of their own
-- so that no rebuild of another table copies them. `src/lib/server/db/schema.ts` argues each column
-- beside it, and `src/lib/server/images/bytes.ts` is the one module that reads or writes the bytes.
--
-- no table is rebuilt: both are plain creates. `STRICT` is hand-written onto each `CREATE TABLE`,
-- since drizzle's snapshot cannot record it.
--
-- `image_bytes.image_id` is its primary key and `NO ACTION`, like every other domain key in this
-- schema. its length check stops a blob at D1's 2,000,000-byte ceiling on a string, blob or row.
--
-- nothing is seeded and nothing is backfilled: no image existed before this file.
CREATE TABLE `image` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`alt` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "image_kind_check" CHECK("image"."kind" in ('photo', 'illustration')),
	CONSTRAINT "image_content_type_check" CHECK("image"."content_type" in ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "image_size_check" CHECK("image"."width" > 0 and "image"."height" > 0 and "image"."byte_size" > 0),
	CONSTRAINT "image_alt_check" CHECK("image"."alt" is null or trim("image"."alt", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE TABLE `image_bytes` (
	`image_id` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `image`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "image_bytes_length_check" CHECK(length("image_bytes"."bytes") between 1 and 2000000)
) STRICT;
