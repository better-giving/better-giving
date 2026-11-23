-- the ticker list the stock step searches, from the SEC's public files. `ticker` is every symbol and
-- `ticker_name` is the full-text index of the companies' names. both start empty and are filled only
-- by `replaceTickers` (src/lib/server/donations/tickers.ts), never by a migration: the list is
-- refreshed data, not reference data a fork must ship with.
--
-- `STRICT` is hand-written onto `ticker`. `ticker_name` is hand-written whole: drizzle-kit declares no
-- virtual table. it is FTS5 and takes no `STRICT`; strict.db.spec.ts reads only `pragma_table_list`
-- rows of type `table`, and FTS5 lists as `virtual` and its shadow tables as `shadow`.
-- `ticker_name` holds its own copy of each name beside its `symbol`, an `UNINDEXED` column the search
-- joins to `ticker`'s primary key. it has no key but FTS5's `rowid`, and is not an external-content
-- table: the list is only replaced whole, so there is no row-by-row sync to keep.
-- `remove_diacritics 2` folds accents both ways, so a name with one is found typed without.
CREATE TABLE `ticker` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text,
	`exchange` text,
	`kind` text NOT NULL,
	`replaced_at` integer NOT NULL,
	CONSTRAINT "ticker_kind_check" CHECK("ticker"."kind" in ('company', 'fund')),
	CONSTRAINT "ticker_symbol_not_blank_check" CHECK(trim("ticker"."symbol", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "ticker_symbol_uppercase_check" CHECK("ticker"."symbol" = upper("ticker"."symbol")),
	CONSTRAINT "ticker_name_not_blank_check" CHECK("ticker"."name" is null or trim("ticker"."name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "ticker_exchange_not_blank_check" CHECK("ticker"."exchange" is null or trim("ticker"."exchange", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "ticker_fund_has_no_name_check" CHECK("ticker"."kind" <> 'fund' or "ticker"."name" is null)
) STRICT;
--> statement-breakpoint
CREATE VIRTUAL TABLE `ticker_name` USING fts5(`name`, `symbol` UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
