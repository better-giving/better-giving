import { describe, expect, it } from 'vitest';
import { first, run, stmt } from './database.testing';
import { rejectionCode } from './rejection.testing';

// what 0045 lets the schema hold: the one cursor a hosted site's hourly pull keeps into its fiscal
// sponsor's event feed, which has no row until the pull first writes one.
//
// every probe runs against the committed `migrations/` applied to a real database
// (./database.testing.ts). storage is per file, not per test, and the table holds one row at
// most, so each probe that writes that row deletes it again.

const clear = () => run(stmt('delete from sponsor_event_cursor'));

describe('the sponsor event cursor', () => {
	it('starts at sequence 0 when the pull writes it without one', async () => {
		await run(stmt(`insert into sponsor_event_cursor (id, updated_at) values ('sponsor', 0)`));
		const row = await first(stmt(`select seq from sponsor_event_cursor where id = 'sponsor'`));
		expect(row).toEqual({ seq: 0 });
		await clear();
	});

	it('is refused under any id but sponsor, so there is never a second cursor', async () => {
		const chain = await rejectionCode(() =>
			run(stmt(`insert into sponsor_event_cursor (id, seq, updated_at) values ('other', 1, 0)`))
		);
		expect(chain).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(chain).toContain('sponsor_event_cursor_id_check');
	});

	it('is refused a second sponsor row', async () => {
		await run(
			stmt(`insert into sponsor_event_cursor (id, seq, updated_at) values ('sponsor', 4, 0)`)
		);
		const chain = await rejectionCode(() =>
			run(stmt(`insert into sponsor_event_cursor (id, seq, updated_at) values ('sponsor', 5, 0)`))
		);
		expect(chain).toContain('SQLITE_CONSTRAINT_PRIMARYKEY');
		await clear();
	});

	it('is refused a negative sequence, which the feed never numbers', async () => {
		const chain = await rejectionCode(() =>
			run(stmt(`insert into sponsor_event_cursor (id, seq, updated_at) values ('sponsor', -1, 0)`))
		);
		expect(chain).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(chain).toContain('sponsor_event_cursor_seq_check');
	});
});
