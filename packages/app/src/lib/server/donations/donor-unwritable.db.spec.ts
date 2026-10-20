import { expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { createDb } from '../db/client';
import { commitDonor } from './donor';
import { client, run, stmt } from '$lib/server/db/database.testing';

// one case, in a file of its own, and the isolation is the reason it is not in ./donor.db.spec.ts.
//
// what it needs is a database that genuinely refuses the write, and the only honest way to have one
// is to take the table away — a stand-in for the database proves the stand-in (CLAUDE.md). the drop below outlives
// the test that made it, so every later case in the same file would find no `contact` table. it
// does not outlive the file: each spec file gets a database of its own, which is what makes one
// case alone here safe and the same case beside its neighbours order-dependent.
//
// so this file holds exactly one test and must go on holding exactly one.

it('answers a write the database will not take with a sentence rather than a throw', async () => {
	const db = createDb(client);
	const parsed = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!parsed.ok) throw new Error('the fixture donor does not parse');

	await run(stmt('drop table contact'));

	const committed = await commitDonor(db, parsed.value, null);

	// the arm the repeating-gift path checks before it creates a commitment: a throw here would be a
	// 500 with no body on a public payment endpoint, and a commitment created anyway would collect
	// money against a donor row that is not here.
	expect(committed.ok).toBe(false);
	expect(committed.ok || committed.detail).toContain('`docker compose logs app`');
});
