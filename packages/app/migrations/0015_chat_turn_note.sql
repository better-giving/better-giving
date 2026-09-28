-- a chat turn's note: `chat_turn.note` is null, or `refused`, `fell-back` or `unanswered` on an
-- assistant turn, and an operator's turn has none. `src/lib/server/db/schema.ts` argues the column
-- beside it.
--
-- a new CHECK is not one of sqlite's native ALTERs, so `chat_turn` is the create-copy-drop-rename
-- rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, with the hand-edits
-- CONTRIBUTING.md -> Migrations lists:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON`, which is inert inside the one
-- transaction this file runs as. no table references `chat_turn`, so the `DROP` has no child row
-- to fail on and deletes none; `defer_foreign_keys` stands in its place all the same, so the file
-- reads as every other rebuild does. the copied rows point at `page`, which this file leaves alone.
--
-- `STRICT` is hand-written onto the `__new_` table.
--
-- every CHECK on the `__new_` table is unqualified. drizzle qualified them with the `__new_`
-- table, which `ALTER TABLE ... RENAME TO` does not rewrite, and sqlite 3.43 refuses the rename
-- over it.
--
-- the copy names the eight columns the old table holds, all of them unchanged. drizzle's copy
-- also named `note`, which the old table lacks, and sqlite's double-quoted-string fallback would
-- have copied the word `note` into every row, where the new CHECK refuses it; left out of the
-- copy, every copied turn takes null.
--
-- the one index re-emitted is `chat_turn_page_seq_idx`, which is not functional, so there is no
-- backtick to strip.
--
-- no backfill: no turn has been written with a note.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_chat_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`seq` integer NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`model` text,
	`image_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_turn_author_check" CHECK("author" in ('operator', 'assistant')),
	CONSTRAINT "chat_turn_note_check" CHECK("note" is null or ("author" = 'assistant' and "note" in ('refused', 'fell-back', 'unanswered'))),
	CONSTRAINT "chat_turn_model_check" CHECK(("model" is not null) = ("author" = 'assistant') and ("model" is null or trim("model", char(32, 9, 10, 11, 12, 13, 160)) <> '')),
	CONSTRAINT "chat_turn_image_ids_array_check" CHECK(json_valid("image_ids") and json_type("image_ids") = 'array'),
	CONSTRAINT "chat_turn_text_check" CHECK(trim("text", char(32, 9, 10, 11, 12, 13, 160)) <> '' or json_array_length("image_ids") > 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_chat_turn`("id", "page_id", "seq", "author", "text", "model", "image_ids", "created_at") SELECT "id", "page_id", "seq", "author", "text", "model", "image_ids", "created_at" FROM `chat_turn`;--> statement-breakpoint
DROP TABLE `chat_turn`;--> statement-breakpoint
ALTER TABLE `__new_chat_turn` RENAME TO `chat_turn`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turn_page_seq_idx` ON `chat_turn` (`page_id`,`seq`);
