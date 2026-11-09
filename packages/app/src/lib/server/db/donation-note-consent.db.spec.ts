import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, openUnmigrated, rawSql, run, stmt } from './database.testing';
import { applyMigrations } from './migrate';
import { rejectionCode } from './rejection.testing';

// a gift's note shown on the donate page: `note_public`, `note_anonymous` and `note_hidden_at` on
// `donation`, read off the applied migrations rather than off ./schema.ts.
//
// the migration is read over a database already holding gifts, because that is the one a deployment
// has: a note written before the donor could be asked must stay private.

const CONSENT_BY = '0034_donation_note_consent.sql';
const CONSENT = MIGRATIONS.findIndex((m) => m.name === CONSENT_BY);

const CONTACT_ID = '019fb400-0000-7000-8000-000000000001';
const NOTED_ID = '019fb400-0000-7000-8000-000000000002';
const SILENT_ID = '019fb400-0000-7000-8000-000000000003';

const insertContact = stmt(
	`insert into contact (id, kind, display_name, created_at, updated_at)
	 values (?, 'individual', 'Note Donor', 0, 0)`,
	CONTACT_ID
);

const insertDonation = (id: string, columns = '', values = '', ...args: number[]) =>
	stmt(
		`insert into donation (id, contact_id, total_minor, currency, received_at, created_at${columns})
		 values (?, ?, 10000, 'USD', 0, 0${values})`,
		id,
		CONTACT_ID,
		...args
	);

describe(`${CONSENT_BY} over a database holding gifts`, () => {
	it('leaves every gift already recorded private, unanonymised and shown', async () => {
		expect(CONSENT, `${CONSENT_BY} is committed`).toBeGreaterThan(0);
		const bare = await openUnmigrated();
		const before = rawSql(bare);
		await applyMigrations(bare, MIGRATIONS.slice(0, CONSENT));
		await before.run(insertContact);
		await before.run(insertDonation(NOTED_ID, ', note', ", 'in memory of my mother'"));
		await before.run(insertDonation(SILENT_ID));

		expect(await applyMigrations(bare, MIGRATIONS.slice(CONSENT, CONSENT + 1))).toEqual([
			CONSENT_BY
		]);

		expect(
			await before.all(
				stmt(
					'select id, note, note_public, note_anonymous, note_hidden_at from donation order by id'
				)
			)
		).toEqual([
			{
				id: NOTED_ID,
				note: 'in memory of my mother',
				note_public: 0,
				note_anonymous: 0,
				note_hidden_at: null
			},
			{ id: SILENT_ID, note: null, note_public: 0, note_anonymous: 0, note_hidden_at: null }
		]);
	});
});

describe('the note flags on a new gift', () => {
	let next = 0;
	const fresh = () => `019fb400-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

	beforeAll(async () => {
		await run(insertContact);
	});

	// the code and the constraint's name, so a row refused by a different check does not pass here.
	const refusedBy = async (
		constraint: string,
		columns: string,
		values: string,
		...args: number[]
	) => {
		const code = await rejectionCode(() => run(insertDonation(fresh(), columns, values, ...args)));
		expect(code).toMatch(/SQLITE_CONSTRAINT_CHECK/);
		expect(code).toContain(constraint);
	};

	it('refuses a gift shown as Anonymous whose note is private', async () => {
		await refusedBy(
			'donation_note_anonymous_public_check',
			', note_public, note_anonymous',
			', 0, 1'
		);
	});

	it('refuses a gift whose private note is marked hidden', async () => {
		await refusedBy(
			'donation_note_hidden_public_check',
			', note_public, note_hidden_at',
			', 0, ?',
			1
		);
	});

	it('refuses a flag that is neither 0 nor 1', async () => {
		// drizzle reads a `2` back as `false`, so without the check it stores and shows as private.
		await refusedBy('donation_note_public_bool_check', ', note_public', ', 2');
		await refusedBy(
			'donation_note_anonymous_bool_check',
			', note_public, note_anonymous',
			', 1, 2'
		);
	});

	it('takes a public note shown as Anonymous, and one hidden', async () => {
		const anonymous = await run(
			insertDonation(fresh(), ', note, note_public, note_anonymous', ", 'thank you', 1, 1")
		);
		const hidden = await run(
			insertDonation(fresh(), ', note, note_public, note_hidden_at', ", 'thank you', 1, ?", 1)
		);
		expect([anonymous.rowsAffected, hidden.rowsAffected]).toEqual([1, 1]);
	});
});
